import { listenUntilPointerUp } from "../core/pointerTracking.js";

export class GridColumnResizer {
  constructor(grid) {
    if (!grid) throw new TypeError("GridColumnResizer requires a Grid owner.");
    this.grid = grid;
    this.state = null;
    this.tracking = null;
  }

  start(event, column) {
    const grid = this.grid;
    if (!grid || grid.disabled || event.button !== 0) return false;
    event.preventDefault();
    event.stopPropagation();
    const startWidth = this._getRenderedWidth(column);
    const adjacentColumn = this._getAdjacentColumn(column);
    const adjacentWidth = adjacentColumn ? this._getRenderedWidth(adjacentColumn) : null;
    this.state = { column, startX:event.clientX, startWidth, adjacentColumn, adjacentWidth };
    grid.element?.classList.add("dui-grid--resizing");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    this.tracking?.dispose();
    this.tracking = listenUntilPointerUp({
      target:window,
      move:moveEvent => this.update(moveEvent),
      up:() => this.finish()
    });
    grid.events.emit("columnResizeStart", {
      source:grid, column, columnId:column.id, width:startWidth,
      origin:"user", userAction:true
    });
    return true;
  }

  update(event) {
    const grid = this.grid;
    if (!grid || !this.state) return false;
    const rawDelta = event.clientX - this.state.startX;
    const delta = this.state.adjacentColumn
      ? clampAdjacentDelta(rawDelta, this.state)
      : clampColumnWidth(this.state.startWidth + rawDelta, this.state.column) - this.state.startWidth;
    const width = this.state.startWidth + delta;
    this.state.column.width = this.state.adjacentColumn
      ? responsiveColumnWidth(width, this.state.column)
      : width;
    if (this.state.adjacentColumn) {
      this.state.adjacentColumn.width = responsiveColumnWidth(
        this.state.adjacentWidth - delta,
        this.state.adjacentColumn
      );
    }
    grid._applyColumnTemplate();
    grid.events.emit("columnResize", {
      source:grid, column:this.state.column, columnId:this.state.column.id, width,
      adjacentColumn:this.state.adjacentColumn,
      adjacentColumnId:this.state.adjacentColumn?.id ?? null,
      adjacentWidth:this.state.adjacentColumn?.width ?? null,
      origin:"user", userAction:true
    });
    return true;
  }

  finish() {
    const grid = this.grid;
    const state = this.state;
    this.tracking?.dispose();
    this.tracking = null;
    if (!grid || !state) return false;
    this.state = null;
    grid.element?.classList.remove("dui-grid--resizing");
    grid.events.emit("columnResizeEnd", {
      source:grid, column:state.column, columnId:state.column.id, width:state.column.width,
      origin:"user", userAction:true
    });
    return true;
  }

  destroy() {
    this.tracking?.dispose();
    this.tracking = null;
    this.state = null;
    this.grid?.element?.classList.remove("dui-grid--resizing");
    this.grid = null;
  }

  _getRenderedWidth(column) {
    const id = globalThis.CSS?.escape
      ? CSS.escape(String(column.id))
      : String(column.id).replaceAll('"', '\\"');
    const cell = this.grid?._header?.querySelector(`[data-dui-grid-column-id="${id}"]`);
    return clampColumnWidth(cell?.getBoundingClientRect().width ?? parseColumnWidth(column.width), column);
  }

  _getAdjacentColumn(column) {
    const body = this.grid?._body;
    if (body && body.scrollWidth > body.clientWidth + 1) return null;
    const columns = this.grid?._visibleColumns?.() ?? [];
    const index = columns.indexOf(column);
    return index >= 0 ? columns[index + 1] ?? null : null;
  }
}

export function clampColumnWidth(width, column) {
  const minWidth = column.minWidth == null ? 48 : Number(column.minWidth);
  const maxWidth = column.maxWidth == null ? Infinity : Number(column.maxWidth);
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
}

function parseColumnWidth(width) {
  if (typeof width === "number") return width;
  const parsed = Number.parseFloat(width);
  return Number.isFinite(parsed) ? parsed : 120;
}

function clampAdjacentDelta(delta, state) {
  const left = columnLimits(state.column);
  const right = columnLimits(state.adjacentColumn);
  const minimum = Math.max(left.min - state.startWidth, state.adjacentWidth - right.max);
  const maximum = Math.min(left.max - state.startWidth, state.adjacentWidth - right.min);
  return Math.max(minimum, Math.min(maximum, Math.round(delta)));
}

function columnLimits(column) {
  const min = column.minWidth == null ? 48 : Number(column.minWidth);
  const max = column.maxWidth == null ? Infinity : Number(column.maxWidth);
  return { min, max };
}

function responsiveColumnWidth(weight, column) {
  const min = column.minWidth == null ? 48 : Number(column.minWidth);
  return `minmax(${Math.max(0, min)}px, ${Math.max(1, Math.round(weight * 1000) / 1000)}fr)`;
}
