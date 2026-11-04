import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";

export class DocumentState {
  constructor(options = {}) {
    this.events = new EventBus();
    this._dirty = options.dirty === true;
    this._versionToken = options.versionToken;
    this._destroyed = false;
  }

  get destroyed() {
    return this._destroyed;
  }

  isDirty() {
    this._assertUsable("isDirty");
    return this._dirty;
  }

  markDirty(reason = {}) {
    this._assertUsable("markDirty");
    const oldDirty = this._dirty;
    this._dirty = true;

    const mutation = normalizeMutationOptions({
      origin: reason.origin,
      userAction: reason.userAction
    });

    this.events.emit("markDirty", {
      source: this,
      dirty: this._dirty,
      reason,
      origin: mutation.origin,
      userAction: mutation.userAction
    });

    if (oldDirty !== this._dirty) {
      this.events.emit("dirtyChange", {
        source: this,
        oldValue: oldDirty,
        newValue: this._dirty,
        dirty: this._dirty,
        reason,
        origin: mutation.origin,
        userAction: mutation.userAction
      });
    }
  }

  markClean(versionToken, options = {}) {
    this._assertUsable("markClean");
    const oldDirty = this._dirty;
    this._dirty = false;
    this._versionToken = versionToken;

    const mutation = normalizeMutationOptions(options);

    this.events.emit("markClean", {
      source: this,
      dirty: this._dirty,
      versionToken,
      origin: mutation.origin,
      userAction: mutation.userAction
    });

    if (oldDirty !== this._dirty) {
      this.events.emit("dirtyChange", {
        source: this,
        oldValue: oldDirty,
        newValue: this._dirty,
        dirty: this._dirty,
        versionToken,
        origin: mutation.origin,
        userAction: mutation.userAction
      });
    }
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;
    this.events.destroy();
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed DocumentState.`);
    }
  }
}
