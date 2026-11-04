import { Popup } from "./Popup.js";

export class Tooltip extends Popup {
  constructor(options = {}) {
    super({
      ...options,
      role: "tooltip",
      className: ["dui-tooltip", options.className].filter(Boolean).join(" "),
      placement: options.placement ?? "top-start",
      offset: options.offset ?? 6,
      closeOnOutsideClick: false,
      closeOnEscape: options.closeOnEscape !== false,
      restoreFocus: false
    });
    this.showDelay = Math.max(0, Number(options.showDelay ?? 500));
    this.hideDelay = Math.max(0, Number(options.hideDelay ?? 100));
    this.openOnHover = options.openOnHover !== false;
    this.openOnFocus = options.openOnFocus !== false;
    this._anchorElement = null;
    this._anchorDisposers = [];
    this._showTimer = null;
    this._hideTimer = null;
  }

  attach(anchor = this.anchor) {
    this._assertMutable("attach");
    this.detach();
    this._anchorElement = resolveTooltipAnchor(anchor);
    this.anchor = this._anchorElement;

    if (this.openOnHover) {
      this._listen(this._anchorElement, "pointerenter", event => this.scheduleOpen("hover", event));
      this._listen(this._anchorElement, "pointerleave", () => this.scheduleClose("hover"));
    }
    if (this.openOnFocus) {
      this._listen(this._anchorElement, "focusin", event => this.scheduleOpen("focus", event));
      this._listen(this._anchorElement, "focusout", () => this.scheduleClose("focus"));
    }
    return this;
  }

  detach() {
    this._clearTimers();
    for (const dispose of this._anchorDisposers.splice(0)) dispose();
    this.close({ silent: true, reason: "detach" });
    this._unlinkDescription();
    this._anchorElement = null;
    return this;
  }

  scheduleOpen(origin = "api", nativeEvent = null) {
    this._clearHideTimer();
    if (this.isOpen()) return this;
    clearTimeout(this._showTimer);
    this._showTimer = setTimeout(() => {
      this._showTimer = null;
      this.open(this._anchorElement, { origin, userAction: origin !== "api", nativeEvent });
    }, this.showDelay);
    return this;
  }

  scheduleClose(origin = "api") {
    this._clearShowTimer();
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this._hideTimer = null;
      this.close({ origin, userAction: origin !== "api", reason: origin });
    }, this.hideDelay);
    return this;
  }

  open(anchor = this._anchorElement ?? this.anchor, options = {}) {
    this._clearTimers();
    const opened = super.open(anchor, options);
    if (opened) this._linkDescription();
    return opened;
  }

  close(options = {}) {
    this._clearTimers();
    const closed = super.close(options);
    if (closed || !this.isOpen()) this._unlinkDescription();
    return closed;
  }

  focus() {
    return false;
  }

  destroy() {
    if (this.destroyed) return;
    this.detach();
    super.destroy();
  }

  _listen(target, type, handler) {
    target.addEventListener(type, handler);
    this._anchorDisposers.push(() => target.removeEventListener(type, handler));
  }

  _linkDescription() {
    if (!this.element || !this._anchorElement) return;
    this.element.id ||= `${this.id}-tooltip`;
    const ids = new Set((this._anchorElement.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
    ids.add(this.element.id);
    this._anchorElement.setAttribute("aria-describedby", [...ids].join(" "));
  }

  _unlinkDescription() {
    if (!this.element?.id || !this._anchorElement) return;
    const ids = (this._anchorElement.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(id => id && id !== this.element.id);
    if (ids.length) this._anchorElement.setAttribute("aria-describedby", ids.join(" "));
    else this._anchorElement.removeAttribute("aria-describedby");
  }

  _clearShowTimer() {
    clearTimeout(this._showTimer);
    this._showTimer = null;
  }

  _clearHideTimer() {
    clearTimeout(this._hideTimer);
    this._hideTimer = null;
  }

  _clearTimers() {
    this._clearShowTimer();
    this._clearHideTimer();
  }
}

function resolveTooltipAnchor(anchor) {
  if (typeof anchor === "string") anchor = document.querySelector(anchor);
  if (anchor?.element instanceof HTMLElement) anchor = anchor.element;
  if (anchor instanceof HTMLElement) return anchor;
  throw new TypeError("Tooltip requires a Control, HTMLElement, or selector anchor.");
}
