// SPDX-License-Identifier: MIT
// Derived from Dense UI; copyright (c) 2026 Edward Aponasko.
// See LICENSE and provenance.json beside this local extension.
import { BaseControl, LifecycleError, normalizeMutationOptions } from "dense-ui/foundation";
import { anchoredZoom, centeredView, clamp, constrainView, fitZoom, rasterTarget, resizedView, toContent, toViewport } from "./renderViewportGeometry.js";

const MODES = new Set(["fit", "fit-width", "fit-height", "actual", "manual"]);
const USER = { origin: "user", userAction: true };

/**
 * Generic, source-neutral raster presentation owned by this application.
 * The host supplies logical size and a renderer; no document/parser/IPC is known here.
 * Each renderer generation transfers only explicitly owned ImageBitmaps. A stale
 * completion is released instead of becoming current pixels or a readiness signal.
 * Fit/zoom/pan use CSS pixels; requested raster dimensions additionally include DPR.
 */
export class RenderViewport extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer = typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    super({ ...options, observeResize: true, tabIndex: options.tabIndex ?? 0 });
    this._minZoom = positive(options.minZoom ?? 0.01, "minZoom");
    this._maxZoom = positive(options.maxZoom ?? 16, "maxZoom");
    if (this._maxZoom < this._minZoom) throw new RangeError("maxZoom must be at least minZoom.");
    this._renderDelay = nonNegative(options.renderDelay ?? 80, "renderDelay");
    this._maxRasterPixels = positive(options.maxRasterPixels ?? 16777216, "maxRasterPixels");
    this._maxRasterDimension = positive(options.maxRasterDimension ?? 8192, "maxRasterDimension");
    if (this._maxRasterPixels < 1 || this._maxRasterDimension < 1) throw new RangeError("Raster limits must be at least 1.");
    this._wheelZoom = options.wheelZoom ?? "ctrl";
    if (!["ctrl", "always", "none"].includes(this._wheelZoom)) throw new TypeError("wheelZoom must be ctrl, always or none.");
    this._panEnabled = options.panEnabled !== false;
    this._renderer = rendererOrNull(options.renderer);
    this._contentSize = contentSize(options.contentWidth ?? 0, options.contentHeight ?? 0);
    this._viewportSize = { width: 0, height: 0 };
    const mode = options.fitMode ?? (options.zoom != null ? "manual" : "fit");
    if (!MODES.has(mode)) throw new TypeError("Invalid fitMode.");
    this._view = { zoom: clamp(positive(options.zoom ?? 1, "zoom"), this._minZoom, this._maxZoom), panX: 0, panY: 0, mode };
    this._dpr = 1;
    this._status = "empty";
    this._lastError = null;
    this._raster = null;
    this._canvas = null;
    this._context = null;
    this._generation = 0;
    this._viewRevision = 0;
    this._pendingRequest = null;
    this._renderTimer = null;
    this._frame = null;
    this._inFrame = false;
    this._pendingView = null;
    this._drag = null;
    this._dprCleanup = null;
    this._releasedImages = new WeakSet();
    for (const name of ["beforeViewportChange", "viewportChange", "afterViewportChange", "beforeContentChange", "contentChange", "afterContentChange", "renderStart", "renderComplete", "renderError"]) {
      const handler = options[`on${name[0].toUpperCase()}${name.slice(1)}`];
      if (typeof handler === "function") this.disposables.add(this.events.on(name, handler));
    }
    // Public resize delivery is the extension boundary: no inherited-private hooks.
    this.disposables.add(this.events.on("resize", event => this._measureViewport(event)));
    if (hasContainer) this.mount(containerOrOptions);
  }

  get zoom() { return this._view.zoom; }
  get pan() { return { x: this._view.panX, y: this._view.panY }; }
  get fitMode() { return this._view.mode; }
  get contentSize() { return { ...this._contentSize }; }
  get viewportSize() { return { ...this._viewportSize }; }
  get devicePixelRatio() { return this._dpr; }
  get renderStatus() { return this._status; }
  get lastError() { return this._lastError; }
  get hasRaster() { return this._raster !== null; }

  getViewportState() {
    return { zoom: this.zoom, pan: this.pan, fitMode: this.fitMode, contentSize: this.contentSize,
      viewportSize: this.viewportSize, devicePixelRatio: this._dpr, renderStatus: this._status, hasRaster: this.hasRaster };
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-render-viewport", this.options.css, this.options.className].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiFocusTarget = "true";
    root.classList.toggle("dui-render-viewport--pan", this._panEnabled);
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", this.options.ariaLabel ?? "Raster viewport");
    root.dataset.renderStatus = this._status;
    root.setAttribute("aria-busy", "false");
    const canvas = document.createElement("canvas");
    canvas.className = "dui-render-viewport__canvas";
    canvas.setAttribute("aria-hidden", "true");
    root.append(canvas);
    this._canvas = canvas;
    this._context = canvas.getContext("2d");
    if (!this._context) throw new Error("RenderViewport requires Canvas 2D.");
    this.disposables.addEventListener(root, "wheel", event => this._wheel(event), { passive: false });
    this.disposables.addEventListener(root, "pointerdown", event => this._pointerDown(event));
    this.disposables.addEventListener(root, "pointermove", event => this._pointerMove(event));
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.disposables.addEventListener(root, type, event => { if (event.pointerId === this._drag?.id) this._endDrag(); });
    }
    this.disposables.addEventListener(root, "keydown", event => this._keyDown(event));
    return root;
  }

  mount(container) {
    const alreadyMounted = this.mounted;
    super.mount(container);
    if (!alreadyMounted) {
      this.disposables.addEventListener(window, "resize", () => this._measureViewport({ origin: "system", reason: "resize" }));
      this._measureViewport({ origin: "system", reason: "mount" });
      this._watchDpr();
    }
    return this;
  }

  setRenderer(renderer, options = {}) {
    assertViewportMutable(this, "setRenderer");
    const next = rendererOrNull(renderer);
    const mutation = normalizeMutationOptions(options);
    if (next === this._renderer) return false;
    this._renderer = next;
    this._invalidateRender("renderer", mutation, 0);
    return true;
  }

  setContentSize(width, height, options = {}) {
    assertViewportMutable(this, "setContentSize");
    const next = contentSize(width, height);
    const mutation = normalizeMutationOptions(options);
    if (next.width === this._contentSize.width && next.height === this._contentSize.height) return false;
    const before = { oldValue: this.contentSize, newValue: { ...next }, cancel: false };
    const revision = this._viewRevision;
    this._emit("beforeContentChange", before, mutation);
    if (before.cancel || this.destroyed || revision !== this._viewRevision) return false;
    const oldView = this.getViewportState();
    this._contentSize = next;
    this._pendingView = null;
    this._endDrag();
    const raster = this._raster;
    this._raster = null;
    this._releaseRaster(raster);
    this._view = centeredView({ ...this._view,
      zoom: this.fitMode === "manual" ? this.zoom : fitZoom(this.fitMode, next, this._viewportSize, this._minZoom, this._maxZoom) ?? this.zoom
    }, next, this._viewportSize);
    this._viewRevision++;
    this._invalidateRender("content", mutation, 0);
    this._scheduleDraw();
    const committedRevision = this._viewRevision;
    this._emit("contentChange", { oldValue: before.oldValue, newValue: this.contentSize }, mutation);
    if (this.destroyed || this._viewRevision !== committedRevision) return true;
    this._emit("afterContentChange", { oldValue: before.oldValue, newValue: this.contentSize }, mutation);
    if (!this.destroyed && this._viewRevision === committedRevision) this._notifyView(oldView, mutation, "content");
    return true;
  }

  setZoom(zoom, options = {}) {
    assertViewportMutable(this, "setZoom");
    const value = clamp(positive(zoom, "zoom"), this._minZoom, this._maxZoom);
    const anchor = options.anchor ?? { x: this._viewportSize.width / 2, y: this._viewportSize.height / 2 };
    const point = { x: finite(anchor.x, "anchor.x"), y: finite(anchor.y, "anchor.y") };
    this._pendingView = null;
    return this._commitView(anchoredZoom(this._view, value, point), options, "zoom");
  }

  zoomBy(factor, options = {}) {
    assertViewportMutable(this, "zoomBy");
    return this.setZoom(this.zoom * positive(factor, "factor"), options);
  }

  fit(mode = "fit", options = {}) {
    assertViewportMutable(this, "fit");
    if (!MODES.has(mode) || mode === "manual") throw new TypeError("fit mode must be fit, fit-width, fit-height or actual.");
    this._pendingView = null;
    return this._commitView(centeredView({ ...this._view, mode,
      zoom: fitZoom(mode, this._contentSize, this._viewportSize, this._minZoom, this._maxZoom) ?? this.zoom
    }, this._contentSize, this._viewportSize), options, mode);
  }

  panTo(x, y, options = {}) {
    assertViewportMutable(this, "panTo");
    this._pendingView = null;
    return this._commitView({ ...this._view, panX: finite(x, "x"), panY: finite(y, "y") }, options, "pan");
  }

  panBy(x, y, options = {}) {
    assertViewportMutable(this, "panBy");
    return this.panTo(this._view.panX + finite(x, "x"), this._view.panY + finite(y, "y"), options);
  }

  center(options = {}) {
    assertViewportMutable(this, "center");
    this._pendingView = null;
    return this._commitView(centeredView(this._view, this._contentSize, this._viewportSize), options, "center");
  }

  viewportToContent(x, y) { return toContent(this._view, finite(x, "x"), finite(y, "y")); }
  contentToViewport(x, y) { return toViewport(this._view, finite(x, "x"), finite(y, "y")); }

  // Errors are observable through renderError/lastError; auto requests never reject.
  refresh(options = {}) {
    assertViewportMutable(this, "refresh");
    const mutation = normalizeMutationOptions(options);
    const generation = this._cancelRender();
    if (this.destroyed || generation !== this._generation) return Promise.resolve(false);
    return this._renderNow(mutation, options.reason ?? "refresh");
  }

  disable() {
    super.disable();
    this._pendingView = null;
    this._endDrag();
  }

  _measureViewport(options) {
    if (!this.mounted || this.destroyed) return;
    const next = { width: this.element.clientWidth, height: this.element.clientHeight };
    const dpr = Math.max(0.1, globalThis.devicePixelRatio || 1);
    if (next.width === this._viewportSize.width && next.height === this._viewportSize.height && dpr === this._dpr) return;
    const old = this.getViewportState();
    this._view = resizedView(this._view, this._contentSize, this._viewportSize, next, this._minZoom, this._maxZoom);
    this._viewportSize = next;
    this._dpr = dpr;
    this._viewRevision++;
    this._pendingView = null;
    this._endDrag();
    const width = Math.max(1, Math.round(next.width * dpr));
    const height = Math.max(1, Math.round(next.height * dpr));
    if (this._canvas.width !== width) this._canvas.width = width;
    if (this._canvas.height !== height) this._canvas.height = height;
    const mutation = normalizeMutationOptions(options);
    this._invalidateRender(options.reason ?? "resize", mutation, this._raster ? this._renderDelay : 0);
    this._scheduleDraw();
    this._notifyView(old, mutation, options.reason ?? "resize");
  }

  _watchDpr() {
    this._dprCleanup?.();
    if (this.destroyed || typeof matchMedia !== "function") return;
    const query = matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
    const changed = () => {
      if (this.destroyed) return;
      this._measureViewport({ origin: "system", reason: "dpr" });
      this._watchDpr();
    };
    query.addEventListener("change", changed);
    this._dprCleanup = () => query.removeEventListener("change", changed);
  }

  _commitView(view, options, reason) {
    const mutation = normalizeMutationOptions(options);
    const next = constrainView(view, this._contentSize, this._viewportSize);
    if (sameView(this._view, next)) return false;
    const old = this.getViewportState();
    const revision = this._viewRevision;
    const event = { oldValue: old, newValue: { ...old, zoom: next.zoom, pan: { x: next.panX, y: next.panY }, fitMode: next.mode }, reason, cancel: false };
    this._emit("beforeViewportChange", event, mutation);
    if (event.cancel || this.destroyed || revision !== this._viewRevision) return false;
    const zoomChanged = this.zoom !== next.zoom;
    this._view = next;
    this._viewRevision++;
    if (zoomChanged) this._invalidateRender(reason, mutation, this._renderDelay);
    this._scheduleDraw();
    this._notifyView(old, mutation, reason);
    return true;
  }

  _notifyView(oldValue, mutation, reason) {
    const revision = this._viewRevision;
    const event = { oldValue, newValue: this.getViewportState(), reason };
    this._emit("viewportChange", event, mutation);
    if (!this.destroyed && revision === this._viewRevision) this._emit("afterViewportChange", { ...event }, mutation);
  }

  _emit(name, payload, mutation) {
    if (!mutation.silent && !this.destroyed) this.events.emit(name, Object.assign(payload, {
      type: name, source: this, origin: mutation.origin, userAction: mutation.userAction, silent: false
    }));
  }

  _setStatus(status, error = null) {
    this._status = status;
    this._lastError = error;
    if (this.element) {
      this.element.dataset.renderStatus = status;
      this.element.setAttribute("aria-busy", String(status === "rendering"));
    }
  }

  _canRender() {
    return !this.destroyed && this.mounted && this._renderer && this._contentSize.width > 0 && this._viewportSize.width > 0 && this._viewportSize.height > 0;
  }

  _cancelRender() {
    const generation = ++this._generation;
    clearTimeout(this._renderTimer);
    this._renderTimer = null;
    const pending = this._pendingRequest;
    this._pendingRequest = null;
    pending?.controller.abort();
    return generation;
  }

  _invalidateRender(reason, mutation, delay) {
    const generation = this._cancelRender();
    if (this.destroyed || generation !== this._generation) return;
    this._setStatus(this._canRender() ? "rendering" : this._raster ? "ready" : "empty");
    if (!this._canRender()) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      if (!this.destroyed) void this._renderNow(mutation, reason);
    }, delay);
  }

  async _renderNow(mutation, reason) {
    if (!this._canRender()) {
      this._setStatus(this._raster ? "ready" : "empty");
      return false;
    }
    const generation = this._generation;
    const controller = new AbortController();
    const target = rasterTarget(this._contentSize, this.zoom, this._dpr, this._maxRasterPixels, this._maxRasterDimension);
    const request = Object.freeze({ requestId: generation, contentWidth: this._contentSize.width, contentHeight: this._contentSize.height,
      viewportWidth: this._viewportSize.width, viewportHeight: this._viewportSize.height,
      targetWidth: target.width, targetHeight: target.height, zoom: this.zoom, devicePixelRatio: this._dpr,
      signal: controller.signal, reason, origin: mutation.origin, userAction: mutation.userAction });
    this._pendingRequest = { controller, request };
    this._setStatus("rendering");
    this._emit("renderStart", { request }, mutation);
    const current = () => !this.destroyed && generation === this._generation && !controller.signal.aborted;
    if (!current()) return false;
    let result;
    let raster;
    try {
      result = await this._renderer(request);
      if (!current()) { this._releaseResult(result); return false; }
      raster = this._normalizeRaster(result);
    } catch (error) {
      this._releaseResult(result);
      if (!current()) return false;
      this._pendingRequest = null;
      this._setStatus("error", error);
      this._emit("renderError", { request, error, hasRaster: this.hasRaster }, mutation);
      return false;
    }
    const old = this._raster;
    // Swap atomically before releasing the old image: annotation/progress hosts
    // must observe one accepted raster identity, never a half-composited frame.
    // Reusing the same bitmap cannot revoke a previous ownership transfer.
    if (old?.original === raster.original && old.owned) raster.owned = true;
    this._raster = raster;
    this._releaseRaster(old);
    this._pendingRequest = null;
    this._setStatus("ready");
    this._scheduleDraw();
    this._emit("renderComplete", { request, rasterWidth: raster.width, rasterHeight: raster.height }, mutation);
    return true;
  }

  _normalizeRaster(result) {
    const image = result?.image;
    if (nativeInstance(image, "ImageData")) {
      const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(image.width, image.height) : document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("ImageData conversion requires Canvas 2D.");
      context.putImageData(image, 0, 0);
      return { image: canvas, original: image, width: image.width, height: image.height, converted: true };
    }
    const bitmap = nativeInstance(image, "ImageBitmap");
    const htmlImage = nativeInstance(image, "HTMLImageElement");
    if (!bitmap && !htmlImage && !nativeInstance(image, "HTMLCanvasElement") && !nativeInstance(image, "OffscreenCanvas")) {
      throw new TypeError("renderer must return { image } with an ImageBitmap, loaded HTMLImageElement, canvas, OffscreenCanvas or ImageData.");
    }
    const width = htmlImage ? image.naturalWidth : image.width;
    const height = htmlImage ? image.naturalHeight : image.height;
    if ((htmlImage && !image.complete) || !width || !height) throw new TypeError("Renderer image must be loaded and have nonzero dimensions.");
    return { image, original: image, width, height, owned: bitmap && result.owned === true };
  }

  _releaseResult(result) {
    if (result?.owned === true && nativeInstance(result.image, "ImageBitmap") && result.image !== this._raster?.original && !this._releasedImages.has(result.image)) {
      this._releasedImages.add(result.image);
      result.image.close();
    }
  }

  _releaseRaster(raster) {
    if (!raster || raster.image === this._raster?.image) return;
    if (raster.converted) { raster.image.width = 0; raster.image.height = 0; }
    else this._releaseResult({ image: raster.original, owned: raster.owned });
  }

  _scheduleDraw() {
    if (!this.mounted || this.destroyed || this._frame !== null || this._inFrame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      if (this.destroyed) return;
      this._inFrame = true;
      try {
        const pending = this._pendingView;
        this._pendingView = null;
        if (pending && !this.disabled) this._commitView(pending.view, USER, pending.reason);
        if (!this.destroyed) this._draw();
      } finally { this._inFrame = false; }
    });
  }

  _draw() {
    const ctx = this._context;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    if (!this._raster) return;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this._raster.image, this._view.panX, this._view.panY, this._contentSize.width * this.zoom, this._contentSize.height * this.zoom);
  }

  _queueView(view, reason) {
    this._pendingView = { view: constrainView(view, this._contentSize, this._viewportSize), reason };
    this._scheduleDraw();
  }

  _localPoint(event) {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left - this.element.clientLeft, y: event.clientY - rect.top - this.element.clientTop };
  }

  _wheel(event) {
    if (event.defaultPrevented || this.disabled || !this._contentSize.width || this._wheelZoom === "none" ||
      (this._wheelZoom === "ctrl" && !event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this._viewportSize.height : 1);
    if (!delta) return;
    const view = this._pendingView?.view ?? this._view;
    const zoom = clamp(view.zoom * Math.exp(clamp(-delta * 0.002, -1, 1)), this._minZoom, this._maxZoom);
    this._queueView(anchoredZoom(view, zoom, this._localPoint(event)), "wheel");
  }

  _pointerDown(event) {
    if (this.disabled || !this._panEnabled || !this._contentSize.width || this._drag || event.button !== 0 || event.isPrimary === false) return;
    this.focus();
    this._drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.element.setPointerCapture(event.pointerId);
    this.element.classList.add("dui-render-viewport--dragging");
    event.preventDefault();
  }

  _pointerMove(event) {
    if (!this._drag || this.disabled || event.pointerId !== this._drag.id) return;
    const view = this._pendingView?.view ?? this._view;
    this._queueView({ ...view, panX: view.panX + event.clientX - this._drag.x, panY: view.panY + event.clientY - this._drag.y }, "pan");
    this._drag.x = event.clientX;
    this._drag.y = event.clientY;
  }

  _endDrag() {
    const drag = this._drag;
    this._drag = null;
    this.element?.classList.remove("dui-render-viewport--dragging");
    if (drag && this.element?.hasPointerCapture(drag.id)) this.element.releasePointerCapture(drag.id);
  }

  _keyDown(event) {
    if (event.defaultPrevented || this.disabled || !this._contentSize.width || event.ctrlKey || event.metaKey || event.altKey) return;
    const directions = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (directions[event.key] && this._panEnabled) this.panBy(...directions[event.key], USER);
    else if (event.key === "+" || event.key === "=") this.zoomBy(1.2, USER);
    else if (event.key === "-") this.zoomBy(1 / 1.2, USER);
    else if (event.key === "Home") this.fit("fit", USER);
    else return;
    event.preventDefault();
  }

  destroy() {
    if (this.destroyed || this._tearingDown) return;
    this._tearingDown = true;
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._pendingView = null;
    this._endDrag();
    this._dprCleanup?.();
    this._dprCleanup = null;
    // Detach listeners and finish BaseControl lifecycle before notifying external
    // abort listeners, which may themselves call back into this control.
    super.destroy();
    this._cancelRender();
    const raster = this._raster;
    this._raster = null;
    this._releaseRaster(raster);
    this._renderer = null;
    if (this._canvas) { this._canvas.width = 0; this._canvas.height = 0; }
    this._canvas = null;
    this._context = null;
    this._status = "empty";
    this._lastError = null;
    this._tearingDown = false;
  }
}

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  return value;
}
function positive(value, name) {
  if (finite(value, name) <= 0) throw new RangeError(`${name} must be positive.`);
  return value;
}
function nonNegative(value, name) {
  if (finite(value, name) < 0) throw new RangeError(`${name} must be nonnegative.`);
  return value;
}
function contentSize(width, height) {
  nonNegative(width, "contentWidth"); nonNegative(height, "contentHeight");
  if ((width === 0) !== (height === 0)) throw new RangeError("Empty content requires both dimensions to be zero.");
  return { width, height };
}
function rendererOrNull(renderer) {
  if (renderer != null && typeof renderer !== "function") throw new TypeError("renderer must be a function or null.");
  return renderer ?? null;
}
function nativeInstance(value, name) {
  return typeof globalThis[name] === "function" && value instanceof globalThis[name];
}
function sameView(a, b) {
  return a.zoom === b.zoom && a.panX === b.panX && a.panY === b.panY && a.mode === b.mode;
}

// Extension-owned guard: BaseControl private/protected internals are not a dependency.
function assertViewportMutable(control, operation) {
  if (control.destroyed || control._tearingDown) {
    throw new LifecycleError(`Cannot call ${operation}() on destroyed control ${control.id}.`, control, operation);
  }
}
