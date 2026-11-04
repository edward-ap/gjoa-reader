import { registerSortView, synchronizeViewSort, releaseViewSort } from "./viewSortBinding.js";
import { EventBus } from "./EventBus.js";
import { registerFilterView, composeViewFilter, getViewFilter, getViewFilterReceiver, finishViewFilterChange, releaseViewFilter } from "./viewFilterBinding.js";
import { normalizeMutationOptions } from "./mutationOptions.js";
import { projectionUnaffected, stableItemUpdate, stableStoreIdentity } from "./projectionDependencies.js";
import { buildProjection, deferProjection } from "./projectionBuild.js";

export class DataView {
  constructor(options = {}) {
    if (!options.data) {
      throw new TypeError("DataView requires a DataStore.");
    }

    assertDataStore(options.data);

    this.data = options.data;
    this.events = new EventBus();
    registerFilterView(this);
    registerSortView(this);
    this._filter = normalizeFilter(options.filter ?? null);
    this._sort = normalizeSort(options.sort ?? null);
    this._pageSize = normalizePageSize(options.pageSize ?? null);
    this._page = normalizePage(options.page ?? 1);
    this._projectionItems = [];
    this._items = [];
    this._itemsById = new Map();
    this._projectionIndex = new Map();
    this._ids = [];
    this._destroyed = false;
    this._dataRevision = 0;
    this._projectionVersion = 0;
    this._dataSubscription = this.data.events.on("invalidate", event => {
      if (this._destroyed) return;
      ++this._dataRevision;
      if (!this._buildingProjection && this._replaceItem(event)) return;
      this.refresh({
        origin: event.origin ?? "system",
        reason: event.operation ?? "data-change",
        userAction: event.userAction === true,
        silent: event.silent === true
      });
    });

    this._rebuild();
  }

  get destroyed() {
    return this._destroyed;
  }

  all() {
    this._assertUsable("all");
    return [...this._items];
  }

  projectedAll() {
    this._assertUsable("projectedAll");
    return [...this._projectionItems];
  }

  get(id) {
    this._assertUsable("get");
    return this._itemsById.get(id);
  }

  has(id) {
    this._assertUsable("has");
    return this._itemsById.has(id);
  }

  idOf(item, index = -1) {
    this._assertUsable("idOf");
    return this.data.idOf(item, index);
  }

  indexOf(idOrItem) {
    this._assertUsable("indexOf");

    const id =
      idOrItem && typeof idOrItem === "object" ? this.idOf(idOrItem) : idOrItem;

    return this._items.findIndex((item, index) => Object.is(this.idOf(item, index), id));
  }

  setFilter(filter, options = {}) {
    this._assertUsable("setFilter");
    if (this._buildingProjection && (filter ?? null) === this.getFilter()) return false;
    const oldPageState = this.getPageState();
    this._filter = composeViewFilter(this, normalizeFilter(filter));

    if (options.keepPage !== true) {
      this._page = 1;
    }

    return finishViewFilterChange(this, this.refresh({
      ...options,
      _oldPageState: oldPageState,
      reason: options.reason ?? "filter"
    }));
  }

  clearFilter(options = {}) {
    return this.setFilter(null, {
      ...options,
      reason: options.reason ?? "filter-clear"
    });
  }

  getFilter() {
    this._assertUsable("getFilter");
    return getViewFilter(this, this._filter);
  }

  setSort(sort, options = {}) {
    this._assertUsable("setSort");
    if (this._buildingProjection && (sort ?? null) === this._sort) return false;
    const oldPageState = this.getPageState();
    this._sort = normalizeSort(sort);
    synchronizeViewSort(this, this._sort);
    if (this._destroyed) return false;

    if (options.keepPage !== true) {
      this._page = 1;
    }

    return this.refresh({
      ...options,
      _oldPageState: oldPageState,
      reason: options.reason ?? "sort"
    });
  }

  clearSort(options = {}) {
    return this.setSort(null, {
      ...options,
      reason: options.reason ?? "sort-clear"
    });
  }

  getSort() {
    this._assertUsable("getSort");
    return this._sort;
  }

