import { DataStore } from "./DataStore.js";

// Only toolkit-owned projections declare dependencies. Arbitrary callbacks can
// inspect row indices, other records or external state and always recompute.
const dependencies = new WeakMap();
export function trackProjection(callback, fields) {
  dependencies.set(callback, fields);
  return callback;
}
export function projectionUnaffected(callback, before, after) {
  if (!callback) return true;
  const fields = dependencies.get(callback)?.();
  return Array.isArray(fields) && fields.every(field => Object.is(before[field], after[field]));
}
export function stableItemUpdate(data, event) {
  return stableStoreIdentity(data) &&
    event.operation === "update" && event.oldItem && event.newItem &&
    Object.is(event.newId ?? event.id, event.id) && Object.is(data.idOf(event.newItem), event.id);
}
export function stableStoreIdentity(data) {
  return data instanceof DataStore && data.idOf === DataStore.prototype.idOf && !data.getId;
}
