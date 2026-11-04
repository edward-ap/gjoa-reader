import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";

export class GridSearchModel {
  constructor(options = {}) {
    this.events = new EventBus();
    this._query = String(options.query ?? "");
    this._mode = normalizeMode(options.mode ?? "highlight");
    this._columns = normalizeColumns(options.columns ?? null);
    this._destroyed = false;
  }

  get destroyed() { return this._destroyed; }
  get query() { this._assertUsable("query"); return this._query; }
  get mode() { this._assertUsable("mode"); return this._mode; }
  get columns() { this._assertUsable("columns"); return this._columns ? [...this._columns] : null; }

  getState() {
    this._assertUsable("getState");
    return { query: this._query, mode: this._mode, columns: this.columns };
  }

  set(query, options = {}) {
    this._assertUsable("set");
    return this._change({ query: String(query ?? "") }, options);
  }

  setMode(mode, options = {}) {
    this._assertUsable("setMode");
    return this._change({ mode: normalizeMode(mode) }, options);
  }

  setColumns(columns, options = {}) {
    this._assertUsable("setColumns");
    return this._change({ columns: normalizeColumns(columns) }, options);
  }

  restoreState(state, options = {}) {
    this._assertUsable("restoreState");
    if (!state || typeof state !== "object") throw new TypeError("Grid search state must be an object.");
    return this._change({
      query: String(state.query ?? ""),
      mode: normalizeMode(state.mode ?? "highlight"),
      columns: normalizeColumns(state.columns ?? null)
    }, options);
  }

  clear(options = {}) { return this.set("", options); }
  hasQuery() { this._assertUsable("hasQuery"); return this._query.length > 0; }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._query = "";
    this._columns = null;
    this.events.destroy();
  }

  _change(patch, options) {
    this._assertUsable("change");
    const oldState = this.getState();
    const next = { ...oldState, ...patch };
    if (oldState.query === next.query && oldState.mode === next.mode && sameColumns(oldState.columns, next.columns)) return false;
    const mutation = normalizeMutationOptions(options);
    const event = { source: this, oldState, state: next, origin: mutation.origin,
      userAction: mutation.userAction, cancel: false };
    if (!mutation.silent) this.events.emit("beforeChange", event);
    if (event.cancel || this._destroyed) return false;
    this._query = next.query;
    this._mode = next.mode;
    this._columns = next.columns ? [...next.columns] : null;
    const applied = { ...event, state: this.getState() };
    delete applied.cancel;
    this.events.emit("invalidate", { ...applied, type: "invalidate", silent: mutation.silent });
    if (!mutation.silent && !this._destroyed) {
      this.events.emit("change", applied);
      if (!this._destroyed) this.events.emit("afterChange", { ...applied });
    }
    return true;
  }

  _assertUsable(operation) {
    if (this._destroyed) throw new Error(`Cannot call ${operation}() on destroyed GridSearchModel.`);
  }
}

function normalizeMode(mode) {
  if (mode !== "highlight" && mode !== "filter") {
    throw new TypeError("Grid search mode must be highlight or filter.");
  }
  return mode;
}

function normalizeColumns(columns) {
  if (columns == null) return null;
  if (!Array.isArray(columns)) throw new TypeError("Grid search columns must be an array or null.");
  return [...new Set(columns.map(String))];
}

function sameColumns(left, right) {
  if (left == null || right == null) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
