import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";

export class GridFilterModel {
  constructor(options = {}) {
    this.events = new EventBus();
    this._filters = new Map();
    this._destroyed = false;

    if (options.filters) {
      const entries = options.filters instanceof Map
        ? options.filters.entries()
        : Object.entries(options.filters);

      for (const [columnId, filter] of entries) {
        this._filters.set(assertColumnId(columnId), normalizeColumnFilter(filter));
      }
    }
  }

  get destroyed() {
    return this._destroyed;
  }

  get(columnId) {
    this._assertUsable("get");
    const filter = this._filters.get(assertColumnId(columnId));
    return filter ? cloneFilter(filter) : null;
  }

  all() {
    this._assertUsable("all");
    return new Map(
      Array.from(this._filters, ([columnId, filter]) => [columnId, cloneFilter(filter)])
    );
  }

  activeColumns() {
    this._assertUsable("activeColumns");
    return Array.from(this._filters.keys());
  }

  hasAny() {
    this._assertUsable("hasAny");
    return this._filters.size > 0;
  }

  set(columnId, filter, options = {}) {
    this._assertUsable("set");
    const id = assertColumnId(columnId);
    const nextFilter = normalizeColumnFilter(filter);
    const oldFilter = this._filters.get(id) ?? null;

    if (sameFilter(oldFilter, nextFilter)) {
      return false;
    }

    return this._commit(
      {
        operation: "set",
        columnId: id,
        oldFilter: oldFilter ? cloneFilter(oldFilter) : null,
        filter: cloneFilter(nextFilter)
      },
      options,
      () => {
        this._filters.set(id, nextFilter);
      }
    );
  }

  clear(columnId, options = {}) {
    this._assertUsable("clear");
    const id = assertColumnId(columnId);
    const oldFilter = this._filters.get(id);

    if (!oldFilter) {
      return false;
    }

    return this._commit(
      {
        operation: "clear",
        columnId: id,
        oldFilter: cloneFilter(oldFilter),
        filter: null
      },
      options,
      () => {
        this._filters.delete(id);
      }
    );
  }

  clearAll(options = {}) {
    this._assertUsable("clearAll");

    if (this._filters.size === 0) {
      return false;
    }

    return this._commit(
      {
        operation: "clearAll",
        columnId: null,
        oldFilters: this.all(),
        filters: new Map(),
        oldFilter: null,
        filter: null
      },
      options,
      () => {
        this._filters.clear();
      }
    );
  }

  matches(item, getValue) {
    this._assertUsable("matches");

    if (typeof getValue !== "function") {
      throw new TypeError("GridFilterModel.matches() requires a value resolver.");
    }

    for (const [columnId, filter] of this._filters) {
      if (!matchesColumnFilter(getValue(item, columnId), filter)) {
        return false;
      }
    }

    return true;
  }

  createPredicate(getValue) {
    this._assertUsable("createPredicate");

    if (!this.hasAny()) {
      return null;
    }

    return item => this.matches(item, getValue);
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    this._filters.clear();
    this._destroyed = true;
    this.events.destroy();
  }

