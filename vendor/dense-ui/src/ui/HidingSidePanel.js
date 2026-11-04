import { Panel } from "./Panel.js";

const user = { origin: "user", userAction: true };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function sideValue(value) {
  if (value !== "left" && value !== "right") throw new TypeError("Side must be left or right.");
  return value;
}
function numberValue(value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new TypeError("Invalid side panel geometry.");
  return value;
}

/** Non-modal overlay. Mount in a positioned host; it never reserves layout space. */
export class HidingSidePanel extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer = typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions;
    super(options);
    this.side = sideValue(options.side ?? "left");
    this.tabPosition = numberValue(options.tabPosition ?? 0.35, 0, 1);
    this.panelWidth = numberValue(options.panelWidth ?? 290, 96, 16384);
    this.opened = options.opened === true;
    this.title = options.title ?? "Panel";
    if (hasContainer) this.mount(containerOrOptions);
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-hiding-side-panel", this.css, this.className].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    this._drawer = document.createElement("section");
    this._drawer.className = "dui-hiding-side-panel__drawer";
    this._drawer.id = `${this.id}-drawer`;
    this._drawer.setAttribute("aria-label", this.title);
    const header = document.createElement("header");
    header.className = "dui-window-header";
    const title = document.createElement("span");
    title.className = "dui-window-header__title";
    title.textContent = this.title;
    this._close = document.createElement("button");
    this._close.type = "button";
    this._close.className = "dui-hiding-side-panel__close";
    this._close.textContent = "×";
    this._close.setAttribute("aria-label", optionsLabel(this.options, "closeLabel", `Close ${this.title}`));
    header.append(title, this._close);
    this._content = document.createElement("div");
    this._content.className = "dui-hiding-side-panel__content";
    this._resize = document.createElement("div");
    this._resize.className = "dui-hiding-side-panel__resize";
    this._resize.tabIndex = 0;
    this._resize.setAttribute("role", "separator");
    this._resize.setAttribute("aria-orientation", "vertical");
    this._resize.setAttribute("aria-label", optionsLabel(this.options, "resizeLabel", `Resize ${this.title}`));
    this._drawer.append(header, this._content, this._resize);
    this._tab = document.createElement("button");
    this._tab.type = "button";
    this._tab.className = "dui-hiding-side-panel__tab";
    this._tab.setAttribute("aria-label", this.title);
    this._tab.setAttribute("aria-controls", this._drawer.id);
    this._tab.title = optionsLabel(this.options, "tabHint", `${this.title}: click to toggle; drag to move. Alt+arrows to reposition.`);
    root.append(this._drawer, this._tab);
    const on = (target, type, fn, opts) => this.disposables.addEventListener(target, type, fn, opts);
    on(this._close, "click", () => this.setOpen(false, user));
    on(this._tab, "click", event => {
      event.stopPropagation();
      const suppressed = this._suppressClick && event.detail !== 0;
      this._suppressClick = false;
      if (suppressed) return;
      if (!this.disabled) this.toggle(user);
    });
    on(this._tab, "keydown", event => {
      if (!event.altKey || !event.key.startsWith("Arrow") || this.disabled) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") this.setPlacement(event.key === "ArrowLeft" ? "left" : "right", this.tabPosition, user);
      else this.setPlacement(this.side, clamp(this.tabPosition + (event.key === "ArrowUp" ? -0.05 : 0.05), 0, 1), user);
    });
    on(root, "keydown", event => {
      if (event.key === "Escape" && !event.defaultPrevented && this.opened) {
        event.preventDefault(); event.stopPropagation(); this.setOpen(false, user);
      }
    });
    on(this._resize, "keydown", event => {
      if (this.disabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const direction = (event.key === "ArrowRight" ? 1 : -1) * (this.side === "left" ? 1 : -1);
      this.setPanelWidth(clamp(this.panelWidth + direction * 10, 96, this._maxWidth()), user);
    });
    for (const [target, kind] of [[this._tab, "tab"], [this._resize, "resize"]]) {
      on(target, "pointerdown", event => this._startDrag(event, kind, target));
      on(target, "pointermove", event => this._moveDrag(event));
      on(target, "pointerup", event => this._finishDrag(event, false));
      on(target, "pointercancel", event => this._finishDrag(event, true));
      on(target, "lostpointercapture", event => this._finishDrag(event, true));
    }
    return root;
  }

  mount(container) {
    const wasMounted = this.mounted;
    super.mount(container);
    if (wasMounted || this.destroyed) return this;
    const host = this.element.parentElement;
    // Deliberately scoped to the host: portalled menus/dialogs and external toggle
    // buttons must not dismiss on pointerdown and then reopen on their click.
    this.disposables.addEventListener(host, "pointerdown", event => {
      if (this.opened && !this.element.contains(event.target)) this.setOpen(false, { ...user, restoreFocus: false });
    }, true);
    const observer = new ResizeObserver(() => { if (!this.destroyed) this._sync(); });
    observer.observe(this.element);
    this.disposables.add(() => observer.disconnect());
    this.disposables.add(() => {
      const drag = this._drag;
      this._drag = null;
      if (drag?.target.hasPointerCapture(drag.id)) drag.target.releasePointerCapture(drag.id);
    });
    this._sync();
    if (this.options.content) this.add(this.options.content);
    return this;
  }

  getContentElement() { return this._content ?? this.element; }
  getFocusElement() { return this._tab ?? this.element; }

  setOpen(opened, options = {}) {
    this._assertMutable("setOpen");
    opened = opened === true;
    if (opened === this.opened) return this;
    const oldValue = this.opened;
    if (opened) {
      const active = document.activeElement;
      this._returnFocus = active && active !== document.body && active !== document.documentElement ? active : this._tab;
    }
    else if (options.restoreFocus !== false && this._drawer?.contains(document.activeElement)) {
      const target = this._returnFocus?.isConnected ? this._returnFocus : this._tab;
      target?.focus({ preventScroll: true });
    }
    this.opened = opened;
    this._sync();
    this._emit("openChange", oldValue, opened, options);
    return this;
  }
  toggle(options) { return this.setOpen(!this.opened, options); }
  setPlacement(side, tabPosition, options = {}) {
    this._assertMutable("setPlacement");
    side = sideValue(side); tabPosition = numberValue(tabPosition, 0, 1);
    const oldValue = { side: this.side, tabPosition: this.tabPosition };
    this.side = side; this.tabPosition = tabPosition;
    this._sync();
    if (oldValue.side !== side || oldValue.tabPosition !== tabPosition) this._emit("placementChange", oldValue, { side, tabPosition }, options);
    return this;
  }
  setPanelWidth(width, options = {}) {
    this._assertMutable("setPanelWidth");
    const oldValue = this.panelWidth;
    this.panelWidth = numberValue(width, 96, 16384);
    this._sync();
    if (oldValue !== width) this._emit("widthChange", oldValue, width, options);
    return this;
  }
  _emit(type, oldValue, value, options) {
    if (!options.silent) this.events.emit(type, { source: this, type, oldValue, value, origin: options.origin ?? "api", userAction: options.userAction === true });
  }
  _maxWidth() { return Math.max(96, (this.element?.clientWidth ?? 0) - 24); }
  _sync() {
    if (!this.element) return;
    this.element.dataset.side = this.side;
    this.element.classList.toggle("dui-hiding-side-panel--open", this.opened);
    this.element.style.setProperty("--dui-side-panel-width", `${Math.min(this.panelWidth, this._maxWidth())}px`);
    const space = Math.max(0, this.element.clientHeight - this._tab.offsetHeight);
    this._tab.style.top = `${this.tabPosition * space}px`;
    this._tab.setAttribute("aria-expanded", String(this.opened));
    this._drawer.inert = !this.opened || this.disabled;
    this._drawer.setAttribute("aria-hidden", String(!this.opened));
    this._tab.disabled = this.disabled;
    this._resize.setAttribute("aria-valuemin", "96");
    this._resize.setAttribute("aria-valuemax", String(this._maxWidth()));
    this._resize.setAttribute("aria-valuenow", String(Math.min(this.panelWidth, this._maxWidth())));
  }
  _applyDisabledState() { super._applyDisabledState(); this._sync(); }
  _startDrag(event, kind, target) {
    if (this.disabled || event.button !== 0 || this._drag) return;
    this._suppressClick = false;
    this._drag = { id: event.pointerId, target, kind, x: event.clientX, y: event.clientY,
      side: this.side, position: this.tabPosition, width: this.panelWidth, moved: false };
    target.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }
  _moveDrag(event) {
    const drag = this._drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    drag.moved = true;
    event.preventDefault(); event.stopPropagation();
    this.element.classList.add("dui-hiding-side-panel--dragging");
    if (drag.kind === "resize") {
      this.setPanelWidth(clamp(drag.width + (event.clientX - drag.x) * (drag.side === "left" ? 1 : -1), 96, this._maxWidth()), { silent: true });
    } else {
      const rect = this.element.getBoundingClientRect();
      const side = event.clientX <= rect.left + 40 ? "left" : event.clientX >= rect.right - 40 ? "right" : this.side;
      const travel = Math.max(1, rect.height - this._tab.offsetHeight);
      this.setPlacement(side, clamp(drag.position + (event.clientY - drag.y) / travel, 0, 1), { silent: true });
    }
  }
  _finishDrag(event, canceled) {
    const drag = this._drag;
    if (!drag || event.pointerId !== drag.id) return;
    this._drag = null;
    if (drag.target.hasPointerCapture(drag.id)) drag.target.releasePointerCapture(drag.id);
    this.element.classList.remove("dui-hiding-side-panel--dragging");
    if (!drag.moved) return;
    this._suppressClick = drag.kind === "tab";
    if (canceled) {
      this.setPlacement(drag.side, drag.position, { silent: true });
      this.setPanelWidth(drag.width, { silent: true });
    } else if (drag.kind === "tab") {
      this._emit("placementChange", { side: drag.side, tabPosition: drag.position }, { side: this.side, tabPosition: this.tabPosition }, user);
    } else this._emit("widthChange", drag.width, this.panelWidth, user);
  }
}

function optionsLabel(options, name, fallback) { return options[name] ?? fallback; }
