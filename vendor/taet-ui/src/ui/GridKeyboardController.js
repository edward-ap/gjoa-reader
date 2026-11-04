export class GridKeyboardController {
  constructor(grid) {
    if (!grid) throw new TypeError("GridKeyboardController requires a Grid owner.");
    this.grid = grid;
  }

  handleNavigation(event, options = {}) {
    const grid = this.grid;
    const rows = options.rows ?? [];
    if (!grid || !rows.length) return false;
    const itemOf = options.itemOf ?? (row => row);
    let index = Number(options.activeIndex ?? -1);
    const mutation = { origin:"user", userAction:true };
    const activate = item => {
      const previousId = grid._activeId;
      const id = grid._idOf(item);
      grid._setActiveItem(item, mutation);
      if (this.grid === grid && !grid.destroyed && Object.is(grid._activeId, id)) {
        grid._selectionController?._selectFromNavigation(item, event, previousId);
      }
    };
    const ensureActiveColumn = () => {
      if (grid._activeColumnId == null) {
        grid._activeColumnId = grid._visibleColumns()[0]?.id ?? null;
      }
    };

    switch (event.key) {
      case "ArrowDown":
        ensureActiveColumn();
        index = Math.min(rows.length - 1, Math.max(-1, index) + 1);
        activate(itemOf(rows[index]));
        return true;
      case "ArrowUp":
        ensureActiveColumn();
        index = index < 0 ? 0 : Math.max(0, index - 1);
        activate(itemOf(rows[index]));
        return true;
      case "Home":
        ensureActiveColumn();
        activate(itemOf(rows[0]));
        return true;
      case "End":
        ensureActiveColumn();
        activate(itemOf(rows.at(-1)));
        return true;
      case "ArrowLeft":
        ensureActiveColumn();
        if (options.onLeft?.(mutation) !== true) grid._moveActiveColumn(-1, mutation);
        return true;
      case "ArrowRight":
        ensureActiveColumn();
        if (options.onRight?.(mutation) !== true) grid._moveActiveColumn(1, mutation);
        return true;
      default:
        return false;
    }
  }

  destroy() {
    this.grid = null;
  }
}
