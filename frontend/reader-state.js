import { assertViewMode, adjacentPage } from './reader-spread.js';
export const VIEW_MODES = Object.freeze(['single', 'continuous', 'facing']);
export const ZOOM_MODES = Object.freeze(['fit', 'fit-width', 'fit-height', 'actual', 'manual']);

export function pageInputIndex(text, pageCount) {
  const value = String(text).trim();
  if (!/^\d+$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= pageCount ? page - 1 : null;
}

export class ReaderState {
  book = null;
  pageIndex = 0;
  requestedPage = 0;
  viewMode = 'single';
  requestedViewMode = 'single';
  zoomMode = 'fit';
  zoom = 1;

  open(book, viewMode = 'single') {
    assertViewMode(viewMode);
    this.book = book;
    const saved = book.initialPageIndex;
    this.pageIndex = Number.isSafeInteger(saved) && saved >= 0 ? Math.min(saved, book.pageCount - 1) : 0;
    this.requestedPage = this.pageIndex;
    this.viewMode = viewMode;
    this.requestedViewMode = viewMode;
    this.zoomMode = 'fit';
  }

  navigate(index) {
    if (!this.book || !Number.isInteger(index) || index < 0 || index >= this.book.pageCount) return false;
    this.pageIndex = this.requestedPage = index;
    return true;
  }

  observeViewport({ fitMode, zoom }) {
    this.zoomMode = fitMode;
    this.zoom = zoom;
  }

  setViewMode(mode) {
    assertViewMode(mode);
    this.viewMode = this.requestedViewMode = mode;
  }

  step(direction) {
    return this.book ? adjacentPage(this.requestedPage, this.book.pageCount, this.requestedViewMode, direction) : null;
  }
}
