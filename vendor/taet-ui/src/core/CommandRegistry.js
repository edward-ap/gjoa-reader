import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";

export class CommandRegistry {
  constructor(options = {}) {
    this.events = new EventBus();
    this._commands = new Map();
    this._states = new Map();
    this._contextProvider = options.contextProvider ?? null;
    this._contextSubscription = null;
    this._destroyed = false;
    this._contextRevision = 0;
    this._refreshing = false;
    this._deriving = new Set();
    this._readingContext = false;

    if (this._contextProvider) {
      this.setContextProvider(this._contextProvider);
    }
  }

  get destroyed() {
    return this._destroyed;
  }

  register(id, command) {
    this._assertUsable("register");
    this._assertCommandId(id);

    if (this._commands.has(id)) {
      throw new Error(`Command already registered: ${id}`);
    }

    const registered = { ...command, id };
    this._commands.set(id, registered);
    const revision = this._contextRevision;
    try {
      const state = this._deriveState(registered, this._getContext(), revision);
      if (this._isCurrent(registered, revision)) this._states.set(id, state);
    } catch (error) {
      if (this._isCurrent(registered)) {
        this._commands.delete(id);
        this._states.delete(id);
      }
      throw error;
    }

    if (this._isCurrent(registered)) {
      this.events.emit("register", {
        source: this,
        commandId: id,
        command: registered
      });
      if (this._isCurrent(registered)) this.refreshState();
    }

    let disposed = false;
    const dispose = () => {
      if (disposed) {
        return;
      }

      disposed = true;
      if (this._isCurrent(registered)) this.unregister(id);
    };

    return { dispose, off: dispose };
  }

  unregister(id) {
    this._assertUsable("unregister");
    const command = this._commands.get(id);

    if (!command) {
      return false;
    }

    this._commands.delete(id);
    this._states.delete(id);

    this.events.emit("unregister", {
      source: this,
      commandId: id,
      command
    });

    return true;
  }

  get(id) {
    this._assertUsable("get");
    return this._commands.get(id);
  }

  setContextProvider(provider) {
    this._assertUsable("setContextProvider");
    const revision = ++this._contextRevision;
    const current = () => !this._destroyed && revision === this._contextRevision;
    const previous = this._contextSubscription;
    this._contextSubscription = null;
    this._contextProvider = provider;
    previous?.dispose();
    if (!current()) return;

    if (provider?.events) {
      const subscription = provider.events.on("contextChange", () => {
        if (current()) this.refreshState();
      });
      if (!current()) {
        subscription.dispose();
        return;
      }
      this._contextSubscription = subscription;
    }

    if (current()) this.refreshState();
  }

  list() {
    this._assertUsable("list");
    return Array.from(this._commands.values());
  }

  canExecute(id, context) {
    this._assertUsable("canExecute");
    return this.state(id, context).enabled;
  }

  state(id, context) {
    this._assertUsable("state");
    const command = this._requireCommand(id);
    const revision = this._contextRevision;
    return this._deriveState(command, this._getContext(context), revision);
  }

  refreshState() {
    this._assertUsable("refreshState");
    // A state predicate may query state or ask for a refresh. Do not recursively
    // evaluate it or walk registrations added by callbacks to the live Map.
    if (this._refreshing || this._deriving.size || this._readingContext) return;
    this._refreshing = true;
    try {
      const commands = this.list();
      const revision = this._contextRevision;
      const context = this._getContext();
      for (const command of commands) {
        if (!this._isCurrent(command, revision)) continue;
        const nextState = this._deriveState(command, context, revision);
        if (!this._isCurrent(command, revision)) continue;
        const previousState = this._states.get(command.id);
        this._states.set(command.id, nextState);

        if (!previousState || !sameCommandState(previousState, nextState)) {
          this.events.emit("stateChange", {
            source: this,
            commandId: command.id,
            oldState: previousState,
            state: nextState
          });
        }
      }
    } finally {
      this._refreshing = false;
    }
  }

