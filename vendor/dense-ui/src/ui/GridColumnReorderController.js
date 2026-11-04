export class GridColumnReorderController {
  constructor(grid) {
    if (!grid) throw new TypeError("GridColumnReorderController requires a Grid owner.");
    this.grid = grid;
    this.state = null;
    this._sourceColumn = null;
    this._sourceHeader = null;
  }

  attach(cell, column) {
    if (!this.grid?.columnReorderEnabled) return;
    cell.draggable = true;
    cell.addEventListener("dragstart", event => this.start(event, column));
    cell.addEventListener("dragover", event => this.over(event, column, cell));
    cell.addEventListener("dragleave", () => this.clearMarkers());
    cell.addEventListener("drop", event => this.drop(event, column));
    cell.addEventListener("dragend", () => { if (this._sourceHeader === cell) this.finish(); });
  }

  start(event, column) {
    const grid = this.grid;
    if (!grid || grid.destroyed || grid.disabled || !grid.columnReorderEnabled ||
        grid.getColumn(column.id) !== column || column.hidden === true ||
        event.target.closest?.("button, .dui-grid__resize-handle")) {
      event.preventDefault();
      return false;
    }
    this.finish();
    const state = this.state = { columnId:column.id, side:column.frozen ?? null };
    this._sourceColumn = column;
    this._sourceHeader = event.currentTarget;
    event.dataTransfer?.setData("text/plain", column.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    event.currentTarget.classList.add("dui-grid__header-cell--dragging");
    grid.events.emit("columnDragStart", {
      source:grid, column, columnId:column.id, origin:"user", userAction:true
    });
    if (!this._isCurrent(state) || event.defaultPrevented) {
      this.finish(state); event.preventDefault(); return false;
    }
    return true;
  }

  _isCurrent(state) {
    const grid = this.grid;
    return Boolean(grid && !grid.destroyed && !grid.disabled && grid.columnReorderEnabled &&
      state && this.state === state && grid.getColumn(state.columnId) === this._sourceColumn &&
      this._sourceColumn?.hidden !== true && (this._sourceColumn?.frozen ?? null) === state.side);
  }

  over(event, targetColumn, cell) {
    const state = this.state;
    if (!this._isCurrent(state)) { this.finish(state); return false; }
    if (this.grid.getColumn(targetColumn.id) !== targetColumn || targetColumn.hidden === true || state.side !== (targetColumn.frozen ?? null)) {
      this.clearMarkers(); return false;
    }
    event.preventDefault();
    const rect = cell.getBoundingClientRect();
    const after = event.clientX >= rect.left + rect.width / 2;
    this.clearMarkers();
    cell.classList.add(after ? "dui-grid__header-cell--drop-after" : "dui-grid__header-cell--drop-before");
    this.state.targetId = targetColumn.id;
    this.state.after = after;
    return true;
  }

  drop(event, targetColumn) {
    const grid = this.grid;
    const state = this.state;
    if (!this._isCurrent(state) || grid.getColumn(targetColumn.id) !== targetColumn ||
        targetColumn.hidden === true || state.side !== (targetColumn.frozen ?? null)) {
      this.finish(state); return false;
    }
    event.preventDefault();
    const from = grid.columns.findIndex(column => column.id === state.columnId);
    let to = grid.columns.findIndex(column => column.id === targetColumn.id) + (state.after ? 1 : 0);
    if (from < to) to -= 1;
    const sourceColumn = this._sourceColumn;
    // Release this session before callbacks can start a different drag.
    this.finish(state);
    const changed = grid.moveColumn(state.columnId, to, { origin:"user", userAction:true });
    if (changed && this.grid === grid && !grid.destroyed && grid.getColumn(state.columnId) === sourceColumn) {
      grid.events.emit("columnReorder", {
        source:grid, columnId:state.columnId, oldIndex:from, index:to,
        origin:"user", userAction:true
      });
    }
    return changed;
  }

  clearMarkers() {
    this.grid?._header?.querySelectorAll(
      ".dui-grid__header-cell--drop-before, .dui-grid__header-cell--drop-after"
    ).forEach(cell => cell.classList.remove(
      "dui-grid__header-cell--drop-before", "dui-grid__header-cell--drop-after"
    ));
  }

  finish(expected = this.state) {
    if (this.state !== expected) return;
    this._sourceHeader?.classList.remove("dui-grid__header-cell--dragging");
    this.grid?._header?.querySelectorAll(".dui-grid__header-cell--dragging")
      .forEach(cell => cell.classList.remove("dui-grid__header-cell--dragging"));
    this.clearMarkers();
    this.state = null;
    this._sourceColumn = this._sourceHeader = null;
  }

  destroy() {
    this.finish();
    this.grid = null;
  }
}
