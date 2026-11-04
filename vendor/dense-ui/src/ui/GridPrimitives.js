export const GRID_ROW_HEIGHT = 24;
export const GRID_OVERSCAN = 6;
export const GRID_FALLBACK_VISIBLE_ROWS = 40;

export function computeGridRenderRange(options) {
  const { rowCount, virtualRows, body, rowHeight, overscan } = options;
  if (!virtualRows || !body || rowCount <= 0) {
    return { start:0, end:rowCount, topHeight:0, bottomHeight:0, rowHeight };
  }
  const viewportHeight = body.clientHeight;
  const firstVisible = viewportHeight > 0 ? Math.floor(body.scrollTop / rowHeight) : 0;
  const visibleCount = viewportHeight > 0
    ? Math.ceil(viewportHeight / rowHeight)
    : Math.min(rowCount, GRID_FALLBACK_VISIBLE_ROWS);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(rowCount, firstVisible + visibleCount + overscan);
  return { start, end, topHeight:start * rowHeight,
    bottomHeight:Math.max(0, (rowCount - end) * rowHeight), rowHeight };
}

export function resolveGridRowHeight(element, explicitHeight) {
  const explicit = parseGridPixelSize(explicitHeight);
  if (explicit > 0) return explicit;
  const canRead = element && typeof getComputedStyle === "function";
  const styles = canRead ? getComputedStyle(element) : null;
  const grid = parseGridPixelSize(styles?.getPropertyValue("--dui-grid-row-height"));
  if (grid > 0) return grid;
  const control = parseGridPixelSize(styles?.getPropertyValue("--dui-control-height"));
  return control > 0 ? control : GRID_ROW_HEIGHT;
}

export function normalizeGridOverscan(value) {
  const parsed = Number(value ?? GRID_OVERSCAN);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : GRID_OVERSCAN;
}

export function normalizeGridColumnWidth(width) {
  return width == null ? "minmax(120px, 1fr)" : normalizeGridCssSize(width);
}

export function normalizeGridCssSize(value) {
  return typeof value === "number" ? `${value}px` : String(value);
}

export function parseGridPixelSize(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = typeof value === "string" ? Number.parseFloat(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clampGridColumnWidth(width, column) {
  const min = column.minWidth == null ? 48 : Number(column.minWidth);
  const max = column.maxWidth == null ? Infinity : Number(column.maxWidth);
  return Math.max(min, Math.min(max, Math.round(width)));
}

export function gridRowKey(id) { return `${typeof id}:${String(id)}`; }
export function gridCssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replaceAll('"', '\\"');
}