  _commit(eventData, options, apply) {
    const mutation = normalizeMutationOptions(options);
    const beforeEvent = {
      source: this,
      ...eventData,
      origin: mutation.origin,
      reason: mutation.reason,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) {
      this.events.emit("beforeChange", beforeEvent);
    }

    if (beforeEvent.cancel || this._destroyed) {
      return false;
    }

    apply();

    const event = {
      ...beforeEvent,
      activeColumns: this.activeColumns()
    };
    delete event.cancel;

    this.events.emit("invalidate", {
      ...event,
      type: "invalidate",
      silent: mutation.silent
    });

    if (!mutation.silent && !this._destroyed) {
      this.events.emit("change", event);
      if (!this._destroyed) this.events.emit("afterChange", { ...event });
    }

    return true;
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed GridFilterModel.`);
    }
  }
}

// Internal shared helpers; package entries expose the model, not these functions.
export function normalizeColumnFilter(filter) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new TypeError("Grid column filter must be an object.");
  }

  switch (filter.kind) {
    case "values":
      if (!Array.isArray(filter.values)) {
        throw new TypeError("Grid value filter requires a values array.");
      }

      return {
        kind: "values",
        values: uniqueValues(filter.values),
        includeEmpty: filter.includeEmpty === true
      };

    case "text":
      return normalizeTextFilter(filter);

    case "number":
      return normalizeNumberFilter(filter);

    case "date":
      return normalizeDateFilter(filter);

    case "boolean":
      if (typeof filter.value !== "boolean") {
        throw new TypeError("Grid boolean filter value must be boolean.");
      }

      return {
        kind: "boolean",
        value: filter.value
      };

    default:
      throw new TypeError(`Unsupported Grid filter kind: ${String(filter.kind)}.`);
  }
}

function normalizeTextFilter(filter) {
  const operator = normalizeOperator(filter.operator, [
    "contains",
    "equals",
    "startsWith",
    "endsWith",
    "empty",
    "notEmpty"
  ], "text");

  return {
    kind: "text",
    operator,
    value: operator === "empty" || operator === "notEmpty" ? "" : String(filter.value ?? ""),
    caseSensitive: filter.caseSensitive === true
  };
}

function normalizeNumberFilter(filter) {
  const operator = normalizeOperator(filter.operator, [
    "equals",
    "notEquals",
    "greater",
    "greaterOrEqual",
    "less",
    "lessOrEqual",
    "between"
  ], "number");
  const value = normalizeFiniteNumber(filter.value, "value");

  return {
    kind: "number",
    operator,
    value,
    ...(operator === "between"
      ? { valueTo: normalizeFiniteNumber(filter.valueTo, "valueTo") }
      : {})
  };
}

function normalizeDateFilter(filter) {
  const operator = normalizeOperator(filter.operator, [
    "on",
    "before",
    "after",
    "between",
    "empty",
    "notEmpty"
  ], "date");

  if (operator === "empty" || operator === "notEmpty") {
    return {
      kind: "date",
      operator,
      value: ""
    };
  }

  return {
    kind: "date",
    operator,
    value: normalizeDateValue(filter.value, "value"),
    ...(operator === "between"
      ? { valueTo: normalizeDateValue(filter.valueTo, "valueTo") }
      : {})
  };
}

export function matchesColumnFilter(value, filter) {
  switch (filter.kind) {
    case "values":
      return matchesValueFilter(value, filter);
    case "text":
      return matchesTextFilter(value, filter);
    case "number":
      return matchesNumberFilter(value, filter);
    case "date":
      return matchesDateFilter(value, filter);
    case "boolean":
      return value === filter.value;
    default:
      return false;
  }
}

function matchesValueFilter(value, filter) {
  if (filter.includeEmpty && isEmptyValue(value)) {
    return true;
  }

  return filter.values.some(candidate => sameValue(candidate, value));
}

function matchesTextFilter(value, filter) {
  const empty = isEmptyValue(value);

  if (filter.operator === "empty") {
    return empty;
  }

  if (filter.operator === "notEmpty") {
    return !empty;
  }

  const actual = String(value ?? "");
  const expected = filter.value;
  const left = filter.caseSensitive ? actual : actual.toLocaleLowerCase();
  const right = filter.caseSensitive ? expected : expected.toLocaleLowerCase();

  switch (filter.operator) {
    case "equals":
      return left === right;
    case "startsWith":
      return left.startsWith(right);
    case "endsWith":
      return left.endsWith(right);
    case "contains":
    default:
      return left.includes(right);
  }
}

function matchesNumberFilter(value, filter) {
  if (isEmptyValue(value)) {
    return false;
  }

  const actual = Number(value);

  if (!Number.isFinite(actual)) {
    return false;
  }

  switch (filter.operator) {
    case "notEquals":
      return actual !== filter.value;
    case "greater":
      return actual > filter.value;
    case "greaterOrEqual":
      return actual >= filter.value;
    case "less":
      return actual < filter.value;
    case "lessOrEqual":
      return actual <= filter.value;
    case "between": {
      const from = Math.min(filter.value, filter.valueTo);
      const to = Math.max(filter.value, filter.valueTo);
      return actual >= from && actual <= to;
    }
    case "equals":
    default:
      return actual === filter.value;
  }
}

function matchesDateFilter(value, filter) {
  const empty = isEmptyValue(value);

  if (filter.operator === "empty") {
    return empty;
  }

  if (filter.operator === "notEmpty") {
    return !empty;
  }

  const actual = toDateDayNumber(value);

  if (actual == null) {
    return false;
  }

  const expected = toDateDayNumber(filter.value);

  switch (filter.operator) {
    case "before":
      return actual < expected;
    case "after":
      return actual > expected;
    case "between": {
      const to = toDateDayNumber(filter.valueTo);
      return actual >= Math.min(expected, to) && actual <= Math.max(expected, to);
    }
    case "on":
    default:
      return actual === expected;
  }
}

function sameFilter(left, right) {
  if (!left || !right) {
    return left === right;
  }

  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "values") {
    return (
      left.includeEmpty === right.includeEmpty &&
      left.values.length === right.values.length &&
      left.values.every((value, index) => sameValue(value, right.values[index]))
    );
  }

  return Object.keys(left).every(key => sameValue(left[key], right[key])) &&
    Object.keys(left).length === Object.keys(right).length;
}

function cloneFilter(filter) {
  return filter.kind === "values"
    ? {
        ...filter,
        values: [...filter.values]
      }
    : { ...filter };
}

function uniqueValues(values) {
  const result = [];

  for (const value of values) {
    if (!result.some(current => sameValue(current, value))) {
      result.push(value);
    }
  }

  return result;
}

function sameValue(left, right) {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }

  return Object.is(left, right);
}

function isEmptyValue(value) {
  return value == null || value === "";
}

function normalizeOperator(operator, allowed, kind) {
  if (!allowed.includes(operator)) {
    throw new TypeError(
      `Invalid Grid ${kind} filter operator: ${String(operator)}.`
    );
  }

  return operator;
}

function normalizeFiniteNumber(value, fieldName) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new TypeError(`Grid number filter ${fieldName} must be finite.`);
  }

  return number;
}

function normalizeDateValue(value, fieldName) {
  const day = toDateDayNumber(value);

  if (day == null) {
    throw new TypeError(`Grid date filter ${fieldName} must be a valid date.`);
  }

  return new Date(day).toISOString().slice(0, 10);
}

function toDateDayNumber(value) {
  if (isEmptyValue(value)) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();

  if (!Number.isFinite(time)) {
    return null;
  }

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function assertColumnId(columnId) {
  if (typeof columnId !== "string" || columnId.length === 0) {
    throw new TypeError("Grid filter column id must be a non-empty string.");
  }

  return columnId;
}
