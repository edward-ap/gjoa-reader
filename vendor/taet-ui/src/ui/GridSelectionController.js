export class GridSelectionController {
  constructor(grid) {
    if (!grid) throw new TypeError("GridSelectionController requires a Grid owner.");
    this.grid = grid;
    this._anchorId = undefined;
  }

  selectFromUser(item, nativeEvent = {}) {
    const grid = this.grid;
    if (!grid || grid.destroyed || grid.disabled || !item) return false;
    if (grid._canSelectItem?.(item) === false) return false;
    grid._activeId = grid._idOf(item);
    const mutation = { origin:"user", userAction:true };

    if (grid.multiSelect && grid.rowRangeSelection && nativeEvent.shiftKey) {
      const rows = grid._rowSelectionItems?.() ?? grid._activeItems();
      if (this.grid !== grid || grid.destroyed) return false;
      const end = rows.indexOf(item);
      if (end < 0) return false;
      let start = rows.findIndex(row => Object.is(grid._idOf(row), this._anchorId));
      const missingAnchor = start < 0;
      if (start < 0) start = end;
      const range = rows.slice(Math.min(start, end), Math.max(start, end) + 1);
      const current = grid.selection.get();
      const next = nativeEvent.ctrlKey || nativeEvent.metaKey
        ? [...new Set([...current, ...range])] : range;
      const unchanged = current.length === next.length && current.every((row, index) => row === next[index]);
      const changed = grid.selection.set(next, mutation);
      if (this.grid === grid && !grid.destroyed && (changed || unchanged) && missingAnchor) {
        this._anchorId = grid._idOf(rows[start]);
      }
      return changed;
    }

    if (grid.multiSelect && (nativeEvent.ctrlKey || nativeEvent.metaKey)) {
      const current = grid.selection.get();
      const next = current.includes(item)
        ? current.filter(selected => selected !== item)
        : [...current, item];
      const changed = grid.selection.set(next, mutation);
      if (changed && this.grid === grid && !grid.destroyed) this._anchorId = grid._idOf(item);
      return changed;
    }
    return this.selectOnly(item, mutation);
  }

  selectOnly(item, options = {}) {
    const grid = this.grid;
    if (!grid || grid.destroyed || grid.disabled || !item) return false;
    if (grid._canSelectItem?.(item) === false) return false;
    const changed = grid.selection.set([item], {
      origin:options.origin ?? "user",
      userAction:options.userAction !== false,
      silent:options.silent === true
    });
    if (this.grid === grid && !grid.destroyed && (changed || grid.selection.get().includes(item))) {
      this._anchorId = grid._idOf(item);
    }
    return changed;
  }

  _selectFromNavigation(item, event, previousId) {
    const grid = this.grid;
    if (!grid || grid.destroyed || !grid.rowRangeSelection) return;
    if (event.shiftKey) {
      if (this._anchorId === undefined) this._anchorId = previousId;
      this.selectFromUser(item, event);
    } else if (!event.ctrlKey && !event.metaKey) {
      this.selectOnly(item);
    }
  }

  selectActive(rows, options = {}) {
    const grid = this.grid;
    if (!grid) return false;
    const itemOf = options.itemOf ?? (row => row);
    const row = rows.find(candidate => Object.is(grid._idOf(itemOf(candidate)), grid._activeId));
    return row ? this.selectOnly(itemOf(row), options) : false;
  }

  destroy() {
    this.grid = null;
    this._anchorId = undefined;
  }
}
