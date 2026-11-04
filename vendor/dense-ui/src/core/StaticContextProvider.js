import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";

export class StaticContextProvider {
  constructor(context = {}) {
    this._context = context;
    this.events = new EventBus();
    this._destroyed = false;
  }

  get destroyed() {
    return this._destroyed;
  }

  getContext() {
    this._assertUsable("getContext");
    return this._context;
  }

  setContext(context, options = {}) {
    this._assertUsable("setContext");
    const mutation = normalizeMutationOptions(options);
    const oldContext = this._context;
    this._context = context;

    if (!mutation.silent) {
      this.events.emit("contextChange", {
        source: this,
        oldContext,
        newContext: this._context,
        origin: mutation.origin,
        userAction: mutation.userAction
      });
    }
  }

  patchContext(patch, options = {}) {
    this._assertUsable("patchContext");
    this.setContext({ ...this._context, ...patch }, options);
  }

  notifyChange(options = {}) {
    this._assertUsable("notifyChange");
    const mutation = normalizeMutationOptions(options);

    if (mutation.silent) {
      return;
    }

    this.events.emit("contextChange", {
      source: this,
      oldContext: this._context,
      newContext: this._context,
      origin: mutation.origin,
      userAction: mutation.userAction
    });
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;
    this._context = null;
    this.events.destroy();
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed StaticContextProvider.`);
    }
  }
}
