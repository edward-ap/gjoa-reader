import { Panel } from "./Panel.js";
import { MdiWindow } from "./MdiWindow.js";

export class MdiWorkspace extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer = typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    super({ ...options, observeResize:true });
    this.constrainWindows = options.constrainWindows !== false;
    this.activeWindow = null;
    this._zIndex = 1;
    if (hasContainer) this.mount(containerOrOptions);
  }

  createElement() {
    const root = document.createElement("section");
    root.className = ["dui-control", "dui-mdi-workspace", this.className].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    root.addEventListener("pointerdown", event => {
      if (event.target === root) this.activateWindow(null, { origin:"user", userAction:true });
    });
    return root;
  }

  addWindow(windowOrOptions, options = {}) {
    const window = windowOrOptions instanceof MdiWindow ? windowOrOptions : new MdiWindow(windowOrOptions);
    this.attach(window, options);
    window.disposables.add(window.events.on("geometryChange", event => {
      this.events.emit("windowGeometryChange", { ...event, source:this, window, windowId:window.id });
    }));
    this.activateWindow(window, options);
    this.events.emit("windowAdd", { source:this, window, windowId:window.id, origin:options.origin ?? "api", userAction:options.userAction === true });
    return window;
  }

  removeWindow(idOrWindow, options = {}) {
    const window = typeof idOrWindow === "string" ? this.getItem(idOrWindow) : idOrWindow;
    if (!(window instanceof MdiWindow)) return null;
    if (this.activeWindow === window) this.activeWindow = null;
    const removed = this.remove(window, options);
    this.events.emit("windowRemove", { source:this, window, windowId:window.id, origin:options.origin ?? "api", userAction:options.userAction === true });
    const remaining = this.windows();
    if (remaining.length > 0) this.activateWindow(remaining.at(-1), options);
    return removed;
  }

  windows() {
    return this.items.filter(item => item instanceof MdiWindow);
  }

  activateWindow(idOrWindow, options = {}) {
    const window = typeof idOrWindow === "string" ? this.getItem(idOrWindow) : idOrWindow;
    if (window != null && !(window instanceof MdiWindow)) return false;
    if (this.activeWindow === window) return false;
    const oldWindow = this.activeWindow;
    this.activeWindow?.element?.classList.remove("dui-active");
    this.activeWindow = window ?? null;
    if (window?.element) {
      window.element.style.zIndex = String(++this._zIndex);
      window.element.classList.add("dui-active");
    }
    this.events.emit("activeWindowChange", {
      source:this,
      oldWindow,
      window:this.activeWindow,
      oldWindowId:oldWindow?.id ?? null,
      windowId:this.activeWindow?.id ?? null,
      origin:options.origin ?? "api",
      userAction:options.userAction === true
    });
    return true;
  }

  constrainWindowBounds(window, bounds) {
    if (!this.constrainWindows || !this.element) return bounds;
    const width = Math.min(bounds.width, Math.max(window.minWidth, this.element.clientWidth));
    const height = Math.min(bounds.height, Math.max(window.minHeight, this.element.clientHeight));
    return {
      ...bounds,
      width,
      height,
      x:Math.max(0, Math.min(bounds.x, Math.max(0, this.element.clientWidth - 32))),
      y:Math.max(0, Math.min(bounds.y, Math.max(0, this.element.clientHeight - 26)))
    };
  }

  arrange(mode = "cascade", options = {}) {
    const windows = this.windows().filter(window => window.visible);
    if (windows.length === 0) return this;
    if (mode !== "cascade") throw new TypeError("MdiWorkspace currently supports cascade arrangement only.");
    windows.forEach((window, index) => window.moveTo(24 + index * 28, 24 + index * 28, { ...options, reason:"arrange" }));
    return this;
  }

  serializeState() {
    return { activeWindowId:this.activeWindow?.name ?? this.activeWindow?.id ?? null, windows:this.windows().map(window => window.serializeState()) };
  }
}
