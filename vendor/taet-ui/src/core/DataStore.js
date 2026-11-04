import { EventBus } from "./EventBus.js";
import { normalizeMutationOptions } from "./mutationOptions.js";

export class DataStore {
  constructor(options = {}) {
    this.idField = options.idField ?? "id";
    this.getId = options.getId ?? null;
    this.events = new EventBus();

    this._items = [];
    this._itemsById = new Map();
    this._destroyed = false;
    this._revision = 0;
    this._beforeDepth = 0;
    this._transaction = null;
    this._undoStack = [];
    this._redoStack = [];
  }

  get destroyed() {
    return this._destroyed;
  }

  parse(items, options = {}) {
    return this._parse(items, options);
  }

  _parse(items, options, onAccepted, integration = {}) {
    this._assertWritable("parse");
    const revision = this._revision;

    if (!Array.isArray(items)) {
      throw new TypeError("DataStore.parse() expects an array.");
    }

    const nextItems = [...items];
    const nextMap = this._indexItems(nextItems, revision);
    if (!this._isCurrent(revision) || integration.current?.() === false) return false;
    const oldItems = this.all();
    const event = this._createEvent("parse", options, {
      oldItems,
      items: [...nextItems],
      cancel: false
    });

    if (!this._emitBefore(event, revision) || integration.current?.() === false) {
      return false;
    }

    const apply = () => {
      this._items = nextItems;
      this._itemsById = nextMap;
      onAccepted?.();
      this._emitChange(event);
      return true;
    };
    // Internal single-store integrations may open their history batch only
    // after preflight. A callback's independent write is never rolled back.
    return integration.commit ? integration.commit(apply) : apply();
  }

  all() {
    this._assertUsable("all");
    return [...this._items];
  }

  get(id) {
    this._assertUsable("get");
    return this._itemsById.get(id);
  }

  add(item, options = {}) {
    this._assertWritable("add");
    const revision = this._revision;

    const id = this.idOf(item, this._items.length);
    if (!this._isCurrent(revision)) return false;

    if (this._itemsById.has(id)) {
      throw new Error(`Duplicate data item id: ${String(id)}.`);
    }

    const event = this._createEvent("add", options, {
      id,
      item,
      cancel: false
    });

    if (!this._emitBefore(event, revision)) {
      return false;
    }

    this._items.push(item);
    this._itemsById.set(id, item);
    this._emitChange(event);

    return true;
  }

  update(id, patch, options = {}) {
    this._assertWritable("update");
    const revision = this._revision;

    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError("DataStore.update() patch must be an object.");
    }

    const oldItem = this._itemsById.get(id);

    if (!oldItem) {
      return this._handleMissingId("update", id, options);
    }

    const newItem = { ...oldItem, ...patch };
    const newId = this.idOf(newItem, this._items.indexOf(oldItem));
    if (!this._isCurrent(revision)) return false;

    if (newId !== id && this._itemsById.has(newId)) {
      throw new Error(`Duplicate data item id: ${String(newId)}.`);
    }

    if (shallowEqual(oldItem, newItem)) {
      return false;
    }

    const event = this._createEvent("update", options, {
      id,
      item: newItem,
      oldItem,
      newItem,
      patch: { ...patch },
      cancel: false
    });

    if (!this._emitBefore(event, revision)) {
      return false;
    }

    const index = this._items.indexOf(oldItem);
    this._items[index] = newItem;
    this._itemsById.delete(id);
    this._itemsById.set(newId, newItem);

    if (newId !== id) {
      event.newId = newId;
    }

