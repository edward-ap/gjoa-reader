import { registerSortView, synchronizeViewSort, releaseViewSort } from "./viewSortBinding.js";
import { EventBus } from "./EventBus.js";
import { registerFilterView, composeViewFilter, getViewFilter, finishViewFilterChange, releaseViewFilter } from "./viewFilterBinding.js";
import { normalizeMutationOptions } from "./mutationOptions.js";
import { stableItemUpdate, stableStoreIdentity } from "./projectionDependencies.js";
import { buildProjection, deferProjection } from "./projectionBuild.js";

export class TreeDataView {
  constructor(options = {}) {
    if (!options.data) {
      throw new TypeError("TreeDataView requires a DataStore.");
    }

    assertDataStore(options.data);

    this.data = options.data;
    this.parentField = options.parentField ?? "parentId";
    this.rootParentId = options.rootParentId ?? null;
    this.events = new EventBus();
    registerFilterView(this);
    registerSortView(this);
    this._filter = typeof options.filter === "function" ? options.filter : null;
    this._sort = typeof options.sort === "function" ? options.sort : null;
    this._expandedIds = new Set(options.expandedIds ?? []);
    this._entries = [];
    this._entriesById = new Map();
    this._destroyed = false;
    this._dataRevision = 0;
    this._expansionRevision = 0;
    this._children = null;
    this._locations = new Map();
    this._dataSubscription = this.data.events.on("invalidate", event => {
      if (this._destroyed) return;
      ++this._dataRevision;
      ++this._expansionRevision;
      if (!this._buildingProjection && this._replaceItem(event)) return;
      this._children = null;
      this.refresh({
        origin: event.origin ?? "system",
        reason: event.operation ?? "data-change",
        userAction: event.userAction === true,
        silent: event.silent === true
      });
    });

    if (options.expandAll === true) {
      this.expandAll({
        silent: true,
        origin: "system"
      });
    } else {
      this._rebuild();
    }
  }

  get destroyed() {
    return this._destroyed;
  }

  all() {
    this._assertUsable("all");
    return this._entries.map(entry => entry.item);
  }

  entries() {
    this._assertUsable("entries");
    return this._entries.map(copyEntry);
  }

  get(id) {
    this._assertUsable("get");
    return this._entriesById.get(id)?.item;
  }

  getEntry(id) {
    this._assertUsable("getEntry");
    const entry = this._entriesById.get(id);
    return entry ? copyEntry(entry) : null;
  }

  has(id) {
    this._assertUsable("has");
    return this._entriesById.has(id);
  }

  idOf(item, index = -1) {
    this._assertUsable("idOf");
    return this.data.idOf(item, index);
  }

  parentIdOf(item) {
    this._assertUsable("parentIdOf");
    return getParentId(item, this.parentField, this.rootParentId);
  }

  hasChildren(id) {
    this._assertUsable("hasChildren");
    if (!stableStoreIdentity(this.data)) return this.data.all().some(item => Object.is(this.parentIdOf(item), id));
    this._ensureChildren();
    return (this._children.get(toParentKey(id))?.length ?? 0) > 0;
  }

  isExpanded(idOrItem) {
    this._assertUsable("isExpanded");
    return this._expandedIds.has(this._normalizeItemId(idOrItem));
  }

  getExpandedIds() {
    this._assertUsable("getExpandedIds");
    return [...this._expandedIds];
  }

  getFilter() { this._assertUsable("getFilter"); return getViewFilter(this, this._filter); }
  getSort() { this._assertUsable("getSort"); return this._sort; }

  setFilter(filter, options = {}) {
    this._assertUsable("setFilter");
    if (this._buildingProjection && (filter ?? null) === this.getFilter()) return false;
    if (filter != null && typeof filter !== "function") throw new TypeError("TreeDataView filter must be a function or null.");
    filter = composeViewFilter(this, filter);
    if (this._filter === filter) return finishViewFilterChange(this, false);
    this._filter = filter;
    return finishViewFilterChange(this, this.refresh({ ...options, reason:options.reason ?? "filter" }));
  }

