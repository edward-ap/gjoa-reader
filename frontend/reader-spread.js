// Western pagination. All public indices in this module are zero-based.
export function spreadForPage(pageIndex, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1 || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new RangeError('Page is outside the book');
  }
  const spreadIndex = Math.floor((pageIndex + 1) / 2);
  const leftPageIndex = spreadIndex === 0 ? null : spreadIndex * 2 - 1;
  const right = spreadIndex * 2;
  return Object.freeze({ spreadIndex, leftPageIndex, rightPageIndex: right < pageCount ? right : null, anchorPageIndex: pageIndex });
}

export function adjacentSpreadPage(pageIndex, pageCount, direction) {
  if (direction !== -1 && direction !== 1) throw new RangeError('Expected previous or next');
  const { spreadIndex } = spreadForPage(pageIndex, pageCount);
  const next = spreadIndex + direction;
  if (next < 0 || next > Math.floor(pageCount / 2)) return null;
  return next === 0 ? 0 : next * 2 - 1;
}

export function assertViewMode(mode) {
  if (mode !== 'single' && mode !== 'facing' && mode !== 'continuous') throw new TypeError(`Unsupported reader view mode: ${mode}`);
}

export function visiblePages(pageIndex, pageCount, mode) {
  assertViewMode(mode);
  const spread = spreadForPage(pageIndex, pageCount);
  return mode !== 'facing' ? [pageIndex] : [spread.leftPageIndex, spread.rightPageIndex].filter(index => index !== null);
}

export function adjacentPage(pageIndex, pageCount, mode, direction) {
  assertViewMode(mode);
  if (mode === 'facing') return adjacentSpreadPage(pageIndex, pageCount, direction);
  const next = pageIndex + direction;
  return next >= 0 && next < pageCount ? next : null;
}

export function visiblePageLabel(pageIndex, pageCount, mode) {
  const pages = visiblePages(pageIndex, pageCount, mode);
  return pages.length === 1 ? `Page ${pages[0] + 1}` : `Pages ${pages[0] + 1}–${pages[1] + 1}`;
}

// Existing logical units are source pixels (CSS px at Actual). The gutter,
// like the pages, scales with the common zoom.
export const FACING_PAGE_GAP = 4;

export function viewGeometry(pageIndex, pageCount, mode, pageInfos) {
  if (mode === 'continuous') throw new TypeError('Continuous geometry belongs to the virtual scroll window');
  const pages = visiblePages(pageIndex, pageCount, mode);
  const info = index => {
    const value = pageInfos.get(index);
    if (!value || !Number.isFinite(value.width) || value.width <= 0 || !Number.isFinite(value.height) || value.height <= 0) {
      throw new RangeError(`Invalid dimensions for page ${index + 1}`);
    }
    return value;
  };
  if (mode === 'single') {
    const page = info(pageIndex);
    return Object.freeze({ width: page.width, height: page.height, gap: 0,
      slots: Object.freeze([Object.freeze({ side: 'single', pageIndex, x: 0, y: 0, width: page.width, height: page.height })]) });
  }
  const spread = spreadForPage(pageIndex, pageCount);
  const counterpart = info(pages[0]);
  const left = spread.leftPageIndex === null ? counterpart : info(spread.leftPageIndex);
  const right = spread.rightPageIndex === null ? counterpart : info(spread.rightPageIndex);
  return Object.freeze({ width: left.width + FACING_PAGE_GAP + right.width, height: Math.max(left.height, right.height), gap: FACING_PAGE_GAP,
    slots: Object.freeze([
      Object.freeze({ side: 'left', pageIndex: spread.leftPageIndex, x: 0, y: 0, width: left.width, height: left.height }),
      Object.freeze({ side: 'right', pageIndex: spread.rightPageIndex, x: left.width + FACING_PAGE_GAP, y: 0, width: right.width, height: right.height }),
    ]) });
}

export function pageRasterTargets(geometry, targetWidth, targetHeight) {
  if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth < 1 || targetHeight < 1 ||
      targetWidth > 8192 || targetHeight > 8192 || targetWidth * targetHeight > 16777216) throw new RangeError('Invalid spread raster size');
  const scale = Math.min(targetWidth / geometry.width, targetHeight / geometry.height);
  return geometry.slots.filter(slot => slot.pageIndex !== null).map(slot => {
    const x = Math.min(targetWidth - 1, Math.round(slot.x * scale));
    const y = Math.min(targetHeight - 1, Math.round(slot.y * scale));
    return { ...slot, x, y, targetWidth: Math.min(targetWidth - x, Math.max(1, Math.round(slot.width * scale))),
      targetHeight: Math.min(targetHeight - y, Math.max(1, Math.round(slot.height * scale))) };
  });
}
