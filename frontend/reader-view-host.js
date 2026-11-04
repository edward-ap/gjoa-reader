import { t, denseText } from './i18n/i18n.js';
import { Panel } from 'taet-ui';
import { RenderViewport } from '../extensions/viewport/index.js';
import { scrollGeometry, scrollToPan, panToScroll } from './reader-geometry.js';
import { assertViewMode, visiblePages, viewGeometry } from './reader-spread.js';
import { createSpreadRenderer } from './spread-renderer.js';
import { ContinuousView } from './continuous-view.js';
import { pageWindow } from './page-window-cache.js';

// Reader-specific raster adapter. The shell only knows this host, not its surfaces.
export class ReaderViewHost extends Panel {
  constructor(options = {}) {
    super({ ...options, name: 'readerViewHost', width: '100%', height: '100%', css: 'reader-view-host' });
    this.viewMode = 'single';
    this.viewGeneration = 0;
    this.currentView = null;
    this.displayedKey = null;
    this.renderMetrics = null;
    this.synchronizing = false;
    this.expectedScroll = { left: 0, top: 0 };
    this.viewport = new RenderViewport({ name: 'pageViewport', width: '100%', height: '100%',
      css: 'reader-viewport', ariaLabel: t('reader.page'), fitMode: 'fit' });
    this.continuous = new ContinuousView();
  }

