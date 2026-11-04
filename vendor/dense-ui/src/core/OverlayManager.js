import { EventBus } from "./EventBus.js";

export class OverlayManager {
  constructor(options = {}) {
    this.baseZIndex = Number(options.baseZIndex ?? 1000);
    this.events = new EventBus();
    this._entries = [];
    this._root = null;
    this._listening = false;
    this._stackRevision = 0;
    this._pointerDown = event => this._handlePointerDown(event);
    this._keyDown = event => this._handleKeyDown(event);
  }

  getRoot() {
    if (!this._root) {
      this._root = document.createElement("div");
      this._root.className = "dui-overlay-root";
      this._root.dataset.duiOverlayRoot = "true";
      document.body.appendChild(this._root);
    }
    return this._root;
  }

  all() { return this._entries.map(entry => entry.overlay); }
  top() { return this._entries.at(-1)?.overlay ?? null; }
  has(overlay) { return this._entries.some(entry => entry.overlay === overlay); }

  open(overlay, options = {}) {
    const element = options.element ?? overlay?.element;
    if (!element) throw new TypeError("OverlayManager requires an overlay element.");
    this.close(overlay, { silent:true, restoreFocus:false });
    const entry = {
      overlay,
      element,
      anchor:options.anchor ?? null,
      modal:options.modal === true,
      closeOnOutsideClick:options.closeOnOutsideClick !== false,
      closeOnEscape:options.closeOnEscape !== false,
      restoreFocus:options.restoreFocus !== false,
      previousFocus:document.activeElement instanceof HTMLElement ? document.activeElement : null,
      requestClose:options.requestClose,
      containsTarget:typeof options.containsTarget === "function" ? options.containsTarget : null
    };
    if (entry.modal) {
      entry.backdrop = document.createElement("div");
      entry.backdrop.className = "dui-overlay-backdrop";
      this.getRoot().insertBefore(entry.backdrop, entry.element);
    }
    this._entries.push(entry);
    ++this._stackRevision;
    this._syncStack();
    this._startListening();
    if (!options.silent) this.events.emit("open", { source:this, overlay, modal:entry.modal });
    return entry;
  }

  close(overlay, options = {}) {
    const index = this._entries.findIndex(entry => entry.overlay === overlay);
    if (index < 0) return false;
    const [entry] = this._entries.splice(index, 1);
    const revision = ++this._stackRevision;
    entry.backdrop?.remove();
    this._syncStack();
    if (!this._entries.length) this._stopListening();
    if (options.restoreFocus !== false && entry.restoreFocus && entry.previousFocus?.isConnected) {
      queueMicrotask(() => {
        const modalIndex = this._entries.findLastIndex(item => item.modal);
        const permitted = modalIndex < 0 || this._entries.slice(modalIndex).some(item => item.element.contains(entry.previousFocus));
        if (revision === this._stackRevision && entry.previousFocus?.isConnected &&
            permitted && !entry.previousFocus.closest('[hidden], [inert]')) entry.previousFocus.focus({ preventScroll:true });
      });
    }
    if (!options.silent) this.events.emit("close", { source:this, overlay, modal:entry.modal });
    return true;
  }

  destroy() {
    ++this._stackRevision;
    for (const entry of [...this._entries]) this.close(entry.overlay, { silent:true, restoreFocus:false });
    this._stopListening();
    this._root?.remove();
    this._root = null;
    this.events.destroy();
  }

  _requestClose(entry, reason, nativeEvent) {
    if (typeof entry.requestClose === "function") {
      entry.requestClose({ reason, nativeEvent });
    } else {
      entry.overlay.close?.({ origin:"user", userAction:true, reason });
    }
  }

  _handlePointerDown(event) {
    const entry = this._entries.at(-1);
    if (!entry || entry.element.contains(event.target) || entry.anchor?.contains?.(event.target) || entry.containsTarget?.(event.target)) return;
    if (entry.closeOnOutsideClick) this._requestClose(entry, "outside-click", event);
  }

  _handleKeyDown(event) {
    const entry = this._entries.at(-1);
    if (!entry) return;
    if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented && entry.closeOnEscape) {
      event.preventDefault();
      this._requestClose(entry, "escape", event);
      return;
    }
    if (event.key === "Tab") {
      const index = this._entries.findLastIndex(item => item.modal);
      if (index >= 0) this._trapFocus(event, this._entries[index].element, this._entries.slice(index + 1).map(item => item.element));
    }
  }

  _trapFocus(event, element, additional = []) {
    const focusable = [element, ...additional].flatMap(root => [...root.querySelectorAll(
      'a[href], area[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'
    )]).filter(item => item.tabIndex >= 0 && !item.matches(':disabled') &&
      !item.closest('[hidden], [inert]') && item.getClientRects().length &&
      getComputedStyle(item).visibility !== 'hidden');
    if (!focusable.length) { event.preventDefault(); element.focus({ preventScroll:true }); return; }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!focusable.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  _syncStack() {
    this._entries.forEach((entry, index) => {
      const zIndex = this.baseZIndex + index * 2;
      if (entry.backdrop) entry.backdrop.style.zIndex = String(zIndex);
      entry.element.style.zIndex = String(zIndex + 1);
    });
  }

  _startListening() {
    if (this._listening) return;
    document.addEventListener("pointerdown", this._pointerDown, true);
    document.addEventListener("keydown", this._keyDown, true);
    this._listening = true;
  }

  _stopListening() {
    if (!this._listening || typeof document === "undefined") return;
    document.removeEventListener("pointerdown", this._pointerDown, true);
    document.removeEventListener("keydown", this._keyDown, true);
    this._listening = false;
  }
}

export const overlayManager = new OverlayManager();
