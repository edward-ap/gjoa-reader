// Internal state synchronization, including comparator changes that keep the
// same row order and therefore do not emit a projection invalidation.
const supported = new WeakSet();
const bindings = new WeakMap();

export function registerSortView(view) { supported.add(view); }

export function bindViewSort(view, synchronize) {
  if (!supported.has(view)) return () => {};
  bindings.set(view, synchronize);
  return () => { if (bindings.get(view) === synchronize) bindings.delete(view); };
}

export function synchronizeViewSort(view, sort) { bindings.get(view)?.(sort); }
export function releaseViewSort(view) { bindings.delete(view); }
