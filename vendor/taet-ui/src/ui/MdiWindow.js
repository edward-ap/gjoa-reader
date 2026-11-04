import { listenUntilPointerUp } from "../core/pointerTracking.js";
import { createHeaderAction } from "./HeaderAction.js";
import { Panel } from "./Panel.js";

export class MdiWindow extends Panel {
  constructor(options = {}) {
    super({ ...options, width:null, height:null, observeResize:true });
    this.title = options.title ?? options.label ?? options.name ?? this.id;
    this.x = finite(options.x, 0);
    this.y = finite(options.y, 0);
    this.windowWidth = Math.max(options.minWidth ?? 180, finite(options.width, 320));
    this.windowHeight = Math.max(options.minHeight ?? 96, finite(options.height, 260));
    this.minWidth = options.minWidth ?? 180;
    this.minHeight = options.minHeight ?? 96;
    this.maxWidth = options.maxWidth ?? Infinity;
    this.maxHeight = options.maxHeight ?? Infinity;
    this.movable = options.movable !== false;
    this.resizable = options.resizable !== false;
    this.collapsible = options.collapsible !== false;
    this.closeable = options.closeable !== false;
    this.collapsed = options.collapsed === true;
    this.content = options.content ?? null;
    this._contentElement = null;
    this._restoreHeight = this.windowHeight;
    this._pointerTracking = null;
  }

  createElement() {
    const root = document.createElement("section");
    root.className = ["dui-control", "dui-mdi-window", this.className].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiMdiWindowId = this.id;

    const header = document.createElement("header");
    header.className = "dui-window-header dui-mdi-window__header";
    const title = document.createElement("span");
    title.className = "dui-window-header__title dui-mdi-window__title";
    title.textContent = this.title;
    const actions = document.createElement("span");
    actions.className = "dui-window-header__actions";
    if (this.collapsible) actions.appendChild(this._createAction("collapse"));
    if (this.closeable) actions.appendChild(this._createAction("close"));
    header.append(title, actions);

    const content = document.createElement("div");
    content.className = "dui-mdi-window__content";
    this._contentElement = content;
    root.append(header, content);

    if (this.resizable) {
      const resize = document.createElement("div");
      resize.className = "dui-mdi-window__resize";
      resize.setAttribute("aria-hidden", "true");
      root.appendChild(resize);
      this.disposables.addEventListener(resize, "pointerdown", event => this._startResize(event));
    }
    this.disposables.addEventListener(header, "pointerdown", event => this._startMove(event));
    this.disposables.addEventListener(root, "pointerdown", () => this.parent?.activateWindow?.(this));
    this._applyBounds(root);
    this._applyCollapsed(root);
    return root;
  }

  mount(container) {
    super.mount(container);
    this._applyBounds();
    this._applyCollapsed();
    if (this.content && !this.items.includes(this.content)) this.attach(this.content);
    return this;
  }

  getContentElement() {
    return this._contentElement ?? this.element;
  }

  getBounds() {
    return { x:this.x, y:this.y, width:this.windowWidth, height:this.windowHeight };
  }

  setBounds(bounds = {}, options = {}) {
    this._assertMutable("setBounds");
    const oldBounds = this.getBounds();
    const next = {
      x:Object.prototype.hasOwnProperty.call(bounds, "x") ? finite(bounds.x, this.x) : this.x,
      y:Object.prototype.hasOwnProperty.call(bounds, "y") ? finite(bounds.y, this.y) : this.y,
      width:Object.prototype.hasOwnProperty.call(bounds, "width")
        ? clamp(finite(bounds.width, this.windowWidth), this.minWidth, this.maxWidth)
        : this.windowWidth,
      height:Object.prototype.hasOwnProperty.call(bounds, "height")
        ? clamp(finite(bounds.height, this.windowHeight), this.minHeight, this.maxHeight)
        : this.windowHeight
    };
    const before = { source:this, oldBounds, bounds:{ ...next }, cancel:false, origin:options.origin ?? "api", userAction:options.userAction === true };
    if (!options.silent) this.events.emit("beforeGeometryChange", before);
    if (before.cancel || this.destroyed) return false;
    Object.assign(this, { x:next.x, y:next.y, windowWidth:next.width, windowHeight:next.height });
    if (!this.collapsed) this._restoreHeight = this.windowHeight;
    this._applyBounds();
    this.events.emit("geometryInvalidate", { source:this });
    if (this.destroyed) return true;
    if (!options.silent) this.events.emit("geometryChange", { ...before, bounds:this.getBounds(), reason:options.reason ?? "setBounds" });
    return true;
  }

