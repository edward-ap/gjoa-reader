import { Painter } from '../extensions/painter/index.js';
import { AnnotationRail } from './annotation-rail.js';
import { t } from './i18n/i18n.js';

// Editable page layers persist separately from immutable Reader Editions.
// The view adapter owns raster geometry; Painter receives logical page units.
export class ReaderAnnotations {
  constructor(view, button, onModeChange, onError, parent) {
    this.view = view; this.button = button; this.onModeChange = onModeChange; this.onError = onError;
    this.models = new Map(); this.layers = new Map(); this.pages = new Map(); this.documentId = null;
    this.writeTail = Promise.resolve(); this.dirty = new Map();
    this.invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
    this.tool = 'pen'; this.visible = false; this.color = '#b3261e';
    this.rail = new AnnotationRail(parent, this.color,
      tool => { this.setTool(tool); this.rail.expand(false); this.rail.tab.focus(); }, color => {
      this.color = color;
      for (const painter of this.layers.values()) painter.setToolSettings({ color: this.color });
    });
    this.escape = event => {
      // Painter and nested popups get the first chance to cancel their own draft.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (this.rail.open) { event.preventDefault(); this.rail.expand(false); this.rail.tab.focus(); }
      }
    };
    window.addEventListener('keydown', this.escape);
    this.rail.select(this.tool);
    button.setPressed(false);
    button.element.setAttribute('aria-expanded', 'false');
  }
  get editing() { return this.visible; }
  toggleMenu() {
    this.visible = !this.visible; this.rail.show(this.visible);
    this.button.setPressed(this.visible);
    this.button.element.setAttribute('aria-expanded', String(this.visible));
    this.setTool(this.tool);
  }
  setTool(tool) {
    this.tool = tool ?? 'pen';
    this.rail.select(this.tool);
    for (const [index, painter] of this.layers) this.configure(painter, index);
    this.onModeChange();
  }
  configure(painter, index) {
    painter.setTool(this.tool === 'dashed' ? 'line' : this.tool ?? 'select');
    painter.setToolSettings({ color: this.color, strokeWidth: 2, opacity: 1, fontSize: 20, dash: this.tool === 'dashed' ? 'dashed' : 'solid' });
    painter.setMode(this.editing && this.pages.get(index)?.ready ? 'edit' : 'view');
    if (!this.editing || this.tool === 'eraser') painter.select(null);
  }
  sync(book, opening) {
    this.book = book; this.opening = opening;
    const documentId = book?.documentId ?? null;
    if (this.documentId !== documentId) {
      this.clearLayers(); this.models.clear(); this.pages.clear(); this.documentId = documentId;
      this.visible = false; this.rail.show(false); this.button.setPressed(false);
      this.button.element.setAttribute('aria-expanded', 'false');
      this.tool = 'pen'; this.rail.select(this.tool);
    }
    if (!book || opening || !this.view.isCurrentViewReady) {
      for (const painter of this.layers.values()) {
        if (painter.visible) { painter.cancel(); painter.hide(); }
      }
      return;
    }
    const surfaces = this.view.annotationSurfaces();
    for (const [index, painter] of this.layers) {
      if (!surfaces.some(s => s.pageIndex === index && s.container === painter.element.parentElement)) {
        painter.destroy(); this.layers.delete(index);
      }
    }
    for (const surface of surfaces) {
      if (!this.pages.has(surface.pageIndex)) this.loadPage(documentId, surface.pageIndex);
      let painter = this.layers.get(surface.pageIndex);
      if (!painter) {
        painter = new Painter(surface.container, { name: `pageAnnotations-${surface.pageIndex}`,
          areaWidth: surface.width, areaHeight: surface.height, label: t('annotations.layer') });
        const saved = this.models.get(surface.pageIndex);
        if (saved) painter.importJSON(saved, { silent: true });
        painter.events.on('change', event => {
          this.models.set(surface.pageIndex, event.document);
          const key = this.pages.get(surface.pageIndex)?.key;
          if (key) this.savePage(key, surface.pageIndex, event.document);
        });
        painter.events.on('error', event => this.onError(event.error));
        painter.element.addEventListener('pointerdown', event => {
          if (!this.editing || !this.pages.get(surface.pageIndex)?.ready || event.button !== 0 || event.isPrimary === false) return;
          const rect = painter.element.getBoundingClientRect();
          const point = painter.viewportToLogical(event.clientX - rect.left, event.clientY - rect.top);
          if (point.x >= 0 && point.x <= surface.width && point.y >= 0 && point.y <= surface.height) {
            // Fold before Painter handles this same press; preserve the first stroke.
            this.rail.expand(false);
          }
        }, { capture: true });
        this.configure(painter, surface.pageIndex); this.layers.set(surface.pageIndex, painter);
      }
      painter.setTransform(surface.transform); painter.show();
    }
  }
  loadPage(documentId, pageIndex) {
    const state = { ready: false }; this.pages.set(pageIndex, state);
    // Reads wait for preceding writes, including a quick close/reopen of the same book.
    this.writeTail.then(() => this.invoke('read_page_annotations', { documentId, pageIndex })).then(result => {
      if (this.documentId !== documentId || this.destroyed) return;
      const document = this.dirty.get(`${result.key}:${pageIndex}`)?.document ?? result.document;
      if (document) {
        this.layers.get(pageIndex)?.importJSON(document, { silent: true });
        this.models.set(pageIndex, document);
      }
      state.key = result.key; state.ready = true;
      const painter = this.layers.get(pageIndex);
      if (painter) this.configure(painter, pageIndex);
      this.sync(this.book, this.opening); this.onModeChange();
    }).catch(error => {
      if (this.documentId === documentId && !this.destroyed) this.onError(t('annotations.loadFailed', { detail: error }));
    });
  }
  savePage(key, pageIndex, document) {
    const record = { key, pageIndex, document: structuredClone(document) }, id = `${key}:${pageIndex}`;
    this.dirty.set(id, record);
    this.writeTail = this.writeTail.then(async () => {
      await this.invoke('save_page_annotations', record);
      if (this.dirty.get(id) === record) this.dirty.delete(id);
    }).catch(error => this.onError(t('annotations.saveFailed', { detail: error })));
  }
  async flush() {
    await this.writeTail;
    for (const [id, record] of this.dirty) {
      await this.invoke('save_page_annotations', record);
      if (this.dirty.get(id) === record) this.dirty.delete(id);
    }
  }
  clearLayers() { for (const painter of this.layers.values()) painter.destroy(); this.layers.clear(); }
  destroy() {
    this.destroyed = true;
    window.removeEventListener('keydown', this.escape);
    this.clearLayers(); this.models.clear(); this.rail.destroy();
  }
}