  setSort(sort, options = {}) {
    this._assertUsable("setSort");
    if (sort != null && typeof sort !== "function") throw new TypeError("TreeDataView sort must be a function or null.");
    if (this._sort === sort) return false;
    this._sort = sort;
    synchronizeViewSort(this, this._sort);
    if (this._destroyed) return false;
    return this.refresh({ ...options, reason:options.reason ?? "sort" });
  }

  expand(idOrItem, options = {}) {
    this._assertUsable("expand");
    const id = this._normalizeItemId(idOrItem);

    if (this._expandedIds.has(id) || !this.hasChildren(id)) {
      return false;
    }

    this._expandedIds.add(id);
    const revision = ++this._expansionRevision;
    const changed = this._changeExpansion(id, { ...options, reason: options.reason ?? "expand" });
    if (revision === this._expansionRevision) this._emitExpandEvent("expand", id, options);
    return changed;
  }

  collapse(idOrItem, options = {}) {
    this._assertUsable("collapse");
    const id = this._normalizeItemId(idOrItem);

    if (!this._expandedIds.has(id)) {
      return false;
    }

    this._expandedIds.delete(id);
    const revision = ++this._expansionRevision;
    const changed = this._changeExpansion(id, { ...options, reason: options.reason ?? "collapse" });
    if (revision === this._expansionRevision) this._emitExpandEvent("collapse", id, options);
    return changed;
  }

  toggle(idOrItem, options = {}) {
    const id = this._normalizeItemId(idOrItem);
    return this.isExpanded(id) ? this.collapse(id, options) : this.expand(id, options);
  }

