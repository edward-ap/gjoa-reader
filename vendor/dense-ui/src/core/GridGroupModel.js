import { EventBus } from "./EventBus.js";

export class GridGroupModel {
  constructor(options = {}) {
    this.events = new EventBus();
    this._rules = normalizeRules(options.rules ?? []);
    this._collapsed = new Set(options.collapsed ?? []);
    this._destroyed = false;
  }
  get destroyed() { return this._destroyed; }
  get() { this._assert(); return this._rules.map(rule => ({ ...rule })); }
  hasAny() { this._assert(); return this._rules.length > 0; }
  set(rules, options = {}) {
    this._assert();
    this._rules = normalizeRules(rules);
    this._emit("rules", options);
    return true;
  }
  clear(options = {}) { return this.set([], options); }
  toggle(path, options = {}) {
    this._assert();
    this._collapsed.has(path) ? this._collapsed.delete(path) : this._collapsed.add(path);
    const expanded = !this._collapsed.has(path);
    this._emit("toggle", options);
    return expanded;
  }
  entries(items, getValue) {
    this._assert();
    if (!this._rules.length) return items.map((item, rowIndex) => ({ type: "item", item, rowIndex }));
    return groupLevel(items.map((item, rowIndex) => ({ item, rowIndex })), this._rules, 0, "", getValue, this._collapsed);
  }
  getState() { return { rules: this.get(), collapsed: [...this._collapsed] }; }
  restoreState(state, options = {}) {
    this._assert();
    this._rules = normalizeRules(state?.rules ?? []);
    this._collapsed = new Set(state?.collapsed ?? []);
    this._emit("restore", options);
  }
  destroy() { if (this._destroyed) return; this._destroyed = true; this._rules=[]; this._collapsed.clear(); this.events.destroy(); }
  _emit(operation, options) {
    this.events.emit("invalidate", { source: this, operation });
    if (!options.silent && !this._destroyed) this.events.emit("change", { source:this, operation, state:this.getState(),
      origin:options.origin??"api", userAction:options.userAction===true });
  }
  _assert() { if (this._destroyed) throw new Error("GridGroupModel is destroyed."); }
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) throw new TypeError("Grid groups must be an array.");
  return rules.map(rule => typeof rule === "string" ? { columnId: rule } : {
    columnId: rule?.columnId ?? rule?.column,
    label: rule?.label ?? null,
    summaries: Array.isArray(rule?.summaries) ? rule.summaries.map(summary => ({ ...summary })) : []
  }).map(rule => {
    if (rule.columnId == null) throw new TypeError("Grid group rule requires columnId.");
    return rule;
  });
}

function groupLevel(rows, rules, level, parentPath, getValue, collapsed) {
  if (level >= rules.length) return rows.map(row => ({ type:"item", ...row }));
  const rule = rules[level];
  const buckets = new Map();
  for (const row of rows) {
    const value = getValue(row.item, rule.columnId, row.rowIndex);
    const key = value == null || value === "" ? "(Empty)" : String(value);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const result = [];
  for (const [key, members] of buckets) {
    const path = `${parentPath}/${rule.columnId}:${key}`;
    const isCollapsed = collapsed.has(path);
    result.push({ type:"group", level, key, path, columnId:rule.columnId,
      label:rule.label ?? key, count:members.length, collapsed:isCollapsed, items:members.map(row=>row.item),
      summaries: resolveGroupSummaries(rule.summaries ?? [], members, getValue) });
    if (!isCollapsed) result.push(...groupLevel(members, rules, level + 1, path, getValue, collapsed));
  }
  return result;
}

function resolveGroupSummaries(summaries, members, getValue) {
  return summaries.map(summary => {
    const values = members.map(row => Number(getValue(row.item, summary.columnId, row.rowIndex))).filter(Number.isFinite);
    let value;
    switch (summary.kind) {
      case "count": value = members.length; break;
      case "min": value = values.length ? Math.min(...values) : null; break;
      case "max": value = values.length ? Math.max(...values) : null; break;
      case "average": value = values.length ? values.reduce((a,b)=>a+b,0)/values.length : null; break;
      default: value = values.reduce((a,b)=>a+b,0); break;
    }
    return { ...summary, value };
  });
}
