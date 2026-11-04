import { gridRowKey } from "./GridPrimitives.js";
import { columnWindow, reconcileChildren, rowAtOffset, rowOffsets, windowRange } from "./gridWindowGeometry.js";

const interruptedPaint = Symbol('interruptedGridPaint');

/** Grid-owned DOM window. Models/events remain synchronous; invalidations share a frame. */
export class GridWindowRenderer {
  constructor(grid) {
    this.grid = grid;
    this.frame = null;
    this.rows = new Map();
    this.details = new Map();
    this.entries = [];
    this.offsets = [0];
    this.rowIndices = new Map();
    this.columnCache = null;
    this.anchor = null;
    this.pendingScrollTop = null;
    this.observer = null;
    this.topSpacer = null;
    this.bottomSpacer = null;
    this.renderedWindow = null;
    this.revision = 0;
    this.painting = false;
    this.paintCheck = null;
    this.interruptedPaints = 0;
  }

  paint(callback) {
    if (this.painting || !this.grid || this.grid.destroyed) return;
    const grid = this.grid, revision = this.revision;
    this.painting = true;
    this.paintCheck = () => {
      if (this.grid !== grid || grid.destroyed || this.revision !== revision) throw interruptedPaint;
    };
    try {
      callback();
      this.assertCurrent();
      this.interruptedPaints = 0;
    } catch (error) {
      this.renderedWindow = null;
      if (error !== interruptedPaint) {
        this.cancel();
        this.invalidateDetails();
        this.interruptedPaints = 0;
        throw error;
      }
      if (this.grid && !grid.destroyed && ++this.interruptedPaints >= 8) {
        this.cancel();
        this.interruptedPaints = 0;
        throw new Error('Grid render callbacks did not settle after 8 passes. Keep render callbacks pure.');
      }
    } finally {
      this.paintCheck = null;
      this.painting = false;
    }
  }

  assertCurrent() { this.paintCheck?.(); }