  createElement() {
    const root = super.createElement();
    this.scroller = document.createElement('div');
    this.scroller.className = 'reader-scroll';
    this.scroller.tabIndex = 0;
    this.scroller.setAttribute('aria-label', t('reader.scroll'));
    this.plane = document.createElement('div');
    this.plane.className = 'reader-scroll-plane';
    this.plane.setAttribute('aria-hidden', 'true');
    this.scroller.append(this.plane);
    this.surfaceLayer = document.createElement('div');
    this.surfaceLayer.className = 'reader-surface';
    root.append(this.scroller, this.surfaceLayer);
    this.emptyArtwork = document.createElement('div');
    this.emptyArtwork.className = 'reader-empty-artwork';
    this.emptyArtwork.setAttribute('aria-hidden', 'true');
    // Turn paper luminance into transparency, retaining the original pencil drawing.
    this.emptyArtwork.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1122 1402">
      <defs><filter id="reader-pencil" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feColorMatrix result="ink" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -.25512 -.85824 -.08664 0 1.14" />
        <feFlood flood-color="currentColor" /><feComposite operator="in" in2="ink" />
      </filter></defs>
      <image href="${new URL('./assets/ship.png', import.meta.url).href}" width="1122" height="1402" filter="url(#reader-pencil)" />
    </svg>`;
    root.append(this.emptyArtwork);
    return root;
  }

  getContentElement() { return this.surfaceLayer; }

  mount(container) {
    super.mount(container);
    if (this.viewport.mounted) return this;
    this.add(this.viewport);
    this.disposables.add(() => { if (!this.continuous.mounted) this.continuous.destroy(); });
    this.viewport.events.on('renderComplete', () => { this.displayedKey = this.currentView?.key ?? null; });
    for (const event of ['viewportChange', 'renderStart', 'renderComplete', 'renderError']) {
      this.viewport.events.on(event, e => { if (this.viewMode !== 'continuous') { this.element.dataset.renderStatus = this.renderStatus; this.events.emit(event, e); } });
      this.continuous.events.on(event, e => { if (this.viewMode === 'continuous') { this.element.dataset.renderStatus = this.renderStatus; this.events.emit(event, e); } });
    }
    this.continuous.events.on('pageChange', e => {
      if (this.viewMode !== 'continuous') return;
      this.currentView = { ...this.currentView, pageIndex: e.pageIndex };
      this.element.dataset.anchorPage = String(e.pageIndex + 1); this.events.emit('pageChange', e);
    });
    this.viewport.events.on('viewportChange', () => this.syncFromViewport());
    this.viewport.events.on('contentChange', () => this.syncFromViewport());
    this.disposables.addEventListener(this.scroller, 'scroll', () => this.syncFromScroll());
    this.disposables.addEventListener(this.surfaceLayer, 'wheel', event => {
      if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.scroller.clientHeight : 1;
      const horizontal = event.shiftKey && event.deltaX === 0;
      this.scroller.scrollBy({ left: (horizontal ? event.deltaY : event.deltaX) * scale,
        top: (horizontal ? 0 : event.deltaY) * scale, behavior: 'instant' });
      event.preventDefault();
    }, { passive: false });
    const observer = new ResizeObserver(() => { this.measure(); this.syncFromViewport(); });
    observer.observe(this.scroller);
    this.disposables.add(() => observer.disconnect());
    this.measure();
    this.syncFromViewport();
    return this;
  }

  measure() {
    if (this.destroyed || !this.mounted) return;
    // Keep the raster outside the scrolling DOM; its canvas stays viewport-sized.
    const width = this.viewMode === 'continuous' ? this.element.clientWidth : this.scroller.clientWidth;
    const height = this.viewMode === 'continuous' ? this.element.clientHeight : this.scroller.clientHeight;
    this.surfaceLayer.style.left = `${this.viewMode === 'continuous' ? 0 : this.scroller.clientLeft}px`;
    this.surfaceLayer.style.width = `${width}px`;
    this.surfaceLayer.style.height = `${height}px`;
    if (this.viewMode !== 'continuous' && (this.viewport.width !== width || this.viewport.height !== height)) this.viewport.setSize(width, height);
  }

  geometry() { return scrollGeometry(this.viewport.contentSize, this.viewport.zoom, this.viewport.viewportSize); }

  syncFromViewport() {
    if (this.destroyed || this.synchronizing || !this.mounted || this.viewMode === 'continuous') return;
    this.synchronizing = true;
    try {
      const geometry = this.geometry();
      this.plane.style.width = `${geometry.planeWidth}px`;
      this.plane.style.height = `${geometry.planeHeight}px`;
      const scroll = panToScroll(geometry, this.viewport.pan);
      this.scroller.scrollLeft = scroll.left;
      this.scroller.scrollTop = scroll.top;
      // DOM scrolling can round to device pixels. Ignore its resulting event.
      this.expectedScroll = { left: this.scroller.scrollLeft, top: this.scroller.scrollTop };
      this.element.dataset.viewMode = this.viewMode;
      this.element.dataset.zoomMode = this.viewport.fitMode;
      this.element.dataset.zoom = String(this.viewport.zoom);
      this.element.dataset.panX = String(this.viewport.pan.x);
      this.element.dataset.panY = String(this.viewport.pan.y);
      if (this.currentView) {
        this.element.dataset.viewGeometry = JSON.stringify(this.currentView.geometry);
        this.element.dataset.anchorPage = String(this.currentView.pageIndex + 1);
      }
      this.measure();
    } finally { this.synchronizing = false; }
  }

  syncFromScroll() {
    if (this.destroyed || this.synchronizing || this.viewMode === 'continuous') return;
    const left = this.scroller.scrollLeft, top = this.scroller.scrollTop;
    if (Math.abs(left - this.expectedScroll.left) < 0.5 && Math.abs(top - this.expectedScroll.top) < 0.5) return;
    const pan = scrollToPan(this.geometry(), left, top);
    this.viewport.panTo(pan.x, pan.y, { origin: 'user', userAction: true });
    this.syncFromViewport();
  }

  async prepareView(identity, getPageInfo) {
    const { pageIndex, pageCount, viewMode, documentId } = identity;
    if (viewMode === 'continuous') {
      const infos = await Promise.all(pageWindow(pageIndex, pageCount).map(async index => [index, await getPageInfo(index)]));
      for (const [, info] of infos) if (!Number.isFinite(info.width) || info.width <= 0 || !Number.isFinite(info.height) || info.height <= 0) throw new RangeError('Invalid page dimensions');
      return { ...identity, infos, getPageInfo, key: `${documentId}/continuous/${pageIndex}` };
    }
    const pages = visiblePages(pageIndex, pageCount, viewMode);
    const infos = new Map(await Promise.all(pages.map(async index => [index, await getPageInfo(index)])));
    const geometry = viewGeometry(pageIndex, pageCount, viewMode, infos);
    const key = `${documentId}/${viewMode}/${geometry.slots.map(s => `${s.pageIndex}:${s.width}:${s.height}`).join('/')}`;
    // Preparation is side-effect free. The controller commits only its newest request.
    return Object.freeze({ documentId, pageIndex, pageCount, viewMode, geometry, key });
  }

  showView(prepared, rendererForPage, { opening = false } = {}) {
    assertViewMode(prepared.viewMode);
    this.suspended = false;
    const previous = this.currentView;
    this.currentView = prepared;
    this.emptyArtwork.hidden = true;
    this.viewMode = prepared.viewMode;
    this.element.dataset.viewMode = this.viewMode;
    if (this.viewMode === 'continuous') {
      if (!this.continuous.mounted) this.add(this.continuous);
      const settings = opening ? { zoom: 1, fitMode: 'fit' } :
        previous?.viewMode === 'continuous' ? {} : { zoom: this.viewport.zoom, fitMode: this.viewport.fitMode };
      this.viewport.setRenderer(null); this.viewport.setContentSize(0, 0); this.viewport.hide();
      this.scroller.style.visibility = 'hidden'; this.continuous.show(); this.measure(); this.continuous.resize();
      this.continuous.showPages(prepared, rendererForPage, settings);
      this.element.dataset.anchorPage = String(prepared.pageIndex + 1); return;
    }
    if (previous?.viewMode === 'continuous') {
      this.continuous.stop(); this.continuous.hide(); this.viewport.show(); this.scroller.style.visibility = ''; this.measure();
      this.viewport.setZoom(this.continuous.zoom);
    }
    if (previous?.key !== prepared.key || this.viewport.renderStatus === 'error') {
      const generation = ++this.viewGeneration;
      this.renderMetrics = null;
      delete this.element.dataset.rasterMetrics;
      const collect = metrics => {
        if (this.destroyed || generation !== this.viewGeneration) return;
        this.renderMetrics = metrics;
        this.element.dataset.rasterMetrics = JSON.stringify(metrics);
      };
      let renderer;
      if (this.viewMode === 'facing') renderer = createSpreadRenderer(prepared.geometry, rendererForPage, collect);
      else {
        const provider = rendererForPage(prepared.pageIndex);
        renderer = async request => {
          const start = performance.now(), result = await provider(request);
          if (!request.signal.aborted) collect({ requestId: request.requestId, fullMilliseconds: performance.now() - start,
            width: request.targetWidth, height: request.targetHeight, compositeBytes: request.targetWidth * request.targetHeight * 4,
            pages: [{ pageIndex: prepared.pageIndex, side: 'single', width: request.targetWidth, height: request.targetHeight,
              bytes: request.targetWidth * request.targetHeight * 4, readyMilliseconds: performance.now() - start }] });
          return result;
        };
      }
      // Keep the previous raster for a same-sized view until atomic replacement.
      // A different book must never inherit pixels from the previous document.
      if (opening || previous?.documentId !== prepared.documentId) this.viewport.setContentSize(0, 0);
      this.activeRenderer = renderer;
      this.viewport.setRenderer(renderer);
      this.viewport.setContentSize(prepared.geometry.width, prepared.geometry.height);
    }
    if (opening) this.viewport.fit('fit');
    else if (previous?.viewMode === 'continuous' && this.continuous.fitMode !== 'manual') this.viewport.fit(this.continuous.fitMode);
    // Dense clamps/centers small axes; manual views start at the spread's top-left.
    else this.viewport.panTo(this.viewMode === 'single' ? this.viewport.pan.x : 0, 0);
    this.syncFromViewport();
  }

  refreshAppearance() {
    if (!this.currentView || this.destroyed || this.suspended) return;
    if (this.viewMode === 'continuous') {
      this.continuous.cache.clear(); this.continuous.updateWindow(); this.continuous.changed();
    } else { this.displayedKey = null; void this.viewport.refresh(); }
  }

  // Stop obsolete providers before native open begins. If opening is cancelled,
  // restore only the previous active view; hidden modes never issue requests.
  suspend() {
    const previous = this.currentView;
    this.suspended = true;
    let restore = () => this.viewport.setRenderer(this.activeRenderer ?? null);
    if (this.viewMode === 'continuous' && this.continuous.mounted) {
      const c = this.continuous;
      const prepared = c.current && { ...c.current, infos: [...c.infos] };
      const provider = c.provider, options = { zoom: c.zoom, fitMode: c.fitMode };
      const left = c.scroller.scrollLeft, top = c.scroller.scrollTop;
      c.stop();
      restore = () => {
        if (prepared) { c.showPages(prepared, provider, options); c.adjustScroll(left, top); c.changed(); }
      };
    } else this.viewport.setRenderer(null);
    return () => {
      if (!this.destroyed && this.suspended && this.currentView === previous) {
        this.suspended = false; restore();
      }
    };
  }

  clearDocument() {
    this.viewGeneration++;
    this.currentView = null; this.displayedKey = null; this.activeRenderer = null; this.suspended = false;
    this.emptyArtwork.hidden = false;
    if (this.continuous.mounted) { this.continuous.stop(); this.continuous.hide(); }
    this.viewMode = 'single'; this.viewport.setRenderer(null); this.viewport.setContentSize(0, 0);
    this.viewport.show(); this.scroller.style.visibility = ''; this.measure();
    delete this.element.dataset.anchorPage; delete this.element.dataset.rasterMetrics;
  }

  showPage(info, renderer, { opening = false } = {}) {
    this.showView({ documentId: 'single-preview', pageIndex: 0, pageCount: 1, viewMode: 'single', key: Symbol(),
      geometry: viewGeometry(0, 1, 'single', new Map([[0, info]])) }, () => renderer, { opening });
  }

  // Logical page coordinates mapped to the currently displayed raster surface.
  annotationSurfaces() {
    if (!this.isCurrentViewReady) return [];
    if (this.viewMode === 'continuous') return this.continuous.annotationSurfaces();
    return this.currentView.geometry.slots.filter(slot => slot.pageIndex != null).map(slot => {
      const origin = this.viewport.contentToViewport(slot.x, slot.y);
      return { pageIndex: slot.pageIndex, width: slot.width, height: slot.height,
        container: this.viewport.element,
        transform: { scale: this.viewport.zoom, offsetX: origin.x, offsetY: origin.y } };
    });
  }

  fit(mode) { (this.viewMode === 'continuous' ? this.continuous : this.viewport).fit(mode); }
  setZoom(zoom) { (this.viewMode === 'continuous' ? this.continuous : this.viewport).setZoom(zoom); }
  zoomBy(factor) { this.setZoom(this.zoom * factor); }
  get zoom() { return this.viewMode === 'continuous' ? this.continuous.zoom : this.viewport.zoom; }
  get renderStatus() { return this.viewMode === 'continuous' ? this.continuous.renderStatus : this.viewport.renderStatus; }
  get isCurrentViewReady() { if (this.suspended) return false; return this.viewMode === 'continuous' ? this.continuous.ready : !this.destroyed && this.currentView !== null && this.viewport.renderStatus === 'ready' && this.displayedKey === this.currentView.key; }
  getViewState() { if (this.viewMode === 'continuous') return this.continuous.getViewState(); return { viewMode: this.viewMode, ...this.viewport.getViewportState(),
    logicalView: this.currentView?.geometry ?? null, pageIndex: this.currentView?.pageIndex ?? null,
    renderMetrics: this.renderMetrics, scroll: { left: this.scroller.scrollLeft, top: this.scroller.scrollTop } }; }
}