  async execute(id, context, options = {}) {
    this._assertUsable("execute");
    const command = this._requireCommand(id);
    const revision = this._contextRevision;
    const commandContext = this._getContext(context);
    const current = () => this._isCurrent(command, revision);
    if (!current()) return { ok: false, message: "Cancelled" };
    const mutation = normalizeMutationOptions(options);
    const runOptions = {
      ...mutation,
      force: options.force === true
    };

    const before = this.events.emit("beforeExecute", {
      source: this,
      commandId: id,
      context: commandContext,
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    });

    if (before.cancel || !current()) {
      return { ok: false, message: "Cancelled" };
    }

    if (!runOptions.force) {
      const state = this._deriveState(command, commandContext, revision);
      if (!current()) return { ok: false, message: "Cancelled" };
      if (!state.enabled) return { ok: false, message: "Command disabled" };
    }

    let result;

    try {
      result = normalizeCommandResult(await command.run(commandContext, runOptions));
    } catch (error) {
      result = { ok: false, error, message: error?.message ?? "Command failed" };

      if (!this._isCurrent(command)) return result;

      this.events.emit("error", {
        source: this,
        commandId: id,
        context: commandContext,
        error,
        origin: mutation.origin,
        userAction: mutation.userAction
      });
    }

    // In-flight work still settles for its caller after the owning screen closes.
    // It must not notify a destroyed registry or a replacement registration.
    if (!this._isCurrent(command)) return result;

    this.events.emit("afterExecute", {
      source: this,
      commandId: id,
      context: commandContext,
      result,
      origin: mutation.origin,
      userAction: mutation.userAction
    });

    if (this._isCurrent(command)) this.refreshState();
    return result;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;
    ++this._contextRevision;
    const subscription = this._contextSubscription;
    this._contextSubscription = null;
    this._commands.clear();
    this._states.clear();
    this._contextProvider = null;
    this.events.destroy();
    subscription?.dispose();
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed CommandRegistry.`);
    }
  }

  _isCurrent(command, revision = this._contextRevision) {
    return !this._destroyed && revision === this._contextRevision &&
      this._commands.get(command.id) === command;
  }

  _deriveState(command, context, revision = this._contextRevision) {
    const inactive = {
      id: command.id,
      label: command.label ?? command.id,
      description: command.description,
      shortcut: command.shortcut,
      icon: command.icon,
      enabled: false,
      visible: false,
      checked: false
    };
    if (!this._isCurrent(command, revision)) return inactive;
    if (this._deriving.has(command)) return { ...(this._states.get(command.id) ?? inactive) };
    this._deriving.add(command);
    try {
      const state = { ...inactive };
      for (const field of ["enabled", "visible", "checked"]) {
        state[field] = evaluateCommandField(command[field], context, field !== "checked");
        if (!this._isCurrent(command, revision)) return inactive;
      }
      return state;
    } finally {
      this._deriving.delete(command);
    }
  }

  _getContext(context) {
    if (context) {
      return context;
    }

    if (this._readingContext) return {};
    this._readingContext = true;
    try {
      return this._contextProvider?.getContext?.() ?? {};
    } finally {
      this._readingContext = false;
    }
  }

  _requireCommand(id) {
    const command = this._commands.get(id);

    if (!command) {
      throw new Error(`Command not registered: ${id}`);
    }

    return command;
  }

  _assertCommandId(id) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("Command id must be a non-empty string.");
    }
  }
}

function evaluateCommandField(field, context, defaultValue) {
  if (field == null) {
    return defaultValue;
  }

  if (typeof field === "function") {
    return Boolean(field(context));
  }

  return Boolean(field);
}

function normalizeCommandResult(result) {
  if (result == null) {
    return { ok: true };
  }

  if (typeof result === "object" && "ok" in result) {
    return result;
  }

  return { ok: true, value: result };
}

function sameCommandState(a, b) {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.description === b.description &&
    a.shortcut === b.shortcut &&
    a.icon === b.icon &&
    a.enabled === b.enabled &&
    a.visible === b.visible &&
    a.checked === b.checked
  );
}
