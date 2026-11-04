import { t, denseText } from './i18n/i18n.js';
import { Panel } from 'dense-ui';
import { RenderViewport } from '../extensions/viewport/index.js';
import { PageWindowCache, pageWindow } from './page-window-cache.js';

const GAP = 20;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function rasterTarget(info, zoom, dpr) {
  const scale = Math.min(zoom * dpr, 4096 / info.width, 4096 / info.height, Math.sqrt(4 * 1024 * 1024 / (info.width * info.height)));
  return { contentWidth: info.width, contentHeight: info.height, targetWidth: Math.max(1, Math.floor(info.width * scale)), targetHeight: Math.max(1, Math.floor(info.height * scale)) };
}

// Virtual scroll geometry is independent of the display surface. RenderViewport
// receives only the visible screen composite; it never allocates a book-height canvas.
export class ContinuousView extends Panel {
  constructor() {
    super({ name: 'continuousView', width: '100%', height: '100%', css: 'reader-continuous' });
    this.zoom = 1; this.fitMode = 'fit'; this.epoch = 0; this.scene = 0; this.painted = -1;
    this.current = null; this.slots = []; this.infos = new Map(); this.shifting = false;
    this.cache = new PageWindowCache(() => this.changed());
    this.viewport = new RenderViewport({ name: 'continuousSurface', width: '100%', height: '100%',
      css: 'reader-viewport', zoom: 1, panEnabled: false, wheelZoom: 'none', renderDelay: 0, ariaLabel: t('reader.continuousPage') });
  }
  createElement() {
    const root = super.createElement();
    this.scroller = document.createElement('div'); this.scroller.className = 'reader-scroll'; this.scroller.tabIndex = 0;
    this.scroller.setAttribute('aria-label', t('reader.continuousScroll'));
    this.plane = document.createElement('div'); this.plane.className = 'reader-scroll-plane'; this.plane.setAttribute('aria-hidden', 'true');
    this.scroller.append(this.plane);
    this.surface = document.createElement('div'); this.surface.className = 'reader-surface'; root.append(this.scroller, this.surface);
    return root;
  }
  getContentElement() { return this.surface; }
  mount(container) {
    super.mount(container); if (this.viewport.mounted) return this;
    this.add(this.viewport); this.viewport.setRenderer(request => this.paint(request));
    this.viewport.events.on('renderComplete', () => this.events.emit('renderComplete', {}));
    this.viewport.events.on('renderError', e => this.events.emit('renderError', e));
    this.disposables.addEventListener(this.scroller, 'scroll', () => {
      if (!this.current || this.adjusting) return;
      this.changed(); void this.followScroll();
    });
    this.disposables.addEventListener(this.surface, 'wheel', e => {
      if (!this.current || e.defaultPrevented) return;
      e.preventDefault(); const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.scroller.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) this.setZoom(this.zoom * Math.exp(clamp(-e.deltaY * unit * .002, -1, 1)));
      else this.scroller.scrollBy({ top: e.shiftKey ? 0 : e.deltaY * unit, left: (e.shiftKey ? e.deltaY : e.deltaX) * unit, behavior: 'instant' });
    }, { passive: false });
    this.disposables.addEventListener(this.surface, 'pointerdown', e => {
      if (!this.current || e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.scroller.scrollLeft, top: this.scroller.scrollTop };
      this.surface.setPointerCapture(e.pointerId); this.scroller.focus(); e.preventDefault();
    });
    this.disposables.addEventListener(this.surface, 'pointermove', e => {
      if (this.drag?.id !== e.pointerId) return;
      this.scroller.scrollLeft = this.drag.left + this.drag.x - e.clientX;
      this.scroller.scrollTop = this.drag.top + this.drag.y - e.clientY;
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) this.disposables.addEventListener(this.surface, event, () => { this.drag = null; });
    this.disposables.addEventListener(this.element, 'keydown', e => {
      if (e.defaultPrevented || e.target.closest('input, textarea, [contenteditable]')) return;
      const delta = { ArrowDown: 40, ArrowUp: -40, PageDown: this.scroller.clientHeight * .9, PageUp: -this.scroller.clientHeight * .9 }[e.key];
      if (delta && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); this.scroller.scrollBy({ top: delta, behavior: 'instant' }); }
    }, { capture: true });
    this.disposables.addEventListener(window, 'resize', () => this.resize());
    const observer = new ResizeObserver(() => this.resize()); observer.observe(this.scroller);
    this.disposables.add(() => observer.disconnect()); this.disposables.add(() => this.cache.clear());
    this.resize(); return this;
  }
  resize() {
    if (this.destroyed) return;
    const width = this.scroller.clientWidth, height = this.scroller.clientHeight;
    if (!width || !height || (width === this.widthPx && height === this.heightPx && this.dpr === devicePixelRatio)) return;
    this.widthPx = width; this.heightPx = height; this.dpr = devicePixelRatio;
    this.surface.style.width = `${width}px`; this.surface.style.height = `${height}px`;
    this.viewport.setSize(width, height); this.viewport.setContentSize(width, height);
    if (this.current) this.relayout(true);
  }
  showPages(prepared, rendererForPage, options = {}) {
    const previous = this.current;
    this.epoch++; this.shifting = false;
    if (previous?.documentId !== prepared.documentId) this.cache.clear();
    this.current = prepared; this.infos = new Map(prepared.infos); this.provider = rendererForPage;
    this.viewport.setContentSize(this.widthPx, this.heightPx);
    this.reference = this.infos.get(prepared.pageIndex);
    if (options.zoom != null) { this.zoom = options.zoom; this.fitMode = options.fitMode; }
    this.relayout(false);
    const slot = this.slots.find(s => s.pageIndex === prepared.pageIndex);
    this.adjustScroll(this.scroller.scrollLeft, slot.top);
    this.updateWindow(); this.changed();
  }
  stop() {
    this.epoch++; this.current = null; this.shifting = false; this.cache.clear(); this.slots = []; this.drag = null;
    this.viewport.setContentSize(0, 0); this.painted = -1;
  }
  fit(mode) { this.fitMode = mode; this.reference = this.infos.get(this.current?.pageIndex); this.relayout(true); }
  setZoom(zoom) { if (!Number.isFinite(zoom)) return; this.nextZoom = clamp(zoom, .05, 8); this.fitMode = 'manual'; this.relayout(true); }
  relayout(preserve) {
    if (!this.current || !this.widthPx || !this.heightPx) return;
    const old = this.slots.find(s => s.pageIndex === this.current.pageIndex);
    const offset = old ? (this.scroller.scrollTop - old.top - old.pad) / this.zoom : 0;
    const horizontal = this.scroller.scrollLeft / this.zoom;
    if (this.nextZoom != null) { this.zoom = this.nextZoom; this.nextZoom = null; }
    else if (this.reference) {
      const x = (this.widthPx - 24) / this.reference.width, y = (this.heightPx - 24) / this.reference.height;
      if (this.fitMode === 'fit') this.zoom = Math.min(x, y);
      else if (this.fitMode === 'fit-width') this.zoom = x;
      else if (this.fitMode === 'fit-height') this.zoom = y;
      else if (this.fitMode === 'actual') this.zoom = 1;
    }
    this.zoom = clamp(this.zoom, .01, 16); this.layoutSlots();
    const slot = this.slots.find(s => s.pageIndex === this.current.pageIndex);
    this.adjustScroll(horizontal * this.zoom, preserve ? slot.top + slot.pad + offset * this.zoom : slot.top);
    this.updateWindow(); this.changed();
    this.events.emit('viewportChange', { newValue: { fitMode: this.fitMode, zoom: this.zoom } });
  }
  layoutSlots() {
    let top = 0;
    this.planeWidth = Math.max(this.widthPx, ...[...this.infos.values()].map(p => p.width * this.zoom + 24));
    this.slots = [...this.infos].sort(([a], [b]) => a - b).map(([pageIndex, info]) => {
      const width = info.width * this.zoom, height = info.height * this.zoom;
      // Even at tiny zoom a page occupies one viewport slot: never expose a fourth page.
      const slotHeight = Math.max(this.heightPx, height + 24);
      const slot = { pageIndex, top, width, height, pad: (slotHeight - height) / 2, left: (this.planeWidth - width) / 2, slotHeight };
      top += slotHeight + GAP; return slot;
    });
    this.plane.style.width = `${Math.ceil(this.planeWidth)}px`; this.plane.style.height = `${Math.ceil(top - GAP)}px`;
  }
  adjustScroll(left, top, compensateDrag = true) {
    const oldTop = this.scroller.scrollTop, oldLeft = this.scroller.scrollLeft;
    this.adjusting = true; this.scroller.scrollLeft = left; this.scroller.scrollTop = top; this.adjusting = false;
    if (this.drag && compensateDrag) { this.drag.top += this.scroller.scrollTop - oldTop; this.drag.left += this.scroller.scrollLeft - oldLeft; }
  }
  updateWindow() {
    if (!this.current) return;
    const targets = [...this.infos].map(([pageIndex, info]) => ({ pageIndex, ...rasterTarget(info, this.zoom, this.dpr || 1) }));
    this.cache.setWindow(this.current.documentId, targets, this.provider);
    const index = this.current.pageIndex;
    for (const page of [index, index + 1, index - 1].filter(p => this.infos.has(p))) {
      void this.cache.get(page).catch(error => { if (error.name !== 'AbortError' && this.current && this.infos.has(page)) this.events.emit('renderError', { error }); });
    }
  }
  async followScroll() {
    if (!this.current || this.shifting) return;
    const center = this.scroller.scrollTop + this.heightPx / 2;
    const slot = this.slots.find(s => center >= s.top && center < s.top + s.slotHeight + GAP) ?? this.slots.at(-1);
    if (!slot || slot.pageIndex === this.current.pageIndex) return;
    const epoch = this.epoch, previous = this.current; this.shifting = true;
    let retry = false;
    try {
      const indices = pageWindow(slot.pageIndex, previous.pageCount);
      const infos = await Promise.all(indices.map(async i => [i, this.infos.get(i) ?? await previous.getPageInfo(i)]));
      if (this.destroyed || epoch !== this.epoch) return;
      const centerNow = this.scroller.scrollTop + this.heightPx / 2;
      const selected = this.slots.find(s => centerNow >= s.top && centerNow < s.top + s.slotHeight + GAP) ?? this.slots.at(-1);
      if (selected?.pageIndex !== slot.pageIndex) {
        retry = true; return;
      }
      for (const [, info] of infos) if (!Number.isFinite(info.width) || info.width <= 0 || !Number.isFinite(info.height) || info.height <= 0) throw new RangeError('Invalid page dimensions');
      const offset = this.scroller.scrollTop - slot.top;
      const oldTop = this.scroller.scrollTop, oldLeft = this.scroller.scrollLeft;
      this.current = { ...previous, pageIndex: slot.pageIndex };
      this.infos = new Map(infos); this.layoutSlots();
      this.adjustScroll(this.scroller.scrollLeft, this.slots.find(s => s.pageIndex === slot.pageIndex).top + offset, false);
      if (this.drag) { this.drag.top += this.scroller.scrollTop - oldTop; this.drag.left += this.scroller.scrollLeft - oldLeft; }
      this.updateWindow(); this.changed();
      this.events.emit('pageChange', { documentId: previous.documentId, pageIndex: slot.pageIndex });
    } catch (error) { if (epoch === this.epoch) this.events.emit('renderError', { error }); }
    finally { if (epoch === this.epoch) { this.shifting = false; if (retry) void this.followScroll(); } }
  }
  visibleSlots() { return this.slots.filter(s => s.top + s.pad < this.scroller.scrollTop + this.heightPx && s.top + s.pad + s.height > this.scroller.scrollTop); }
  changed() {
    if (this.destroyed || !this.current) return;
    this.scene++; this.element.dataset.pageWindow = JSON.stringify(this.cache.diagnostics);
    this.element.dataset.anchorPage = String(this.current.pageIndex + 1);
    this.events.emit('renderStart', {}); void this.viewport.refresh();
  }
  paint(request) {
    const canvas = new OffscreenCanvas(request.targetWidth, request.targetHeight), ctx = canvas.getContext('2d');
    try {
      ctx.scale(request.targetWidth / this.widthPx, request.targetHeight / this.heightPx);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      for (const slot of this.visibleSlots()) {
        const x = slot.left - this.scroller.scrollLeft, y = slot.top + slot.pad - this.scroller.scrollTop;
        ctx.fillStyle = '#fff'; ctx.fillRect(x, y, slot.width, slot.height);
        const image = this.cache.entries.get(slot.pageIndex)?.result?.image;
        if (image) ctx.drawImage(image, x, y, slot.width, slot.height);
      }
      this.painted = this.scene; return { image: canvas.transferToImageBitmap(), owned: true };
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  get renderStatus() {
    if (!this.current) return 'empty';
    if (this.visibleSlots().some(s => this.cache.entries.get(s.pageIndex)?.error)) return 'error';
    return this.cache.busy || this.viewport.renderStatus === 'rendering' ? 'rendering' : this.viewport.renderStatus;
  }
  get ready() { return !!this.current && this.viewport.renderStatus === 'ready' && this.painted === this.scene && this.visibleSlots().every(s => this.cache.entries.get(s.pageIndex)?.result); }
  annotationSurfaces() {
    return this.visibleSlots().map(slot => ({ pageIndex: slot.pageIndex,
      width: this.infos.get(slot.pageIndex).width, height: this.infos.get(slot.pageIndex).height,
      container: this.viewport.element, transform: { scale: this.zoom,
        offsetX: slot.left - this.scroller.scrollLeft,
        offsetY: slot.top + slot.pad - this.scroller.scrollTop } }));
  }
  getViewState() { return { viewMode: 'continuous', pageIndex: this.current?.pageIndex, fitMode: this.fitMode, zoom: this.zoom,
    scroll: { left: this.scroller.scrollLeft, top: this.scroller.scrollTop }, slots: this.slots, pageWindow: this.cache.diagnostics, renderStatus: this.renderStatus }; }
}