  moveTo(x, y, options = {}) {
    return this.setBounds({ x, y }, { ...options, reason:options.reason ?? "move" });
  }

  resizeTo(width, height, options = {}) {
    return this.setBounds({ width, height }, { ...options, reason:options.reason ?? "resize" });
  }

  collapse(options = {}) {
    if (this.collapsed) return false;
    this._restoreHeight = this.windowHeight;
    this.collapsed = true;
    this._applyCollapsed(this.element, options);
    if (!this.destroyed && !options.silent) this.events.emit("collapse", { source:this, origin:options.origin ?? "api", userAction:options.userAction === true });
    return true;
  }

  expand(options = {}) {
    if (!this.collapsed) return false;
    this.collapsed = false;
    this.windowHeight = Math.max(this.minHeight, this._restoreHeight);
    this._applyCollapsed(this.element, options);
    if (!this.destroyed && !options.silent) this.events.emit("expand", { source:this, origin:options.origin ?? "api", userAction:options.userAction === true });
    return true;
  }

  close(options = {}) {
    const event = { source:this, cancel:false, origin:options.origin ?? "api", userAction:options.userAction === true };
    this.events.emit("beforeClose", event);
    if (event.cancel) return false;
    this.events.emit("close", event);
    this.parent?.removeWindow?.(this, options);
    return true;
  }

  serializeState() {
    return { id:this.name ?? this.id, ...this.getBounds(), collapsed:this.collapsed };
  }

  destroy() {
    this._pointerTracking?.dispose();
    this._pointerTracking = null;
    super.destroy();
  }

  _createAction(action) {
    const button = createHeaderAction(action, { command:action });
    button.addEventListener("click", event => {
      event.stopPropagation();
      if (action === "close") this.close({ origin:"user", userAction:true });
      else this.collapsed ? this.expand({ origin:"user", userAction:true }) : this.collapse({ origin:"user", userAction:true });
    });
    return button;
  }

  _startMove(event) {
    if (!this.movable || event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    this.parent?.activateWindow?.(this);
    const start = { x:event.clientX, y:event.clientY, left:this.x, top:this.y };
    this._trackPointer(event, move => {
      const bounds = this.parent?.constrainWindowBounds?.(this, {
        ...this.getBounds(),
        x:start.left + move.clientX - start.x,
        y:start.top + move.clientY - start.y
      }) ?? {};
      this.setBounds(bounds, { origin:"user", userAction:true, reason:"move" });
    });
  }

  _startResize(event) {
    if (!this.resizable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.parent?.activateWindow?.(this);
    const start = { x:event.clientX, y:event.clientY, width:this.windowWidth, height:this.windowHeight };
    this._trackPointer(event, move => {
      const bounds = this.parent?.constrainWindowBounds?.(this, {
        ...this.getBounds(),
        width:start.width + move.clientX - start.x,
        height:start.height + move.clientY - start.y
      }) ?? {};
      this.setBounds(bounds, { origin:"user", userAction:true, reason:"resize" });
    });
  }

  _trackPointer(event, move) {
    this._pointerTracking?.dispose();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    this._pointerTracking = listenUntilPointerUp({
      target:window,
      move,
      up:() => { this._pointerTracking = null; }
    });
  }

  _applyBounds(element = this.element) {
    if (!element) return;
    element.style.left = `${this.x}px`;
    element.style.top = `${this.y}px`;
    element.style.width = `${this.windowWidth}px`;
    element.style.height = `${this.collapsed ? 26 : this.windowHeight}px`;
  }

  _applyCollapsed(element = this.element, options = {}) {
    if (!element) return;
    element.classList.toggle("dui-mdi-window--collapsed", this.collapsed);
    if (this._contentElement) this._contentElement.hidden = this.collapsed;
    this._applyBounds(element);
    this.events.emit("geometryInvalidate", { source:this });
    if (!this.destroyed && !options.silent) this.events.emit("geometryChange", { source:this, bounds:this.getBounds(), reason:this.collapsed ? "collapse" : "expand", origin:options.origin ?? "system", userAction:options.userAction === true });
  }
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
