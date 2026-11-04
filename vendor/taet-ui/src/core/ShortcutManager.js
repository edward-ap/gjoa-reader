import { EventBus } from "./EventBus.js";

export class ShortcutManager {
  constructor(options = {}) {
    this.events = new EventBus();
    this.commands = options.commands ?? null;
    this.contextProvider = options.contextProvider ?? null;
    this.target =
      options.target ?? (typeof document !== "undefined" ? document : null);
    this._bindings = new Map();
    this._commandRegistrySubscriptions = new Set();
    this._listening = false;
    this._destroyed = false;
    this._keydownHandler = event => this.handleKeyboardEvent(event);

    if (this.target && options.autoListen !== false) {
      this.listen(this.target);
    }
  }

  get destroyed() {
    return this._destroyed;
  }

  listen(target = this.target) {
    this._assertUsable("listen");

    if (this._listening) {
      return this;
    }

    this.target = target;
    this.target.addEventListener("keydown", this._keydownHandler);
    this._listening = true;
    return this;
  }

  bind(commandId, shortcut, options = {}) {
    this._assertUsable("bind");
    assertCommandId(commandId);

    const key = normalizeShortcut(shortcut);
    const existing = this._bindings.get(key);

    if (existing && existing.commandId !== commandId) {
      const event = this.events.emit("conflict", {
        source: this,
        shortcut,
        normalizedShortcut: key,
        commandId,
        existingCommandId: existing.commandId,
        cancel: false
      });

      if (!event.cancel) {
        throw new Error(
          `Shortcut conflict: ${shortcut} is already bound to ${existing.commandId}.`
        );
      }
    }

    const binding = {
      commandId,
      shortcut,
      normalizedShortcut: key,
      scope: options.scope ?? "workbench",
      when: options.when,
      allowInTextInput: options.allowInTextInput === true
    };

    this._bindings.set(key, binding);

    let disposed = false;
    const dispose = () => {
      if (disposed) {
        return;
      }

      disposed = true;
      const current = this._bindings.get(key);

      if (current === binding) {
        this._bindings.delete(key);
      }
    };

    return { dispose, off: dispose };
  }

  unbind(commandId) {
    this._assertUsable("unbind");

    for (const [shortcut, binding] of [...this._bindings.entries()]) {
      if (binding.commandId === commandId) {
        this._bindings.delete(shortcut);
      }
    }
  }

  bindCommands(commands = this.commands) {
    this._assertUsable("bindCommands");

    if (!commands || typeof commands.list !== "function") {
      throw new TypeError("ShortcutManager.bindCommands() requires CommandRegistry.");
    }

    this.commands = commands;
    const subscriptions = [];
    const commandBindings = new Map();

    const bindCommand = command => {
      if (!command.shortcut || commandBindings.has(command.id)) {
        return;
      }

      commandBindings.set(command.id, this.bind(command.id, command.shortcut, getCommandShortcutOptions(command)));
    };

    const unbindCommand = commandId => {
      const subscription = commandBindings.get(commandId);

      if (!subscription) {
        return;
      }

      subscription.dispose();
      commandBindings.delete(commandId);
    };

    for (const command of commands.list()) {
      bindCommand(command);
    }

    subscriptions.push(
      commands.events.on("register", event => bindCommand(event.command)),
      commands.events.on("unregister", event => unbindCommand(event.commandId))
    );

    for (const subscription of subscriptions) {
      this._commandRegistrySubscriptions.add(subscription);
    }

    return {
      dispose: () => {
        for (const subscription of subscriptions) {
          subscription.dispose();
          this._commandRegistrySubscriptions.delete(subscription);
        }

        for (const subscription of commandBindings.values()) {
          subscription.dispose();
        }

        commandBindings.clear();
      }
    };
  }

