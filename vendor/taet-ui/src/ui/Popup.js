import { BaseControl } from "../core/BaseControl.js";
import { DisposableBag } from "../core/DisposableBag.js";
import { overlayManager } from "../core/OverlayManager.js";
import { overlayScale } from "./overlayGeometry.js";

export class Popup extends BaseControl {
  constructor(options = {}) {
    super({ tabIndex:-1, ...options, visible:false });
    this.anchor = options.anchor ?? null;
    this.content = options.content ?? null;
    this.placement = options.placement ?? "bottom-start";
    this.offset = Number(options.offset ?? 4);
    this.matchAnchorWidth = options.matchAnchorWidth === true;
    this.modal = options.modal === true;
    this.closeOnOutsideClick = options.closeOnOutsideClick !== false;
    this.closeOnEscape = options.closeOnEscape !== false;
    this.restoreFocus = options.restoreFocus !== false;
    this.manager = options.manager ?? overlayManager;
    this.className = options.className ?? "";
    this.role = options.role ?? "dialog";
    this.opened = false;
    this._openDisposables = null;
    this._contentMountedByPopup = false;
    this._popupRevision = 0;
    this._opening = false;
    this._closing = false;
    this._destroyingPopup = false;
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-popup", this.className].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiOverlay = "popup";
    root.tabIndex = -1;
    root.setAttribute("role", this.role);
    root.hidden = true;
    this._mountContent(root);
    return root;
  }

  open(anchor = this.anchor, options = {}) {
    this._assertMutable("open");
    if (this._opening || this._destroyingPopup) return false;
    this._opening = true;
    const revision = ++this._popupRevision;
    const current = () => !this.destroyed && !this._destroyingPopup && revision === this._popupRevision;
    try {
      const anchorElement = anchor == null && this.modal ? null : resolveAnchor(anchor);
      const event = { source:this, anchor:anchorElement, cancel:false,
        origin:options.origin??"api", userAction:options.userAction===true };
      if (!options.silent) this.events.emit("beforeOpen", event);
      if (event.cancel || !current()) return false;
      if (!this.mounted) this.mount(this.manager.getRoot());
      if (!current()) return false;
      this.anchor = anchorElement;
      this.visible = true;
      this._applyVisibilityState();
      this.opened = true;
      this.manager.open(this, {
        anchor:anchorElement,
        modal:this.modal,
        closeOnOutsideClick:this.closeOnOutsideClick,
        closeOnEscape:this.closeOnEscape,
        restoreFocus:this.restoreFocus,
        silent:options.silent,
        requestClose:request => this.close({ origin:"user", userAction:true, reason:request.reason })
      });
      if (!current() || !this.opened) return false;
      this._openDisposables?.dispose();
      this._openDisposables = new DisposableBag();
      this._openDisposables.addEventListener(window, "resize", () => this.reposition());
      this._openDisposables.addEventListener(document, "scroll", () => this.reposition(), true);
      this.reposition();
      const opening = this._openDisposables;
      queueMicrotask(() => {
        if (!this.destroyed && this.opened && this._openDisposables === opening) this.focus();
      });
      if (!options.silent) this.events.emit("open", { ...event, cancel:undefined });
      return current() && this.opened;
    } finally {
      this._opening = false;
    }
  }

  close(options = {}) {
    if (!this.opened || (this._closing && !this._destroyingPopup)) return false;
    this._closing = true;
    const revision = ++this._popupRevision;
    try {
      const event = { source:this, cancel:false, reason:options.reason??"api", result:options.result,
        origin:options.origin??"api", userAction:options.userAction===true };
      if (!options.silent) this.events.emit("beforeClose", event);
      if (event.cancel || this.destroyed || revision !== this._popupRevision) return false;
      this._openDisposables?.dispose();
      this._openDisposables = null;
      this.opened = false;
      this.visible = false;
      this._applyVisibilityState();
      this._onCloseCommitted(options);
      this.manager.close(this, { silent:options.silent, restoreFocus:this.restoreFocus });
      if (!options.silent && !this.destroyed && revision === this._popupRevision) this.events.emit("close", event);
      return true;
    } finally {
      this._closing = false;
    }
  }

  isOpen() { return this.opened; }

  // Subclasses release per-opening resources before manager/close callbacks can
  // reopen the same control or throw. A veto never reaches this boundary.
  _onCloseCommitted(_options) {}

  reposition() {
    if (!this.opened || !this.element) return false;
    const scale = overlayScale(this.element);
    if (!this.anchor) {
      const popup = this.element.getBoundingClientRect();
      this.element.style.left = `${Math.max(4, Math.round((window.innerWidth - popup.width) / 2)) / scale}px`;
      this.element.style.top = `${Math.max(4, Math.round((window.innerHeight - popup.height) / 2)) / scale}px`;
      return true;
    }
    if (!this.anchor.isConnected) return false;
    const anchor = this.anchor.getBoundingClientRect();
    const viewportGap = 4;
    if (this.matchAnchorWidth) this.element.style.minWidth = `${Math.round(anchor.width) / scale}px`;
    const popup = this.element.getBoundingClientRect();
    let left = this.placement.endsWith("end") ? anchor.right - popup.width : anchor.left;
    let top = this.placement.startsWith("top") ? anchor.top - popup.height - this.offset : anchor.bottom + this.offset;
    if (top + popup.height > window.innerHeight - viewportGap && anchor.top >= popup.height + this.offset) {
      top = anchor.top - popup.height - this.offset;
    }
    if (top < viewportGap) top = Math.min(anchor.bottom + this.offset, window.innerHeight - popup.height - viewportGap);
    left = Math.max(viewportGap, Math.min(left, window.innerWidth - popup.width - viewportGap));
    this.element.style.left = `${Math.round(left) / scale}px`;
    this.element.style.top = `${Math.round(top) / scale}px`;
    return true;
  }

  destroy() {
    if (this.destroyed || this._destroyingPopup) return;
    this._destroyingPopup = true;
    this.close({ silent:true });
    ++this._popupRevision;
    const content = this.content;
    super.destroy();
    if (this._contentMountedByPopup && this.options.destroyContent === true) content?.destroy?.();
    this.content = null;
    this.anchor = null;
  }

  _mountContent(root) {
    if (this.content == null) return;
    if (typeof Node !== "undefined" && this.content instanceof Node) { root.appendChild(this.content); return; }
    if (typeof this.content.mount === "function") {
      this._contentMountedByPopup = true;
      this.content.mount(root);
      return;
    }
    root.textContent = String(this.content);
  }
}

function resolveAnchor(anchor) {
  if (typeof anchor === "string") return document.querySelector(anchor);
  if (anchor instanceof HTMLElement) return anchor;
  if (anchor?.element instanceof HTMLElement) return anchor.element;
  throw new TypeError("Popup requires a Control, HTMLElement, or selector anchor.");
}