  setPage(page, options = {}) {
    this._assertUsable("setPage");
    const nextPage = normalizePage(page);

    if (this._page === nextPage) {
      return false;
    }

    const oldPageState = this.getPageState();
    this._page = nextPage;
    return this.refresh({
      ...options,
      _oldPageState: oldPageState,
      reason: options.reason ?? "page"
    });
  }

  setPageSize(pageSize, options = {}) {
    this._assertUsable("setPageSize");
    const nextPageSize = normalizePageSize(pageSize);

    if (this._pageSize === nextPageSize) {
      return false;
    }

    const oldPageState = this.getPageState();
    this._pageSize = nextPageSize;

    if (options.keepPage !== true) {
      this._page = 1;
    }

    return this.refresh({
      ...options,
      _oldPageState: oldPageState,
      reason: options.reason ?? "page-size"
    });
  }

  clearPaging(options = {}) {
    return this.setPageSize(null, {
      ...options,
      reason: options.reason ?? "paging-clear"
    });
  }

  getPageState() {
    this._assertUsable("getPageState");
    const filteredCount = this._projectionItems.length;
    const enabled = this._pageSize != null;
    const pageCount = enabled
      ? Math.max(1, Math.ceil(filteredCount / this._pageSize))
      : 1;
    const page = enabled ? Math.min(this._page, pageCount) : 1;
    const from = this._items.length === 0
      ? 0
      : enabled
        ? (page - 1) * this._pageSize + 1
        : 1;

    return {
      enabled,
      page,
      pageSize: this._pageSize,
      pageCount,
      filteredCount,
      pageItemCount: this._items.length,
      from,
      to: this._items.length === 0 ? 0 : from + this._items.length - 1,
      canGoFirst: enabled && page > 1,
      canGoPrevious: enabled && page > 1,
      canGoNext: enabled && page < pageCount,
      canGoLast: enabled && page < pageCount
    };
  }

  refresh(options = {}) {
    this._assertUsable("refresh");
    if (deferProjection(this, options)) return false;

    const oldItems = this.all();
    const oldIds = oldItems.map((item, index) => this.idOf(item, index));
    const oldPageState = options._oldPageState ?? this.getPageState();

    if (!this._rebuild()) return false;
    const mutation = normalizeMutationOptions(this._projectionMutation ?? options);

    const items = this.all();
    const ids = [...this._ids];
    const pageState = this.getPageState();
    const changed =
      !sameIds(oldIds, ids) ||
      !sameItems(oldItems, items) ||
      !samePageState(oldPageState, pageState);

    if (!changed) {
      return false;
    }

    const event = {
      source: this,
      oldItems,
      items,
      oldIds,
      ids,
      oldPageState,
      pageState,
      origin: mutation.origin,
      reason: mutation.reason,
      operation: mutation.operation,
      userAction: mutation.userAction
    };

    this._emitProjection(event, mutation);
    return true;
  }

  _emitProjection(event, mutation) {
    const version = this._projectionVersion;
    const current = () => !this._destroyed && version === this._projectionVersion;
    this.events.emit("invalidate", {
      ...event,
      type: "invalidate",
      silent: mutation.silent
    });

    if (!mutation.silent && current()) {
      this.events.emit("change", event);
      if (current()) this.events.emit("afterChange", { ...event });
    }
  }