  request({ scrollOnly = false } = {}) {
    // A model/geometry invalidation wins even when a scroll already queued the frame.
    if (!scrollOnly) { this.renderedWindow = null; this.revision++; }
    if (!this.grid?.mounted || this.grid.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const scrollWindow = this._getScrollWindow();
      if (!scrollWindow?.unchanged) this.grid?._renderRows(scrollWindow);
    });
  }

  _getScrollWindow() {
    const grid = this.grid, previous = this.renderedWindow;
    if (!grid || !previous || previous.revision !== this.revision || grid._editing || this.anchor || this.pendingScrollTop != null ||
        previous.columnCache !== this.columnCache) return null;
    const body = grid._body;
    if (body.clientWidth !== previous.width || body.clientHeight !== previous.height ||
        grid._getVirtualRowHeight() !== previous.rowHeight ||
        grid.virtualRows !== previous.virtualRows || grid.virtualColumns !== previous.virtualColumns ||
        grid.virtualOverscan !== previous.overscan) return null;
    const top = Math.min(body.scrollTop, Math.max(0, this.offsets.at(-1) - body.clientHeight));
    const range = windowRange(this.offsets, top, body.clientHeight, grid.virtualOverscan, grid.virtualRows);
    const layout = this.columns();
    const unchanged = range.start === previous.start && range.end === previous.end &&
      layout.visible.length === previous.columns.length &&
      layout.visible.every((track, index) => track.index === previous.columns[index]);
    return { range, layout, unchanged };
  }

  cancel() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  flush() {
    if (this.frame !== null) { this.cancel(); this.grid?._renderRows(); }
  }

  invalidateColumns() { this.columnCache = null; }

  captureAnchor() {
    if (this.anchor || !this.entries.length) return;
    const index = rowAtOffset(this.offsets, this.grid._body.scrollTop), entry = this.entries[index];
    const fallback = [];
    if (this.grid.treeView) {
      let parent = entry.parentId;
      const seen = new Set();
      while (parent != null && !seen.has(parent)) {
        seen.add(parent); fallback.push(`item:${gridRowKey(parent)}`);
        parent = this.grid.treeView.parentIdOf(this.grid.data.get(parent));
      }
    }
    this.anchor = { key: entry.key, offset: this.grid._body.scrollTop - this.offsets[index], fallback };
  }

  invalidateDetails() {
    this.details.clear();
    for (const record of this.rows.values()) {
      record.detailItem = null;
      record.observedItem = null;
    }
  }

  columns() {
    const grid = this.grid;
    const columns = grid._visibleColumns();
    const width = grid._body.clientWidth;
    if (!this.columnCache || this.columnCache.viewportWidth !== width) {
      // Read used CSS track widths once, before writing any row styles. This also
      // supports fr/minmax/percentage columns without duplicating CSS layout.
      const computed = grid._header.isConnected ? getComputedStyle(grid._header).gridTemplateColumns : "";
      const tracks = computed.trim().split(/\s+/).map(value => /^\d+(\.\d+)?px$/.test(value) ? Number.parseFloat(value) : NaN);
      const indicatorWidth = grid.indicatorGutterEnabled
        ? (Number.isFinite(tracks[0]) && tracks[0] > 0 ? tracks[0] : grid._getIndicatorWidth()) : 0;
      const pixels = grid.indicatorGutterEnabled ? tracks.slice(1) : tracks;
      const measured = pixels.length === columns.length && pixels.every(value => Number.isFinite(value) && value > 0);
      const widths = measured ? pixels : columns.map(column => Math.max(1, Number.parseFloat(column.width) || Number(column.minWidth) || 120));
      // Intrinsic tracks depend on the content of omitted cells; keep those full.
      const intrinsic = columns.some(column => /auto|min-content|max-content/.test(String(column.width ?? "")));
      this.columnCache = { columns, widths, indicatorWidth, viewportWidth: width, virtual: grid.virtualColumns && measured && !intrinsic,
        template: (indicatorWidth ? `${indicatorWidth}px ` : "") + (widths.map(value => `${value}px`).join(" ") || "minmax(0, 1fr)") };
      this._syncFrozenCells(this.columnCache);
    }
    const cache = this.columnCache;
    const layout = columnWindow(cache.columns, cache.widths, grid._body.scrollLeft,
      Math.max(0, width - cache.indicatorWidth), 1, cache.virtual);
    // Geometry keeps data indices unchanged; only physical offsets include the service strip.
    for (const track of layout.tracks) track.left += cache.indicatorWidth;
    layout.totalWidth += cache.indicatorWidth;
    layout.frozenLeft += cache.indicatorWidth;
    // Resizing can hide the edited track without a scroll event. Keep its live
    // editor mounted until the edit completes (scroll/projection changes cancel it).
    const editing = layout.tracks.find(track => track.column.id === grid._editing?.column.id);
    if (editing && !layout.visible.includes(editing)) {
      layout.visible.push(editing);
      layout.visible.sort((a, b) => a.index - b.index);
    }
    return { ...layout, indicatorWidth: cache.indicatorWidth, template: cache.template, virtual: cache.virtual };
  }

  _syncFrozenCells({ columns, widths, indicatorWidth }) {
    // The completed header and body must share measured tracks, including fr.
    // During header construction later siblings do not exist yet; their fallback
    // widths cannot determine right-pinned offsets reliably.
    const headers = new Map([...this.grid._header.children]
      .filter(cell => cell.dataset.duiGridColumnId != null)
      .map(cell => [cell.dataset.duiGridColumnId, cell]));
    const offsets = new Map();
    let left = indicatorWidth, right = 0;
    for (let i = 0; i < columns.length; i++) if (columns[i].frozen === "left") {
      offsets.set(columns[i], left); left += widths[i];
    }
    for (let i = columns.length - 1; i >= 0; i--) if (columns[i].frozen === "right") {
      offsets.set(columns[i], right); right += widths[i];
    }
    for (const column of columns) {
      const side = column.frozen === "left" || column.frozen === "right" ? column.frozen : null;
      const apply = cell => {
        if (!cell || !side && !cell.classList.contains("dui-grid__cell--frozen")) return;
        cell.classList.toggle("dui-grid__cell--frozen", side != null);
        cell.classList.toggle("dui-grid__cell--frozen-left", side === "left");
        cell.classList.toggle("dui-grid__cell--frozen-right", side === "right");
        cell.style.left = side === "left" ? `${offsets.get(column)}px` : "";
        cell.style.right = side === "right" ? `${offsets.get(column)}px` : "";
      };
      apply(headers.get(String(column.id)));
      // Preserve the editor DOM/draft while changing only its cell geometry.
      if (this.grid._editing?.column === column) apply(this.grid._editing.cell);
    }
  }

  prepare(entries) {
    const grid = this.grid;
    const rowHeight = grid._getVirtualRowHeight();
    const expanded = new Set();
    this.entries = [];
    this.rowIndices.clear();
    for (const entry of entries) {
      if (entry.type === "group") {
        this.entries.push({ ...entry, key: `group:${entry.path}` });
      } else {
        const id = entry.id ?? grid.view.idOf(entry.item, entry.rowIndex);
        const key = gridRowKey(id);
        this.rowIndices.set(id, this.entries.length);
        this.entries.push({ ...entry, id, key: `item:${key}` });
        if (grid.rowDetail && grid._expandedDetails.has(id)) {
          expanded.add(key);
          this.entries.push({ type: "detail", id, item: entry.item, rowIndex: entry.rowIndex, key: `detail:${key}`, detailKey: key });
        }
      }
    }
    for (const key of this.details.keys()) if (!expanded.has(key)) this.details.delete(key);
    const width = grid._body.clientWidth;
    this.offsets = rowOffsets(this.entries.map(entry => {
      if (entry.type !== "detail") return rowHeight;
      const known = this.details.get(entry.detailKey);
      return known && known.item === entry.item && known.width === width ? known.height : rowHeight * 3;
    }));
    let desiredTop = grid._body.scrollTop;
    if (this.anchor) {
      let index = this.entries.findIndex(entry => entry.key === this.anchor.key);
      let offset = this.anchor.offset;
      if (index < 0) for (const key of this.anchor.fallback ?? []) {
        index = this.entries.findIndex(entry => entry.key === key);
        if (index >= 0) { offset = 0; break; }
      }
      if (index >= 0) this.pendingScrollTop = desiredTop = this.offsets[index] + offset;
      this.anchor = null;
    }
    const top = Math.min(desiredTop, Math.max(0, this.offsets.at(-1) - grid._body.clientHeight));
    return windowRange(this.offsets, top, grid._body.clientHeight, grid.virtualOverscan, grid.virtualRows);
  }

  draw(range, updateRow, layout, revision = this.revision) {
    const grid = this.grid;
    const focusEditing = grid._editing, focused = document.activeElement;
    const ownedFocus = Boolean(focusEditing?.cell?.contains(focused));
    const renderedWindow = layout ? {
      revision, start: range.start, end: range.end, columns: layout.visible.map(track => track.index),
      columnCache: this.columnCache, width: grid._body.clientWidth, height: grid._body.clientHeight,
      rowHeight: grid._getVirtualRowHeight(), virtualRows: grid.virtualRows,
      virtualColumns: grid.virtualColumns, overscan: grid.virtualOverscan
    } : null;
    const children = [], retained = new Set();
    if (range.topHeight > 0) {
      this.topSpacer ??= grid._createRowSpacer(0, "top");
      this.topSpacer.style.height = `${range.topHeight}px`;
      children.push(this.topSpacer);
    }
    for (let index = range.start; index < range.end; index++) {
      const entry = this.entries[index];
      let record = this.rows.get(entry.key);
      const reused = Boolean(record);
      if (!record) {
        record = { row: document.createElement("div"), cells: new Map(), entry };
        this.rows.set(entry.key, record);
      }
      record.entry = entry;
      retained.add(entry.key);
      updateRow(record, entry, index, reused);
      this.assertCurrent();
      children.push(record.row);
    }
    if (range.bottomHeight > 0) {
      this.bottomSpacer ??= grid._createRowSpacer(0, "bottom");
      this.bottomSpacer.style.height = `${range.bottomHeight}px`;
      children.push(this.bottomSpacer);
    }
    const editing = grid._editing;
    if (editing && !retained.has(`item:${gridRowKey(editing.id)}`)) {
      grid._discardActiveEdit({ origin: "system", reason: "viewport-change" });
      this.assertCurrent();
    }
    for (const [key, record] of this.rows) {
      if (!retained.has(key)) { this.observer?.unobserve(record.row); this.rows.delete(key); }
    }
    reconcileChildren(grid._body, children);
    if (this.pendingScrollTop != null) {
      grid._body.scrollTop = this.pendingScrollTop; this.pendingScrollTop = null;
      if (grid._editing) grid._editing.scrollTop = grid._body.scrollTop;
    }
    for (const record of this.rows.values()) {
      if (record.entry.type === "detail") this._observeDetail(record);
    }
    this.renderedWindow = renderedWindow;
    if (this.columnCache?.viewportWidth !== grid._body.clientWidth) this.request();
    // Moving a retained cell/row with insertBefore may blur its editor. Restore
    // only that same live session; deliberate external focus always wins.
    if (ownedFocus && this.grid === grid && !grid.destroyed && grid._editing === focusEditing &&
        focused?.isConnected && focusEditing.cell.contains(focused) && document.activeElement === document.body) {
      focused.focus({preventScroll:true});
      this.assertCurrent(); // focus callbacks may replace the projection or owner.
    }
  }

  _observeDetail(record) {
    if (typeof ResizeObserver !== "function") return;
    if (record.observedItem === record.entry.item && record.observedWidth === this.grid._body.clientWidth) return;
    if (!this.observer) this.observer = new ResizeObserver(changes => {
      const grid = this.grid;
      if (!grid || grid.destroyed) return;
      let changed = false;
      for (const change of changes) {
        const key = change.target.dataset.duiGridDetailId;
        const current = this.rows.get(`detail:${key}`);
        if (!current || current.row !== change.target) continue;
        const height = Math.max(1, change.borderBoxSize?.[0]?.blockSize ?? change.target.getBoundingClientRect().height);
        const width = grid._body.clientWidth;
        const old = this.details.get(key);
        if (!old || old.height !== height || old.width !== width || old.item !== current.entry.item) {
          this.details.set(key, { height, width, item: current.entry.item });
          changed = true;
        }
      }
      if (changed) {
        const index = rowAtOffset(this.offsets, grid._body.scrollTop);
        const entry = this.entries[index];
        if (entry) this.anchor = { key: entry.key, offset: grid._body.scrollTop - this.offsets[index] };
        this.request();
      }
    });
    this.observer.unobserve(record.row);
    this.observer.observe(record.row);
    record.observedItem = record.entry.item;
    record.observedWidth = this.grid._body.clientWidth;
  }

  scrollToRow(id) {
    const index = this.rowIndices.get(id);
    if (index == null) return false;
    const body = this.grid._body, top = this.offsets[index], bottom = this.offsets[index + 1];
    if (top < body.scrollTop) body.scrollTop = top;
    else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = Math.max(0, bottom - body.clientHeight);
    return true;
  }

  scrollToColumn(id) {
    const layout = this.columns(), body = this.grid._body;
    const track = layout.tracks.find(track => track.column.id === id);
    if (!track || track.column.frozen) return;
    const available = Math.max(1, body.clientWidth - layout.frozenLeft - layout.frozenRight);
    if (track.width >= available || track.left < body.scrollLeft + layout.frozenLeft) body.scrollLeft = Math.max(0, track.left - layout.frozenLeft);
    else if (track.left + track.width > body.scrollLeft + body.clientWidth - layout.frozenRight) {
      body.scrollLeft = track.left + track.width - body.clientWidth + layout.frozenRight;
    }
  }

  destroy() {
    this.cancel();
    this.observer?.disconnect();
    this.observer = null;
    this.rows.clear(); this.details.clear(); this.rowIndices.clear();
    this.entries = []; this.offsets = [0]; this.columnCache = null;
    this.renderedWindow = null;
    this.topSpacer = this.bottomSpacer = this.anchor = this.pendingScrollTop = this.grid = null;
  }
}
