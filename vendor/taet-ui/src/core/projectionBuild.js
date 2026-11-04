const interrupted = Symbol('interruptedProjection');
const MAX_PASSES = 8;

export function assertProjectionCurrent(view) {
  if (view._projectionCheck && !view._projectionCheck()) throw interrupted;
}

export function deferProjection(view, options) {
  if (!view._buildingProjection) return false;
  if (!view._projectionCheck()) view._projectionMutation = options;
  return true;
}

// Build against one version of inputs, then publish atomically. Observable
// writes request a fresh pass after the callback returns, never recursive entry.
export function buildProjection(view, build) {
  view._buildingProjection = true;
  view._projectionMutation = null;
  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const data = view.data, filter = view._filter, sort = view._sort;
      const revision = view._dataRevision, expansion = view._expansionRevision;
      const page = view._page, pageSize = view._pageSize;
      const current = () => !view.destroyed && !data.destroyed && view.data === data &&
        view._dataRevision === revision && view._expansionRevision === expansion &&
        view._filter === filter && view._sort === sort && view._page === page && view._pageSize === pageSize;
      view._projectionCheck = current;
      // Core loops already belong to this pass. Avoid resolving the optional
      // table-facing guard again for every row and comparator invocation.
      const check = () => { if (!current()) throw interrupted; };
      try {
        check();
        build(check, data, filter, sort);
        return true;
      } catch (error) {
        if (error !== interrupted) throw error;
        if (view.destroyed || data.destroyed) return false;
      }
    }
    throw new Error('Projection callbacks did not settle after 8 passes. Keep filter and sort callbacks pure.');
  } finally {
    view._buildingProjection = false;
    view._projectionCheck = null;
  }
}
