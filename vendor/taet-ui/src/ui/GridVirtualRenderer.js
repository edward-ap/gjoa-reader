import { computeGridRenderRange, resolveGridRowHeight } from "./GridPrimitives.js";

export class GridVirtualRenderer {
  constructor(grid) {
    if (!grid) throw new TypeError("GridVirtualRenderer requires a Grid owner.");
    this.grid = grid;
    this.lastScrollTop = 0;
  }

  getRange(rowCount, virtualRows = this.grid?.virtualRows) {
    const grid = this.grid;
    const rowHeight = this.getRowHeight();
    return computeGridRenderRange({
      rowCount,
      virtualRows,
      body:grid?._body,
      rowHeight,
      overscan:grid?.virtualOverscan ?? 0
    });
  }

  getRowHeight() {
    const grid = this.grid;
    return resolveGridRowHeight(grid?.element, grid?.rowHeight);
  }

  createSpacer(height, position) {
    const spacer = document.createElement("div");
    spacer.className = "dui-grid__row-spacer";
    spacer.dataset.duiGridSpacer = position;
    spacer.style.height = `${height}px`;
    return spacer;
  }

  handleScroll(callback) {
    const grid = this.grid;
    const body = grid?._body;
    if (!grid?.virtualRows || !body || body.scrollTop === this.lastScrollTop) return false;
    this.lastScrollTop = body.scrollTop;
    callback?.();
    return true;
  }

  resetScroll() {
    if (this.grid?._body) this.grid._body.scrollTop = 0;
    this.lastScrollTop = 0;
  }

  scrollIndexIntoView(rowIndex) {
    const body = this.grid?._body;
    if (!body || rowIndex < 0) return false;
    const rowHeight = this.getRowHeight();
    const top = rowIndex * rowHeight;
    const bottom = top + rowHeight;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (bottom > body.scrollTop + body.clientHeight) {
      body.scrollTop = Math.max(0, bottom - body.clientHeight);
    }
    this.lastScrollTop = body.scrollTop;
    return true;
  }

  destroy() {
    this.grid = null;
    this.lastScrollTop = 0;
  }
}