  expandAll(options = {}) {
    this._assertUsable("expandAll");
    const revision = ++this._expansionRevision;

    for (const item of this.data.all()) {
      const id = this.data.idOf(item);

      if (this.hasChildren(id)) {
        this._expandedIds.add(id);
      }
    }

    const changed = this.refresh({
      ...options,
      reason: options.reason ?? "expand-all"
    });

    if (!options.silent && !this._destroyed && !this._buildingProjection && revision === this._expansionRevision) {
      this.events.emit("expandAll", {
        source: this,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return changed;
  }

  collapseAll(options = {}) {
    this._assertUsable("collapseAll");
    const revision = ++this._expansionRevision;
    this._expandedIds.clear();

    const changed = this.refresh({
      ...options,
      reason: options.reason ?? "collapse-all"
    });

    if (!options.silent && !this._destroyed && !this._buildingProjection && revision === this._expansionRevision) {
      this.events.emit("collapseAll", {
        source: this,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return changed;
  }

  refresh(options = {}) {
    this._assertUsable("refresh");
    if (deferProjection(this, options)) return false;

    const oldEntries = this._entries;

    if (!this._rebuild()) return false;
    const mutation = normalizeMutationOptions(this._projectionMutation ?? options);

    const entries = this._entries;
    const changed = !sameEntryItems(oldEntries, entries);

    if (!changed) {
      return false;
    }

    this._emitProjection(oldEntries, entries, mutation);

    return true;
  }

  _emitProjection(oldEntries, entries, mutation) {
    const event = { source: this,
      origin: mutation.origin, reason: mutation.reason, operation: mutation.operation, userAction: mutation.userAction };
    // Internal sequences and entry wrappers are replaced, never mutated after
    // publication. Capture that version now; copy public snapshots only if read.
    Object.defineProperty(event, projectionSnapshots, { value: { before: oldEntries, after: entries } });
    Object.defineProperties(event, snapshotProperties);
    const invalidation = copyEvent(event);
    invalidation.type = "invalidate"; invalidation.silent = mutation.silent;
    this.events.emit("invalidate", invalidation);
    if (!mutation.silent && !this._destroyed && this._entries === entries) {
      this.events.emit("change", event);
      if (!this._destroyed && this._entries === entries) this.events.emit("afterChange", copyEvent(event));
    }
  }

  _replaceItem(change) {
    if (!this._children || this._filter || this._sort || !stableItemUpdate(this.data, change) ||
      !Object.is(this.parentIdOf(change.oldItem), this.parentIdOf(change.newItem))) return false;
    const location = this._locations.get(change.id);
    if (!location || location.items[location.index] !== change.oldItem) return false;
    location.items[location.index] = change.newItem;
    const entry = this._entriesById.get(change.id);
    if (!entry) return true;
    const oldEntries = this._entries;
    const replacement = copyEntry(entry);
    replacement.item = change.newItem;
    this._entries = [...oldEntries];
    this._entries[oldEntries.indexOf(entry)] = replacement;
    this._entriesById.set(change.id, replacement);
    this._emitProjection(oldEntries, this._entries,
      normalizeMutationOptions({ origin: change.origin ?? "system", reason: change.operation,
        userAction: change.userAction === true, silent: change.silent === true }));
    return true;
  }

  _changeExpansion(id, options) {
    // Opaque filters/comparators may depend on external state: reevaluate them.
    if (this._filter || this._sort || !this._children || !stableStoreIdentity(this.data)) return this.refresh(options);
    const index = this._entries.findIndex(entry => Object.is(entry.id, id));
    if (index < 0) return false;
    const oldEntries = this._entries;
    const entry = copyEntry(oldEntries[index]);
    entry.expanded = this._expandedIds.has(id);
    this._entries = [...oldEntries];
    this._entries[index] = entry;
    this._entriesById.set(id, entry);
    if (entry.expanded) {
      const added = [], stack = [...(this._children.get(toParentKey(id)) ?? [])].reverse().map(item => ({ item, level: entry.level + 1 }));
      while (stack.length) {
        const { item, level } = stack.pop(), childId = this.data.idOf(item);
        const children = this._children.get(toParentKey(childId)) ?? [];
        const expanded = this._expandedIds.has(childId);
        const child = { item, id: childId, parentId: this.parentIdOf(item), level, hasChildren: children.length > 0, expanded };
        added.push(child); this._entriesById.set(childId, child);
        if (expanded) for (let i = children.length - 1; i >= 0; i--) stack.push({ item: children[i], level: level + 1 });
      }
      // Avoid argument-count limits on large branches.
      this._entries = this._entries.slice(0, index + 1).concat(added, this._entries.slice(index + 1));
    } else {
      let end = index + 1;
      while (end < this._entries.length && this._entries[end].level > entry.level) {
        this._entriesById.delete(this._entries[end].id); end++;
      }
      this._entries.splice(index + 1, end - index - 1);
    }
    this._emitProjection(oldEntries, this._entries, normalizeMutationOptions(options));
    return true;
  }

  destroy() {
    releaseViewFilter(this);
    releaseViewSort(this);
    if (this._destroyed) {
      return;
    }

    this._dataSubscription?.dispose();
    this._dataSubscription = null;
    this._entries = [];
    this._entriesById.clear();
    this._expandedIds.clear();
    this._children = null; this._locations.clear();
    this._filter = null;
    this._sort = null;
    this.data = null;
    this._destroyed = true;
    this.events.destroy();
  }

  _ensureChildren() {
    if (this._children) return;
    this._children = new Map(); this._locations.clear();
    for (const item of this.data.all()) {
      const key = toParentKey(this.parentIdOf(item));
      if (!this._children.has(key)) this._children.set(key, []);
      const items = this._children.get(key);
      this._locations.set(this.data.idOf(item), { items, index: items.length });
      items.push(item);
    }
  }

  _rebuild() {
    return buildProjection(this, (check, data, filter, sort) => {
      // Explicit refresh also observes application-owned item changes.
      this._children = null;
      this._ensureChildren();
      check();
      const childrenByParent = new Map([...this._children].map(([key, children]) => [key, [...children]]));

      if (sort) {
        for (const children of childrenByParent.values()) children.sort((left, right) => {
          const order = sort(left, right);
          check();
          return order;
        });
      }

      const includedIds = filter ? new Set() : null;
      if (includedIds) {
        const include = item => {
          const id = data.idOf(item);
          const children = childrenByParent.get(toParentKey(id)) ?? [];
          const childMatches = children.map(include).some(Boolean);
          const matches = filter.call(this, item) || childMatches;
          check();
          if (matches) includedIds.add(id);
          return matches;
        };
        for (const item of childrenByParent.get(toParentKey(this.rootParentId)) ?? []) include(item);
      }

      const entries = [];

      const visit = (parentId, level) => {
        const children = childrenByParent.get(toParentKey(parentId)) ?? [];

        for (const item of children) {
          const id = data.idOf(item);
          if (includedIds && !includedIds.has(id)) continue;
          const hasChildren = (childrenByParent.get(toParentKey(id)) ?? []).length > 0;
          const expanded = includedIds ? true : this._expandedIds.has(id);

          entries.push({
            item,
            id,
            parentId: getParentId(item, this.parentField, this.rootParentId),
            level,
            hasChildren,
            expanded
          });

          if (hasChildren && expanded) {
            visit(id, level + 1);
          }
        }
      };

      visit(this.rootParentId, 0);
      check();
      this._entries = entries;
      this._entriesById = new Map(entries.map(entry => [entry.id, entry]));
    });
  }

  _normalizeItemId(idOrItem) {
    if (idOrItem && typeof idOrItem === "object") {
      return this.data.idOf(idOrItem);
    }

    return idOrItem;
  }

  _emitExpandEvent(type, id, options = {}) {
    if (options.silent || this._destroyed || this._buildingProjection) {
      return;
    }

    this.events.emit(type, {
      source: this,
      id,
      item: this.data.get(id) ?? null,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed TreeDataView.`);
    }
  }
}

function getParentId(item, parentField, rootParentId) {
  return item?.[parentField] ?? rootParentId;
}

function toParentKey(parentId) {
  return `${typeof parentId}:${String(parentId)}`;
}

function sameEntryItems(left, right) {
  return left.length === right.length && left.every((entry, index) => Object.is(entry.id, right[index].id) && entry.item === right[index].item && entry.expanded === right[index].expanded && entry.hasChildren === right[index].hasChildren && entry.level === right[index].level);
}

function copyEntry(entry) {
  // Keep the fixed entry shape identical on rebuild, replacement and snapshot
  // paths; mixed object-spread shapes otherwise increase snapshot allocation.
  return { item: entry.item, id: entry.id, parentId: entry.parentId,
    level: entry.level, hasChildren: entry.hasChildren, expanded: entry.expanded };
}

// Shared accessors avoid per-event getter closures. Keep their state on the
// payload so its snapshots can be collected with it, without a global cache.
const projectionSnapshots = Symbol("treeProjectionSnapshots");
const snapshotProperties = Object.fromEntries(["oldEntries", "entries", "oldIds", "ids"].map(key => [key, {
    enumerable: true, configurable: true,
    get() {
      const state = this[projectionSnapshots];
      if (!state[key]) {
        const entries = key.startsWith("old") ? state.before : state.after;
        state[key] = key === "oldIds" || key === "ids" ? entries.map(entry => entry.id) : entries.map(copyEntry);
        if (state.oldEntries && state.oldIds) state.before = null;
        if (state.entries && state.ids) state.after = null;
      }
      return state[key];
    },
    set(next) {
      Object.defineProperty(this, key, { value: next, writable: true, enumerable: true, configurable: true });
    }
  }]));

function copyEvent(event) {
  // Spreading an event would eagerly invoke every snapshot getter.
  return Object.defineProperties({}, Object.getOwnPropertyDescriptors(event));
}

function assertDataStore(store) {
  if (
    !store ||
    typeof store.all !== "function" ||
    typeof store.get !== "function" ||
    typeof store.idOf !== "function" ||
    !store.events ||
    typeof store.events.on !== "function"
  ) {
    throw new TypeError("TreeDataView data must implement DataStore.");
  }
}
