import { SelectionModel } from "../core/SelectionModel.js";
import { selectionMutationGuard } from "../core/selectionMutationGuard.js";

function usable(grid) {
  return !grid.destroyed && !grid._destroyingGrid && !grid.selection.destroyed &&
    !grid.data.destroyed && !(grid.view ?? grid.treeView).destroyed;
}

function sameItems(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function synchronize(grid, revision) {
  if (!usable(grid)) return;
  grid._reconcileSelection();
  const current = () => usable(grid) && grid._selectionSyncRevision === revision;
  if (!current()) return;
  grid._syncSelectionState();
  if (!current()) return;
  grid._renderFooter?.();
  if (!current()) return;
  grid._renderStatusBar?.();
}

/** Models synchronize through invalidate; change remains a semantic notification. */
export function bindGridSelection(grid) {
  grid._selectionSyncRevision = 0;
  const technical = grid.selection instanceof SelectionModel;
  grid.disposables.add(grid.selection.events.on("invalidate", () => {
    if (!usable(grid)) return;
    synchronize(grid, ++grid._selectionSyncRevision);
  }));
  grid.disposables.add(grid.selection.events.on("change", event => {
    if (!usable(grid)) return;
    // Preserve legacy structural models which only provide change notifications.
    if (!technical) synchronize(grid, ++grid._selectionSyncRevision);
    if (!usable(grid) || !sameItems(event.items, grid.selection.get())) return;
    grid.events.emit("selectionChange", {
      source: grid, items: event.items, oldItems: event.oldItems,
      origin: event.origin, userAction: event.userAction
    });
  }));
}

/** Resolve the request once, then stop after callbacks supersede its context. */
export function setGridSelectedIds(grid, ids, options = {}) {
  const view = grid.view ?? grid.treeView;
  const data = grid.data;
  const nextIds = Array.isArray(ids) ? ids : [ids];
  const items = nextIds.flatMap(id => {
    const item = view.get(id);
    return item ? [item] : [];
  });
  if (!grid.multiSelect && items.length > 1) {
    throw new TypeError(`${grid.treeView ? "TreeGrid" : "Grid"} single selection cannot select multiple ids.`);
  }
  const attempt = grid._selectionAttempt = (grid._selectionAttempt ?? 0) + 1;
  const revision = grid._selectionSyncRevision ?? 0;
  let interrupted = false;
  const subscriptions = [data, view].map(model =>
    model.events.on("invalidate", () => { interrupted = true; }));
  const sameContext = () => usable(grid) && grid.data === data && (grid.view ?? grid.treeView) === view &&
    !interrupted && grid._selectionAttempt === attempt;
  try {
    const changed = grid.selection.set(items, { ...options, [selectionMutationGuard]: sameContext });
    const current = () => sameContext() &&
      grid._selectionSyncRevision <= revision + (changed ? 1 : 0) &&
      sameItems(grid.selection.get(), items);
    if (!current()) return changed;
    const firstItem = items[0] ?? null;
    if (firstItem) {
      const id = view.idOf(firstItem);
      if (!current()) return changed;
      grid._activeId = id;
    } else if (grid._activeId != null && !view.get(grid._activeId)) {
      grid._activeId = null;
    }
    grid._syncSelectionState();
    if (!current()) return changed;
    if (firstItem) grid._scrollActiveIntoView();
    if (current()) grid._renderStatusBar?.();
    return changed;
  } finally {
    subscriptions.forEach(subscription => subscription.dispose());
  }
}