    this._emitChange(event);
    return true;
  }

  remove(id, options = {}) {
    this._assertWritable("remove");
    const revision = this._revision;

    const item = this._itemsById.get(id);

    if (!item) {
      return this._handleMissingId("remove", id, options);
    }

    const event = this._createEvent("remove", options, {
      id,
      item,
      cancel: false
    });

    if (!this._emitBefore(event, revision)) {
      return false;
    }

    this._items = this._items.filter(current => current !== item);
    this._itemsById.delete(id);
    this._emitChange(event);

    return true;
  }

  clear(options = {}) {
    this._assertWritable("clear");
    const revision = this._revision;

    if (this._items.length === 0) {
      return false;
    }

    const oldItems = this.all();
    const event = this._createEvent("clear", options, {
      oldItems,
      items: [],
      cancel: false
    });

    if (!this._emitBefore(event, revision)) {
      return false;
    }

    this._items = [];
    this._itemsById.clear();
    this._emitChange(event);

    return true;
  }

  batch(callback, options = {}) {
    return this._batch(callback, options);
  }

  _batch(callback, options = {}, integration = {}) {
    this._assertWritable("batch");
    if (typeof callback !== "function") throw new TypeError("DataStore.batch() requires a callback.");
    if (this._transaction) return callback(this);
    const before = this.all();
    // Preserve index insertion order independently of row order (ID-changing
    // updates can reorder the map). Build its hash table only on rollback.
    const beforeKeys = [...this._itemsById.keys()];
    const beforeValues = [...this._itemsById.values()];
    this._transaction = { events: [], options };
    let result;
    try {
      result = callback(this);
    } catch (error) {
      if (!this._destroyed) {
        this._items = before;
        const beforeMap = new Map();
        for (let index = 0; index < beforeKeys.length; index++) {
          beforeMap.set(beforeKeys[index], beforeValues[index]);
        }
        this._itemsById = beforeMap;
        ++this._revision;
      }
      this._transaction = null;
      throw error;
    }
    if (this._destroyed) return result;
    const transaction = this._transaction;
    this._transaction = null;
    if (transaction.events.length === 0) return result;
    const after = this.all();
    if (options.history !== false && options.origin !== "undo" && options.origin !== "redo") {
      this._undoStack.push({ before, after });
      this._redoStack = [];
    }
    const event = this._createEvent("batch", options, {
      oldItems: before, items: after, changes: transaction.events
    });
    this._emitChange(event, integration);
    return result;
  }

  canUndo() { this._assertUsable("canUndo"); return this._undoStack.length > 0; }
  canRedo() { this._assertUsable("canRedo"); return this._redoStack.length > 0; }

  undo(options = {}) {
    this._assertWritable("undo");
    if (this._transaction) return false;
    const entry = this._undoStack.at(-1);
    if (!entry) return false;
    return this._parse(entry.before, { ...options, origin: "undo" }, () => {
      this._undoStack.pop();
      this._redoStack.push(entry);
    });
  }

  redo(options = {}) {
    this._assertWritable("redo");
    if (this._transaction) return false;
    const entry = this._redoStack.at(-1);
    if (!entry) return false;
    return this._parse(entry.after, { ...options, origin: "redo" }, () => {
      this._redoStack.pop();
      this._undoStack.push(entry);
    });
  }

  /** Synchronous, local two-store operation; no independent half-commit. */
  transferTo(target, ids, options = {}) {
    return this._transferTo(target, ids, options);
  }

  _transferTo(target, ids, options = {}, integration = {}) {
    let mode = "move";
    const notificationErrors = [];
    const result = { accepted:false, mode, ids:[], sourceIds:[], reason:null, notificationErrors };
    const reject = reason => ({ ...result, reason });
    if (!(target instanceof DataStore) || target.constructor !== DataStore || this.constructor !== DataStore) return reject("unsupported-store");
    if (target === this) return reject("same-store");
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return reject("invalid-ids");
    if (this.destroyed || target.destroyed) return reject("destroyed");
    if ([this,target].some(store => store._transferLock || store._transaction || store._beforeDepth)) return reject("busy");
    const lock = {};
    this._transferLock = target._transferLock = lock;
    const sourceRevision = this._revision, targetRevision = target._revision;
    const current = () => this._isCurrent(sourceRevision) && target._isCurrent(targetRevision) &&
      this._transferLock === lock && target._transferLock === lock && integration.current?.() !== false;
    try {
      mode = options.mode ?? "move"; result.mode = mode;
      if (mode !== "move" && mode !== "copy") return reject("invalid-mode");
      if (options.silent === true) return reject("silent-unsupported");
      if (!current()) return reject("stale");
      const wanted = new Set(ids), originalIds = new Map(this._items.map((row,i) => [row,this.idOf(row,i)]));
      const rows = this._items.filter(row => wanted.has(originalIds.get(row)));
      if (!current()) return reject("stale");
      if (rows.length !== wanted.size) return reject("missing-id");
      const sourceIds = rows.map(row => originalIds.get(row));
      result.sourceIds = [...sourceIds];
      if (!current()) return reject("stale");
      if (rows.some((row,i) => !Object.is(this.idOf(row),sourceIds[i]))) return reject("unstable-ids");
      const incoming = [];
      for (let i=0;i<rows.length;i++) {
        const item = options.mapItem ? options.mapItem(rows[i],i) : mode === "copy" ? {...rows[i]} : rows[i];
        if (!current()) return reject("stale");
        if (!item || typeof item !== "object" || typeof item.then === "function") return reject("invalid-item");
        incoming.push(item);
      }
      const nextTarget = [...target._items,...incoming];
      const targetMap = target._indexItems(nextTarget,targetRevision);
      if (!current()) return reject("stale");
      const targetIds = incoming.map((item,i) => target.idOf(item,target._items.length+i));
      if (!current()) return reject("stale");
      if (incoming.some((item,i) => !Object.is(target.idOf(item),targetIds[i]))) return reject("unstable-ids");
      const moving = new Set(rows);
      const nextSource = this._items.filter(row => !moving.has(row));
      const sourceMap = mode === "move" ? this._indexItems(nextSource,sourceRevision) : this._itemsById;
      if (!current()) return reject("stale");
      if (mode === "move" && nextSource.some((row,i) => !Object.is(this.idOf(row,i),originalIds.get(row)))) return reject("unstable-ids");
      const targetChanges = incoming.map((item,i) => target._createEvent("add",options,{id:targetIds[i],item,cancel:false}));
      const sourceChanges = mode === "move" ? rows.map((item,i) => this._createEvent("remove",options,{id:sourceIds[i],item,cancel:false})) : [];
      const proposal = {mode,ids:[...targetIds],sourceIds:[...sourceIds],items:[...incoming]};
      if (integration.before?.(proposal) === false || !current()) return reject("veto");
      for (const [store,changes,revision] of [[target,targetChanges,targetRevision],[this,sourceChanges,sourceRevision]]) {
        for (const event of changes) {
          if (!store._emitBefore(event,revision)) return reject("veto");
          if (!current()) return reject("stale");
        }
      }
      // Veto callbacks cannot retarget IDs via mutation of trusted row objects.
      const checkedTarget = target._indexItems(nextTarget,targetRevision);
      if (!current()) return reject("stale");
      const plannedTargetIds = [...targetMap.keys()], plannedSourceIds = [...sourceMap.keys()];
      if (nextTarget.some((item,i) => !Object.is(target.idOf(item,i),plannedTargetIds[i]))) return reject("stale-id");
      if (mode === "move" && nextSource.some((row,i) => !Object.is(this.idOf(row,i),plannedSourceIds[i]))) return reject("stale-id");
      if (!current()) return reject("stale");
      const targetOld = target._items, sourceOld = this._items;
      const publications = [[target,targetOld,nextTarget,targetChanges]];
      if (mode === "move") publications.push([this,sourceOld,nextSource,sourceChanges]);
      // Normalize all callback-bearing metadata before the callback-free swap.
      const phases = publications.map(([store,oldItems,items,changes]) => ({store,revision:store._revision + 1,
        event:store._createEvent("batch",options,{oldItems:[...oldItems],items:[...items],changes:changes.map(({silent,...change})=>change)})}));
      if (!current()) return reject("stale");
      // No application callbacks between accepting target and removing source.
      target._items = nextTarget; target._itemsById = checkedTarget; ++target._revision;
      target._undoStack = []; target._redoStack = [];
      if (mode === "move") {
        this._items = nextSource; this._itemsById = sourceMap; ++this._revision;
        this._undoStack = []; this._redoStack = [];
      }
      result.accepted = true; result.ids = [...targetIds];
      for (const {store,revision,event} of phases) store.events._emitCollect("invalidate",{...event,type:"invalidate",silent:false},notificationErrors,()=>store._isCurrent(revision));
      for (const {store,revision,event} of phases) {
        const {silent,...publicEvent} = event;
        store.events._emitCollect("change",publicEvent,notificationErrors,()=>store._isCurrent(revision));
        store.events._emitCollect("afterChange",{...publicEvent},notificationErrors,()=>store._isCurrent(revision));
      }
      return result;
    } catch (error) {
      notificationErrors.push(error);
      return reject(/Duplicate data item id/.test(String(error?.message)) ? "id-conflict" : "callback-error");
    } finally {
      if (this._transferLock === lock) this._transferLock = null;
      if (target._transferLock === lock) target._transferLock = null;
    }
  }

  _assertWritable(operation) {
    this._assertUsable(operation);
    if (this._transferLock) throw new Error("DataStore writes are blocked during row transfer.");
  }

  idOf(item, index = -1) {
    this._assertUsable("idOf");

    if (!item || typeof item !== "object") {
      throw new TypeError("Data item must be an object.");
    }

    const id = this.getId ? this.getId(item, index) : item[this.idField];

    if (!isValidItemId(id)) {
      throw new Error("Data item id must be a string or number.");
    }

    return id;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    this._items = [];
    this._itemsById.clear();
    this._undoStack = [];
    this._redoStack = [];
    this._transaction = null;
    this._destroyed = true;
    this.events.destroy();
  }

  _indexItems(items, revision) {
    const map = new Map();

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const id = this.idOf(item, index);
      if (!this._isCurrent(revision)) return null;

      if (map.has(id)) {
        throw new Error(`Duplicate data item id: ${String(id)}.`);
      }

      map.set(id, item);
    }

    return map;
  }

  _createEvent(operation, options, extra = {}) {
    const mutation = normalizeMutationOptions(options);

    return {
      source: this,
      operation,
      origin: mutation.origin,
      userAction: mutation.userAction,
      ...extra,
      silent: mutation.silent
    };
  }

  _isCurrent(revision) {
    return !this._destroyed && this._revision === revision;
  }

  _emitBefore(event, revision) {
    if (!this._isCurrent(revision)) return false;
    if (event.silent) {
      return true;
    }

    if (this._beforeDepth >= 8) throw new Error('DataStore beforeChange recursion exceeded 8 nested operations.');
    ++this._beforeDepth;
    try {
      this.events.emit("beforeChange", event);
      return this._isCurrent(revision) && event.cancel !== true;
    } finally {
      --this._beforeDepth;
    }
  }

  _emitChange(event, integration = {}) {
    const revision = ++this._revision;
    if (this._transaction) {
      const queued = { ...event };
      delete queued.silent;
      this._transaction.events.push(queued);
      return;
    }
    const publicEvent = { ...event };
    delete publicEvent.silent;

    const emit = (name, payload) => integration.notificationErrors
      ? this.events._emitCollect(name, payload, integration.notificationErrors, () => this._isCurrent(revision))
      : this.events.emit(name, payload);
    emit("invalidate", {
      ...publicEvent,
      type: "invalidate",
      silent: event.silent === true
    });

    if (event.silent || !this._isCurrent(revision)) {
      return;
    }

    emit("change", publicEvent);
    if (this._isCurrent(revision)) emit("afterChange", { ...publicEvent });
  }

  _handleMissingId(operation, id, options) {
    if (options?.strict === true) {
      throw new Error(`Cannot ${operation} missing data item: ${String(id)}.`);
    }

    return false;
  }

  _assertUsable(operation) {
    if (this._destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed DataStore.`);
    }
  }
}

function isValidItemId(id) {
  return typeof id === "string" || typeof id === "number";
}

function shallowEqual(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every(key => Object.is(a[key], b[key]));
}