  _replaceItem(change) {
    if (!stableItemUpdate(this.data, change) ||
      !projectionUnaffected(this._filter, change.oldItem, change.newItem) ||
      !projectionUnaffected(this._sort, change.oldItem, change.newItem)) return false;
    const index = this._projectionIndex.get(change.id);
    // An excluded row stays excluded when the filter dependencies did not change.
    if (index == null) return true;
    if (this._projectionItems[index] !== change.oldItem) return false;
    ++this._projectionVersion;
    const start = this._pageSize == null ? 0 : (this._page - 1) * this._pageSize;
    const local = index - start;
    if (local < 0 || local >= this._items.length) {
      this._projectionItems[index] = change.newItem;
      return true;
    }
    const oldItems = this.all(), oldIds = [...this._ids], oldPageState = this.getPageState();
    this._projectionItems[index] = change.newItem;
    this._items[local] = change.newItem;
    this._itemsById.set(change.id, change.newItem);
    const mutation = normalizeMutationOptions({ origin: change.origin ?? "system", reason: change.operation,
      userAction: change.userAction === true, silent: change.silent === true });
    const event = { source: this, oldItems, items: this.all(), oldIds, ids: [...this._ids],
      oldPageState, pageState: this.getPageState(), origin: mutation.origin, reason: mutation.reason,
      operation: mutation.operation, userAction: mutation.userAction };
    this._emitProjection(event, mutation);
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
    this._items = [];
    this._projectionItems = [];
    this._itemsById.clear();
    this._projectionIndex.clear(); this._ids = [];
    this._filter = null;
    this._sort = null;
    this._pageSize = null;
    this._page = 1;
    this.data = null;
    this._destroyed = true;
    this.events.destroy();
  }

  _rebuild() {
    return buildProjection(this, (check, data, filter, sort) => {
      let items = data.all();
      check();
      const stableIdentity = stableStoreIdentity(data);
      const filterReceiver = getViewFilterReceiver(this, filter);

      if (filter) {
        items = items.filter((item, index) => {
          const id = data.idOf(item, index);
          if (!stableIdentity) check();
          const matches = filter.call(filterReceiver, item, { index, id, data, view: this });
          check();
          return matches;
        });
      }

      if (sort) {
        items = [...items].sort((left, right) => {
          const order = sort.call(this, left, right, { data, view: this });
          check();
          return order;
        });
      }

      const projectionIndex = new Map();
      let page = 1, start = 0, visible = items;

      if (this._pageSize != null) {
        const pageCount = Math.max(1, Math.ceil(items.length / this._pageSize));
        page = Math.min(this._page, pageCount);
        start = (page - 1) * this._pageSize;
        visible = items.slice(start, start + this._pageSize);
      }

      const itemsById = new Map(), ids = [];
      if (stableIdentity) {
        // Native store IDs do not depend on projection/page indices. Build both
        // lookups together without pair arrays or a second ID lookup per row.
        const end = start + visible.length;
        for (let index = 0; index < items.length; index++) {
          const item = items[index], id = data.idOf(item, index);
          projectionIndex.set(id, index);
          if (index >= start && index < end) {
            ids.push(id);
            itemsById.set(id, item);
          }
        }
      } else {
        visible.forEach((item, index) => {
          const id = data.idOf(item, index);
          check();
          ids.push(id);
          itemsById.set(id, item);
        });
      }
      check();
      this._projectionItems = items;
      this._projectionIndex = projectionIndex;
      this._items = visible;
      this._itemsById = itemsById;
      this._ids = ids;
      this._page = page;
      ++this._projectionVersion;
    });
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed DataView.`);
    }
  }
}

function normalizeFilter(filter) {
  if (filter == null) {
    return null;
  }

  if (typeof filter !== "function") {
    throw new TypeError("DataView filter must be a function.");
  }

  return filter;
}

function normalizeSort(sort) {
  if (sort == null) {
    return null;
  }

  if (typeof sort !== "function") {
    throw new TypeError("DataView sort must be a function.");
  }

  return sort;
}

function normalizePage(page) {
  const parsed = Number(page);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError("DataView page must be a positive integer.");
  }

  return parsed;
}

function normalizePageSize(pageSize) {
  if (pageSize == null || pageSize === false) {
    return null;
  }

  const parsed = Number(pageSize);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError("DataView pageSize must be a positive integer or null.");
  }

  return parsed;
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => Object.is(id, right[index]));
}

function sameItems(left, right) {
  return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
}

function samePageState(left, right) {
  return (
    left.enabled === right.enabled &&
    left.page === right.page &&
    left.pageSize === right.pageSize &&
    left.pageCount === right.pageCount &&
    left.filteredCount === right.filteredCount &&
    left.pageItemCount === right.pageItemCount &&
    left.from === right.from &&
    left.to === right.to
  );
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
    throw new TypeError("DataView data must implement DataStore.");
  }
}
