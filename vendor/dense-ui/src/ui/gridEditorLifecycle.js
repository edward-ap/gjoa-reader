// One owner and one disposal per returned cell editor, including raw adapters
// whose destroy() is not idempotent. Detach before invoking application code.
export function releaseGridEditor(grid, editing = grid._editing) {
  if (!editing || editing.disposed) return;
  editing.disposed = true;
  if (grid._editing === editing) grid._editing = null;
  if (editing.focusFrame != null) cancelAnimationFrame(editing.focusFrame);
  editing.geometrySubscription?.dispose();
  editing.geometrySubscription = null;
  editing.cell?.classList.remove("dui-grid__cell--editing");
  if (editing.cellEditor?.destroyed !== true) editing.cellEditor?.destroy?.();
}

export function mountGridEditor(grid, editing, host, options, validTarget, animationFrame = true) {
  const current = () => !grid.destroyed && grid._editing === editing && !editing.disposed &&
    editing.cellEditor.destroyed !== true && host.parentNode === editing.cell && validTarget();
  const cleanup = () => {
    const needsPaint = grid._editing === editing || host.parentNode === editing.cell;
    releaseGridEditor(grid, editing);
    if (needsPaint && !grid.destroyed && !grid._editing) grid._renderRows();
    return false;
  };
  try {
    const editor = editing.cellEditor;
    for (const method of ["mount", "getValue", "validate", "focus", "destroy"]) {
      if (typeof editor?.[method] !== "function") throw new TypeError(`Grid cell editor must implement ${method}().`);
    }
    if (!validTarget() || grid._editing || editor.destroyed === true) return cleanup();
    grid._editing = editing;
    editing.cell.classList.add("dui-grid__cell--editing");
    editing.cell.replaceChildren(host);
    editor.mount(host);
    if (!current()) return cleanup();
    // Built-in adapters bridge unconsumed keys from their portaled popups.
    if (typeof editor._bindGridKeys === "function") editor._bindGridKeys(event => grid._handleEditorKeyDown(event));
    if (!current()) return cleanup();
    if (typeof editor._syncPopupPosition === "function") {
      editing.geometrySubscription = grid.columnModel.events.on("invalidate", () => {
        queueMicrotask(() => {
          // Layout changes may replace column descriptors without ending the
          // session. Geometry uses live ownership, not the activation snapshot.
          if (!grid.destroyed && !grid.disabled && grid._editing === editing && !editing.disposed &&
              editor.destroyed !== true && host.isConnected && host.parentNode === editing.cell &&
              grid._body?.contains(editing.cell)) editor._syncPopupPosition();
        });
      });
    }
    // The editor is fully mounted: editStart may deliberately commit/cancel it
    // or open a replacement. Factory/mount recursion remains blocked.
    grid._startingEdit = false;
    if (!options.silent) grid.events.emit("editStart", { source: grid, item: editing.item,
      id: editing.id, column: editing.column, columnId: editing.column.id, value: editing.oldValue,
      origin: options.origin ?? "api", userAction: options.userAction === true });
    if (!current()) return cleanup();
    const focus = () => {
      editing.focusFrame = null;
      if (current()) editor.focus();
    };
    if (animationFrame) editing.focusFrame = requestAnimationFrame(focus);
    else queueMicrotask(focus);
    return true;
  } catch (error) {
    try { cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Editor activation and cleanup failed."); }
    throw error;
  }
}

export function gridEditActivation(grid) {
  let activeId = grid._activeId, activeColumnId = grid._activeColumnId;
  const selectedIds = () => {
    if (grid.destroyed || grid.selection.destroyed) return null;
    const ids = [];
    for (const item of grid.selection.get()) {
      if (grid.destroyed) return null;
      ids.push(grid._idOf(item));
    }
    return grid.destroyed || grid.selection.destroyed ? null : ids;
  };
  const initialIds = selectedIds();
  return {
    activate(id, columnId) { activeId = id; activeColumnId = columnId; },
    current() {
      if (grid.destroyed || grid.disabled || !Object.is(grid._activeId, activeId) || grid._activeColumnId !== activeColumnId) return false;
      const ids = selectedIds();
      return initialIds && ids && ids.length === initialIds.length && ids.every((id, index) => Object.is(id, initialIds[index]));
    }
  };
}

// Capture navigation before committing: application callbacks may replace the
// source/schema, collapse a branch or deliberately choose a different target.
function captureNavigation(grid) {
  if (grid.destroyed || grid.disabled) return null;
  const items = grid._rowSelectionItems?.() ?? grid._activeItems();
  if (grid.destroyed || grid.disabled) return null;
  const columns = grid._visibleColumns();
  const ids = items.map(item => grid._idOf(item));
  if (grid.destroyed || grid.disabled) return null;
  return { items, ids, columns, activeId:grid._activeId, activeColumnId:grid._activeColumnId };
}

function navigationCurrent(grid, snapshot, editing) {
  if (!snapshot || grid.destroyed || grid.disabled || grid._editing ||
      !Object.is(grid._activeId, snapshot.activeId) || grid._activeColumnId !== snapshot.activeColumnId) return false;
  const current = captureNavigation(grid);
  return current && current.items.length === snapshot.items.length &&
    current.columns.length === snapshot.columns.length &&
    current.columns.every((column, index) => column === snapshot.columns[index]) &&
    current.ids.every((id, index) => Object.is(id, snapshot.ids[index]) &&
      current.items[index] === (Object.is(id, editing.id) ? editing.committedItem ?? editing.item : snapshot.items[index]));
}

export function startAdjacentGridEdit(grid, editing, direction, isEditable, snapshot = null) {
  if (!editing || grid.destroyed || grid.disabled || grid._editing) return "stale";
  snapshot ??= captureNavigation(grid);
  if (!navigationCurrent(grid, snapshot, editing)) return "stale";
  const { items, columns, ids } = snapshot;
  const rowIndex = ids.findIndex(id => Object.is(id, editing.id));
  const columnIndex = columns.findIndex(column => column.id === editing.column.id);
  if (rowIndex < 0 || columnIndex < 0) return "stale";
  const count = items.length * columns.length;
  let changed = false;
  // Editability callbacks are application code. Observe their writes without
  // rescanning a large projection once per skipped read-only cell.
  const subscriptions = [grid.data, grid.view ?? grid.treeView, grid.columnModel, grid.groups]
    .filter(Boolean).map(model => model.events.on("invalidate", () => { changed = true; }));
  try {
    for (let index = rowIndex * columns.length + columnIndex + direction;
         index >= 0 && index < count; index += direction) {
      // Read the current record after a successful write replaced the edited item.
      const item = grid._itemById(ids[Math.floor(index / columns.length)]);
      const column = columns[index % columns.length];
      const editable = isEditable(column, item);
      if (changed || grid.destroyed || grid.disabled || grid._editing ||
          !Object.is(grid._activeId, snapshot.activeId) || grid._activeColumnId !== snapshot.activeColumnId) return "stale";
      if (!editable) continue;
      return grid.startEdit(item, column.id, { origin:"user", userAction:true }) ? "started" : "blocked";
    }
    return "boundary";
  } finally { subscriptions.forEach(subscription => subscription.dispose()); }
}

const tabTargets = 'a[href], area[href], button, input, select, textarea, iframe, object, embed, summary, audio[controls], video[controls], [tabindex], [contenteditable="true"]';

function focusOutsideTable(grid, direction) {
  const root = grid.element;
  if (!root?.isConnected) return false;
  const doc = root.ownerDocument;
  const targets = [...doc.querySelectorAll(tabTargets)].filter(item => (item === root || !root.contains(item)) && item.tabIndex >= 0 &&
    !item.matches(':disabled') && !item.closest('[hidden], [inert]') && item.getClientRects().length &&
    doc.defaultView.getComputedStyle(item).visibility !== 'hidden');
  // Match browser sequential focus order, including explicit positive tabindex.
  targets.sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
  const index = targets.indexOf(root);
  const target = index < 0 ? null : targets[index + direction];
  if (!target) return false;
  target.focus();
  return true;
}

function leaveTableAtDocumentBoundary(grid) {
  const root = grid.element;
  if (!root?.isConnected) return;
  // With no external focus target, release focus to the document. Native Tab
  // cannot reliably do this after commit removed the original editor target:
  // Firefox keeps the newly focused table, Chromium traverses its header.
  // Do not invent a hidden focus stop or mutate application tabindex values.
  const active = root.ownerDocument.activeElement;
  if (root.contains(active)) active.blur();
}

export function handleGridEditorKeyDown(grid, event, isEditable) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || grid.destroyed || grid.disabled || !grid._editing) return;
  if (!['Escape', 'Enter', 'Tab'].includes(event.key)) return;
  event.stopPropagation();
  const mutation = { origin:"user", userAction:true };
  if (event.key === "Escape") {
    event.preventDefault();
    grid.cancelEdit(mutation);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    grid.commitEdit(mutation);
    return;
  }
  const editing = grid._editing;
  const snapshot = captureNavigation(grid);
  if (!snapshot || grid.destroyed || grid._editing !== editing || !grid.commitEdit(mutation)) {
    event.preventDefault();
    return;
  }
  const direction = event.shiftKey ? -1 : 1;
  const result = startAdjacentGridEdit(grid, editing, direction, isEditable, snapshot);
  event.preventDefault();
  if (result === "boundary" && !focusOutsideTable(grid, direction)) leaveTableAtDocumentBoundary(grid);
}
