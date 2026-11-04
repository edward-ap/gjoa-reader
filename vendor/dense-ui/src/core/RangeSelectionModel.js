import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";

export class RangeSelectionModel {
  constructor(options = {}) {
    this.events = new EventBus();
    this.multiple = options.multiple !== false;
    this._ranges = [];
    this._destroyed = false;
    this._revision = 0;
  }

  get destroyed() {
    return this._destroyed;
  }

  get() {
    this._assertUsable("get");
    return this._ranges.map(cloneRange);
  }

  primary() {
    this._assertUsable("primary");
    return this._ranges.length ? cloneRange(this._ranges[this._ranges.length - 1]) : null;
  }

  set(ranges, options = {}) {
    this._assertUsable("set");
    const input = Array.isArray(ranges) ? ranges : [ranges];
    const next = input.filter(Boolean).map(normalizeRange);

    if (!this.multiple && next.length > 1) {
      throw new TypeError("RangeSelectionModel accepts one range in single mode.");
    }

    const oldRanges = this.get();
    if (sameRanges(oldRanges, next)) {
      return false;
    }

    const mutation = normalizeMutationOptions(options);
    const event = {
      source: this,
      oldRanges,
      ranges: next.map(cloneRange),
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    const revision = this._revision;
    if (!mutation.silent) {
      this.events.emit("beforeChange", event);
    }
    if (this._destroyed || this._revision !== revision || event.cancel) {
      return false;
    }

    this._ranges = next.map(cloneRange);
    const appliedRevision = ++this._revision;
    const applied = { ...event, ranges: this.get() };
    delete applied.cancel;
    this.events.emit("invalidate", { ...applied, oldRanges: oldRanges.map(cloneRange),
      ranges: this.get(), silent: mutation.silent });
    if (this._destroyed || this._revision !== appliedRevision) return true;
    if (!mutation.silent) {
      this.events.emit("change", applied);
      if (!this._destroyed && this._revision === appliedRevision) this.events.emit("afterChange", { ...applied });
    }
    return true;
  }

  add(range, options = {}) {
    this._assertUsable("add");
    return this.set(this.multiple ? [...this._ranges, range] : [range], options);
  }

  clear(options = {}) {
    return this.set([], options);
  }

  hasAny() {
    this._assertUsable("hasAny");
    return this._ranges.length > 0;
  }

  destroy() {
    if (this._destroyed) return;
    this._ranges = [];
    this._destroyed = true;
    this.events.destroy();
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed RangeSelectionModel.`);
    }
  }
}

function normalizeRange(range) {
  if (!range || typeof range !== "object") {
    throw new TypeError("Cell range must be an object.");
  }
  return {
    anchor: normalizeCell(range.anchor ?? range.from),
    focus: normalizeCell(range.focus ?? range.to ?? range.anchor ?? range.from)
  };
}

function normalizeCell(cell) {
  if (!cell || typeof cell !== "object" || cell.rowId == null || cell.columnId == null) {
    throw new TypeError("Range cell requires rowId and columnId.");
  }
  return { rowId: cell.rowId, columnId: cell.columnId };
}

function cloneRange(range) {
  return { anchor: { ...range.anchor }, focus: { ...range.focus } };
}

function sameRanges(left, right) {
  return left.length === right.length && left.every((range, index) => {
    const other = right[index];
    return Object.is(range.anchor.rowId, other.anchor.rowId) &&
      range.anchor.columnId === other.anchor.columnId &&
      Object.is(range.focus.rowId, other.focus.rowId) &&
      range.focus.columnId === other.focus.columnId;
  });
}
