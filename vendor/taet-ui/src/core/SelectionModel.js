import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";
import { selectionMutationGuard } from "./selectionMutationGuard.js";

export class SelectionModel {
  constructor(options = {}) {
    this.events = new EventBus();
    this.multiple = options.multiple === true;
    this._items = [];
    this._destroyed = false;
    this._revision = 0;
  }

  get destroyed() {
    return this._destroyed;
  }

  get() {
    this._assertUsable("get");
    return [...this._items];
  }

  set(items, options = {}) {
    this._assertUsable("set");

    if (!Array.isArray(items)) {
      throw new TypeError("SelectionModel.set() expects an array.");
    }

    const mutation = normalizeMutationOptions(options);
    const current = options?.[selectionMutationGuard] ?? (() => true);
    const oldItems = this.get();
    const uniqueNextItems = uniqueItems(items);

    if (!this.multiple && uniqueNextItems.length > 1) {
      throw new TypeError("SelectionModel in single mode accepts at most one item.");
    }

    const nextItems = this.multiple ? uniqueNextItems : uniqueNextItems;

    if (sameItems(oldItems, nextItems)) {
      return false;
    }

    const event = {
      source: this,
      oldItems,
      items: [...nextItems],
      oldValue: oldItems,
      newValue: [...nextItems],
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    const revision = this._revision;
    if (!mutation.silent) {
      this.events.emit("beforeChange", event);
    }

    if (this._destroyed || this._revision !== revision || event.cancel || !current()) {
      return false;
    }

    this._items = [...nextItems];
    const appliedRevision = ++this._revision;
    const changeEvent = { ...event, items: this.get(), newValue: this.get() };
    delete changeEvent.cancel;
    this.events.emit("invalidate", { ...changeEvent, oldItems: [...oldItems], oldValue: [...oldItems],
      items: this.get(), newValue: this.get(), silent: mutation.silent });
    if (this._destroyed || this._revision !== appliedRevision || !current()) return true;

    if (!mutation.silent) {
      this.events.emit("change", changeEvent);
      if (!this._destroyed && this._revision === appliedRevision && current()) this.events.emit("afterChange", { ...changeEvent });
    }

    return true;
  }

  clear(options = {}) {
    this._assertUsable("clear");
    return this.set([], options);
  }

  hasAny() {
    this._assertUsable("hasAny");
    return this._items.length > 0;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    this._items = [];
    this._destroyed = true;
    this.events.destroy();
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed SelectionModel.`);
    }
  }
}

function uniqueItems(items) {
  const result = [];

  for (const item of items) {
    if (!result.includes(item)) {
      result.push(item);
    }
  }

  return result;
}

function sameItems(left, right) {
  return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
}