  handleKeyboardEvent(event) {
    this._assertUsable("handleKeyboardEvent");
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;

    const shortcut = shortcutFromKeyboardEvent(event);
    // Exact Meta wins; Ctrl/Cmd remains the portable fallback on Meta.
    const binding = this._bindings.get(shortcut) ??
      (event.metaKey && !event.ctrlKey ? this._bindings.get(shortcutFromKeyboardEvent(event, true)) : undefined);

    if (!binding || !this.commands) {
      return false;
    }

    const context = this.contextProvider?.getContext?.() ?? undefined;
    if (this._destroyed) return false;

    if (
      isTextEditingTarget(event.target) &&
      !binding.allowInTextInput
    ) {
      return false;
    }

    if (binding.when && !binding.when(context ?? {})) {
      return false;
    }

    if (this._destroyed || !this.commands.canExecute(binding.commandId, context) || this._destroyed) {
      return false;
    }

    event.preventDefault();

    this.commands.execute(binding.commandId, context, {
      origin: "user",
      userAction: true
    });

    if (!this._destroyed) this.events.emit("execute", {
      source: this,
      commandId: binding.commandId,
      shortcut: binding.shortcut,
      normalizedShortcut: binding.normalizedShortcut,
      nativeEvent: event,
      origin: "user",
      userAction: true
    });

    return true;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    if (this._listening && this.target) {
      this.target.removeEventListener("keydown", this._keydownHandler);
    }

    this._bindings.clear();

    for (const subscription of this._commandRegistrySubscriptions) {
      subscription.dispose();
    }

    this._commandRegistrySubscriptions.clear();
    this._listening = false;
    this.target = null;
    this.commands = null;
    this.contextProvider = null;
    this._destroyed = true;
    this.events.destroy();
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed ShortcutManager.`);
    }
  }
}

function isTextEditingTarget(target) {
  if (!target) {
    return false;
  }

  if (typeof HTMLElement !== "undefined" && !(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (typeof target.closest === "function" && target.closest("[contenteditable='true'], [contenteditable='']")) {
    return true;
  }

  const tagName = target.tagName;

  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function getCommandShortcutOptions(command) {
  return {
    scope: command.shortcutScope ?? command.scope,
    when: command.shortcutWhen ?? command.when,
    allowInTextInput:
      command.allowShortcutInTextInput === true ||
      command.shortcutAllowInTextInput === true ||
      command.shortcutOptions?.allowInTextInput === true
  };
}

function normalizeShortcut(shortcut) {
  if (typeof shortcut !== "string" || shortcut.trim() === "") {
    throw new TypeError("Shortcut must be a non-empty string.");
  }

  const parts = shortcut
    .split("+")
    .map(part => part.trim())
    .filter(Boolean);

  const modifiers = new Set();
  let key = "";

  for (const part of parts) {
    const normalized = normalizeShortcutPart(part);

    if (isModifier(normalized)) {
      modifiers.add(normalized);
    } else {
      key = normalized;
    }
  }

  if (!key) {
    throw new TypeError(`Shortcut is missing key: ${shortcut}.`);
  }

  return [...["Ctrl", "Alt", "Shift", "Meta"].filter(modifier => modifiers.has(modifier)), key].join(
    "+"
  );
}

function shortcutFromKeyboardEvent(event, portableMeta = false) {
  const modifiers = [];

  if (event.ctrlKey || portableMeta && event.metaKey) {
    modifiers.push("Ctrl");
  }

  if (event.altKey) {
    modifiers.push("Alt");
  }

  if (event.shiftKey) {
    modifiers.push("Shift");
  }

  if (event.metaKey && !portableMeta) modifiers.push("Meta");
  const key = normalizeShortcutPart(event.key);
  return [...modifiers, key].join("+");
}

function normalizeShortcutPart(part) {
  const value = String(part).trim();
  const lower = value.toLowerCase();

  if (lower === "control" || lower === "ctrl" || lower === "cmd" || lower === "command") {
    return "Ctrl";
  }

  if (lower === "meta") {
    return "Meta";
  }

  if (lower === "option" || lower === "alt") {
    return "Alt";
  }

  if (lower === "shift") {
    return "Shift";
  }

  if (value.length === 1) {
    return value.toUpperCase();
  }

  return value;
}

function isModifier(part) {
  return part === "Ctrl" || part === "Alt" || part === "Shift" || part === "Meta";
}

function assertCommandId(commandId) {
  if (typeof commandId !== "string" || commandId.length === 0) {
    throw new TypeError("Command id must be a non-empty string.");
  }
}
