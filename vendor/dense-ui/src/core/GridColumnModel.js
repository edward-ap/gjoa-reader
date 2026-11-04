import { EventBus } from "./EventBus.js";

export class GridColumnModel {
  constructor(columns = []) {
    this.events = new EventBus();
    this._columns = columns;
    this._destroyed = false;
  }

  get destroyed() { return this._destroyed; }

  all() {
    this._assertUsable("all");
    return [...this._columns];
  }

  visible() {
    this._assertUsable("visible");
    return this._columns.filter(column => column.hidden !== true);
  }

  get(id) {
    this._assertUsable("get");
    return this._columns.find(column => Object.is(column.id, id)) ?? null;
  }

  replace(columns, options = {}) {
    this._assertUsable("replace");
    const oldState = this.getState();
    this._columns = columns;
    this._emitChange("replace", oldState, options);
  }

  move(id, targetIndex, options = {}) {
    this._assertUsable("move");
    const from = this._columns.findIndex(column => Object.is(column.id, id));

    if (from < 0) {
      throw new Error(`Unknown Grid column: ${String(id)}.`);
    }

    const to = Math.max(0, Math.min(this._columns.length - 1, Number(targetIndex)));

    if (from === to) {
      return false;
    }

    const oldState = this.getState();
    const [column] = this._columns.splice(from, 1);
    this._columns.splice(to, 0, column);
    this._emitChange("move", oldState, options);
    return true;
  }

  setHidden(id, hidden, options = {}) {
    return this._setColumnValue(id, "hidden", hidden === true, "visibility", options);
  }

  setFrozen(id, frozen, options = {}) {
    this._assertUsable("setFrozen");
    const value = frozen == null || frozen === false ? null : frozen;

    if (value !== null && value !== "left" && value !== "right") {
      throw new TypeError("Grid frozen column side must be 'left', 'right', or null.");
    }

    return this._setColumnValue(id, "frozen", value, "freeze", options);
  }

  setWidth(id, width, options = {}) {
    return this._setColumnValue(id, "width", width, "width", options);
  }

  getState() {
    this._assertUsable("getState");
    return this._columns.map((column, order) => ({
      id: column.id,
      order,
      width: column.width ?? null,
      hidden: column.hidden === true,
      frozen: column.frozen ?? null
    }));
  }

  restoreState(state, options = {}) {
    this._assertUsable("restoreState");
    if (!Array.isArray(state)) {
      throw new TypeError("Grid column state must be an array.");
    }

    const oldState = this.getState();
    const entries = new Map(state.map(entry => [entry?.id, entry]));

    for (const column of this._columns) {
      const entry = entries.get(column.id);

      if (!entry) {
        continue;
      }

      column.width = entry.width ?? column.width;
      column.hidden = entry.hidden === true;
      column.frozen = entry.frozen === "left" || entry.frozen === "right" ? entry.frozen : null;
    }

    this._columns.sort((left, right) => {
      const leftOrder = Number(entries.get(left.id)?.order);
      const rightOrder = Number(entries.get(right.id)?.order);
      return (Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER) -
        (Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER);
    });

    this._emitChange("restore", oldState, options);
    return true;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.events.destroy();
    this._columns = [];
  }

  _setColumnValue(id, property, value, operation, options) {
    const column = this.get(id);

    if (!column) {
      throw new Error(`Unknown Grid column: ${String(id)}.`);
    }

    if (Object.is(column[property] ?? null, value ?? null)) {
      return false;
    }

    const oldState = this.getState();
    column[property] = value;
    this._emitChange(operation, oldState, options);
    return true;
  }

  _emitChange(operation, oldState, options) {
    const event = {
      source: this,
      operation,
      oldState,
      state: this.getState(),
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };
    this.events.emit("invalidate", { ...event, silent: options.silent === true });
    if (!options.silent && !this._destroyed) this.events.emit("change", event);
  }

  _assertUsable(operation) {
    if (this._destroyed) throw new Error(`Cannot call ${operation}() on destroyed GridColumnModel.`);
  }
}
