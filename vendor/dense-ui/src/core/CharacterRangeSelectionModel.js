import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";

/**
 * Framework-independent selection model for a half-open character range.
 *
 * Positions are zero-based cursor positions. A range from 2 to 5 selects
 * characters 2, 3, and 4. Anchor/focus preserve selection direction while
 * start/end are always normalized.
 */
export class CharacterRangeSelectionModel {
  constructor(options = {}) {
    this.events = new EventBus();
    this._minimum = normalizeBound(options.minimum ?? 0, "minimum");
    this._maximum = normalizeBound(
      options.maximum ?? Number.MAX_SAFE_INTEGER,
      "maximum"
    );
    this._range = null;
    this._destroyed = false;

    if (this._maximum < this._minimum) {
      throw new RangeError("maximum must be greater than or equal to minimum.");
    }

    if (options.range != null) {
      this.set(options.range, { silent: true });
    }
  }

  get destroyed() {
    return this._destroyed;
  }

  get bounds() {
    this._assertUsable("bounds");
    return { minimum: this._minimum, maximum: this._maximum };
  }

  get() {
    this._assertUsable("get");
    return this._range ? { ...this._range } : null;
  }

  set(range, options = {}) {
    this._assertUsable("set");

    if (range == null) {
      return this.clear(options);
    }

    const nextRange = normalizeRange(range, this._minimum, this._maximum);
    const oldRange = this.get();

    if (sameRange(oldRange, nextRange)) {
      return false;
    }

    const mutation = normalizeMutationOptions(options);
    const event = {
      source: this,
      oldRange,
      range: { ...nextRange },
      oldValue: oldRange,
      newValue: { ...nextRange },
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) {
      this.events.emit("beforeChange", event);
    }

    if (event.cancel || this._destroyed) {
      return false;
    }

    this._range = nextRange;

    if (!mutation.silent) {
      const changeEvent = { ...event, range: this.get(), newValue: this.get() };
      delete changeEvent.cancel;
      this.events.emit("change", changeEvent);
      if (!this._destroyed) this.events.emit("afterChange", { ...changeEvent });
    }

    return true;
  }

  clear(options = {}) {
    this._assertUsable("clear");

    if (!this._range) {
      return false;
    }

    const mutation = normalizeMutationOptions(options);
    const oldRange = this.get();
    const event = {
      source: this,
      oldRange,
      range: null,
      oldValue: oldRange,
      newValue: null,
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) {
      this.events.emit("beforeChange", event);
    }

    if (event.cancel || this._destroyed) {
      return false;
    }

    this._range = null;

    if (!mutation.silent) {
      const changeEvent = { ...event };
      delete changeEvent.cancel;
      this.events.emit("change", changeEvent);
      if (!this._destroyed) this.events.emit("afterChange", { ...changeEvent });
    }

    return true;
  }

  collapse(position, options = {}) {
    return this.set({ anchor: position, focus: position }, options);
  }

  hasSelection() {
    this._assertUsable("hasSelection");
    return Boolean(this._range && !this._range.collapsed);
  }

  setBounds(minimum, maximum, options = {}) {
    this._assertUsable("setBounds");
    const nextMinimum = normalizeBound(minimum, "minimum");
    const nextMaximum = normalizeBound(maximum, "maximum");

    if (nextMaximum < nextMinimum) {
      throw new RangeError("maximum must be greater than or equal to minimum.");
    }

    const changed = nextMinimum !== this._minimum || nextMaximum !== this._maximum;
    this._minimum = nextMinimum;
    this._maximum = nextMaximum;

    if (this._range) {
      this.set(this._range, options);
    }

    return changed;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    this._range = null;
    this._destroyed = true;
    this.events.destroy();
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(
        `Cannot call ${operation}() on destroyed CharacterRangeSelectionModel.`
      );
    }
  }
}

function normalizeRange(range, minimum, maximum) {
  if (!range || typeof range !== "object" || Array.isArray(range)) {
    throw new TypeError("Character range must be an object.");
  }

  const usesDirection =
    Object.prototype.hasOwnProperty.call(range, "anchor") ||
    Object.prototype.hasOwnProperty.call(range, "focus");
  const rawAnchor = usesDirection ? range.anchor : range.start;
  const rawFocus = usesDirection ? range.focus : range.end;

  const anchor = clampPosition(rawAnchor, minimum, maximum, "anchor");
  const focus = clampPosition(rawFocus, minimum, maximum, "focus");
  const start = Math.min(anchor, focus);
  const end = Math.max(anchor, focus);

  return {
    anchor,
    focus,
    start,
    end,
    length: end - start,
    collapsed: start === end
  };
}

function clampPosition(value, minimum, maximum, name) {
  const position = Number(value);

  if (!Number.isInteger(position)) {
    throw new TypeError(`${name} must be an integer.`);
  }

  return Math.min(maximum, Math.max(minimum, position));
}

function normalizeBound(value, name) {
  const result = Number(value);

  if (!Number.isSafeInteger(result)) {
    throw new TypeError(`${name} must be a safe integer.`);
  }

  return result;
}

function sameRange(left, right) {
  if (left === right) {
    return true;
  }

  return Boolean(
    left &&
      right &&
      left.anchor === right.anchor &&
      left.focus === right.focus
  );
}
