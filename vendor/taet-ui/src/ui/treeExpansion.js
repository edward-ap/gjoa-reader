// Observe writes without copying an entire store for each node expansion.
export function watchTreeData(owner) {
  const data = owner.data;
  const view = owner.treeView;
  let changed = false;
  const subscriptions = ['invalidate', 'change'].map(type =>
    data.events.on(type, () => { changed = true; }));
  return {
    current: () => !changed && !owner.destroyed && !owner._destroyingTree &&
      !data.destroyed && !view.destroyed && owner.data === data && owner.treeView === view,
    dispose: () => subscriptions.forEach(subscription => subscription.dispose())
  };
}

export function changeTreeExpansion(owner, method, id, options, beforeType) {
  if (owner._preparingTreeExpansion || owner._destroyingTree) return false;
  const view = owner.treeView;
  const single = method === 'expand' || method === 'collapse';
  const expanding = method === 'expand';
  if (single && (view.isExpanded(id) === expanding || (expanding && !view.hasChildren(id)))) return false;
  const revision = owner._treeExpansionRevision = (owner._treeExpansionRevision ?? 0) + 1;
  const watching = watchTreeData(owner);
  const current = () => watching.current() && revision === owner._treeExpansionRevision;
  try {
    if (beforeType && !options.silent) {
      const event = owner._createExpandEvent(beforeType, id, options, { cancel: false });
      owner._preparingTreeExpansion = true;
      try { owner.events.emit(beforeType, event); }
      finally { owner._preparingTreeExpansion = false; }
      if (event.cancel || !current()) return false;
    }
    const changed = single ? view[method](id, options) : view[method](options);
    if (!current() || view._buildingProjection) return changed;
    owner._syncAfterSilentTreeViewChange(changed, options);
    if (!current() || (single && view.isExpanded(id) !== expanding)) return changed;
    if (single) owner._emitExpandEvent(method, id, options);
    else if (!options.silent) owner.events.emit(method, {
      source: owner, origin: options.origin ?? 'api', userAction: options.userAction === true
    });
    return changed;
  } finally {
    watching.dispose();
  }
}
