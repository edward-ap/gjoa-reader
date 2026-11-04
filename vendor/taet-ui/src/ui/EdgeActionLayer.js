import { BaseControl } from "../core/BaseControl.js";
import { DisposableBag } from "../core/DisposableBag.js";

const EDGES = ["left", "right", "top", "bottom"];
const positionedHosts = new WeakMap();

function sizeValue(size = 0.25) {
  if (typeof size === "number" && Number.isFinite(size) && size >= 0 && size <= 1) return `${size * 100}%`;
  if (typeof size === "string" && /^(?:\d+(?:\.\d+)?|\.\d+)(px|%)$/.test(size.trim())) {
    const value = size.trim();
    if (Number.isFinite(parseFloat(value)) && (!value.endsWith("%") || parseFloat(value) <= 100)) return value;
  }
  throw new TypeError("Edge size must be a fraction from 0 to 1, nonnegative px, or 0–100%.");
}
function edgeName(edge) {
  if (!EDGES.includes(edge)) throw new TypeError(`Unknown edge: ${String(edge)}`);
  return edge;
}
function acquirePosition(host) {
  let entry = positionedHosts.get(host);
  if (entry) entry.count++;
  else if (getComputedStyle(host).position === "static") {
    entry = { count: 1, value: host.style.getPropertyValue("position"), priority: host.style.getPropertyPriority("position") };
    host.style.setProperty("position", "relative");
    positionedHosts.set(host, entry);
  }
  return () => {
    if (!entry || --entry.count) return;
    positionedHosts.delete(host);
    if (host.style.position === "relative" && host.style.getPropertyPriority("position") === "") {
      if (entry.value) host.style.setProperty("position", entry.value, entry.priority);
      else host.style.removeProperty("position");
    }
  };
}

/** Auxiliary pointer-only edge zones; no application or content semantics. */
export class EdgeActionLayer extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasParent = typeof containerOrOptions === "string" || containerOrOptions instanceof BaseControl ||
      typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement;
    const options = hasParent ? maybeOptions ?? {} : containerOrOptions ?? {};
    super({ ...options, width: null, height: null, tabIndex: null });
    this.commands = options.commands ?? null;
    this.observe = options.observe === true;
    this.dragThreshold = options.dragThreshold ?? 5;
    if (!Number.isFinite(this.dragThreshold) || this.dragThreshold < 0) throw new TypeError("dragThreshold must be a nonnegative finite number.");
    this._edges = new Map();
    this._host = null;
    this._gesture = null;
    this._revision = 0;
    const indicators = new Set();
    for (const edge of EDGES) {
      const config = options[edge];
      if (config == null) continue;
      if (typeof config !== "object" || Array.isArray(config)) throw new TypeError(`${edge} must be an edge configuration object.`);
      if (config.action != null && typeof config.action !== "function") throw new TypeError("Edge action must be a function.");
      if (config.action != null && config.command != null) throw new Error("Edge cannot use both action and command.");
      if (config.enabled != null && typeof config.enabled !== "boolean") throw new TypeError("Edge enabled must be boolean.");
      if (config.command != null) {
        if (typeof config.command !== "string" || !config.command || !this.commands) throw new TypeError("Edge command requires an id and CommandRegistry.");
        this.commands.state(config.command); // Match existing command-bound controls: fail early for unknown ids.
      }
      const indicator = config.indicator;
      if (indicator != null && typeof indicator !== "string") {
        const control = indicator instanceof BaseControl;
        const node = typeof HTMLElement !== "undefined" && indicator instanceof HTMLElement;
        if ((!control && !node) || indicators.has(indicator) ||
            control && (indicator.mounted || indicator.parent || indicator.destroyed) || node && indicator.parentNode) {
          throw new TypeError("Indicator must be text, a detached HTMLElement, or a unique unmounted Tæt UI control.");
        }
        indicators.add(indicator);
      }
      this._edges.set(edge, { ...config, size: sizeValue(config.size), enabled: config.enabled !== false, zone: null, indicatorHost: null });
    }
    this._bindOptionEvent("activate", options.onActivate);
    if (this.commands) for (const name of ["stateChange", "register", "unregister"]) {
      this.disposables.add(this.commands.events.on(name, () => { if (!this.destroyed && !this._disposingEdges) this.refresh(); }));
    }
    const parent = hasParent ? containerOrOptions : options.parent;
    if (parent != null) {
      try { this.mount(parent); } catch (error) { this.destroy(); throw error; }
    }
  }

  mount(parent) {
    this._assertMutable("mount");
    const owner = parent instanceof BaseControl ? parent : null;
    if (owner && typeof owner.addControl !== "function") throw new TypeError("Control parent must be a mounted Panel/Layout container; otherwise pass an HTMLElement and own the layer explicitly.");
    const host = owner ? owner.getContentElement() : this._resolveContainer(parent);
    if (!host || owner?.destroyed) throw new Error("EdgeActionLayer parent must be mounted.");
    if (this.mounted) { super.mount(host); return this; }
    if (getComputedStyle(host).display === "contents") throw new Error("EdgeActionLayer requires a parent with a layout box.");
    this._host = host;
    this.disposables.add(acquirePosition(host));
    super.mount(host);
    if (this.destroyed) return this;
    owner?.addControl(this);
    if (this.destroyed) return this;
    // Percent sizes follow the parent's client box. Only scrolling the host itself
    // needs compensation; child scroll/zoom is deliberately not observed.
    const followScroll = () => {
      this._cancelPointer();
      if (this.element) this.element.style.transform = `translate(${host.scrollLeft}px, ${host.scrollTop}px)`;
    };
    this.disposables.addEventListener(host, "scroll", followScroll, { passive: true });
    followScroll();
    if (this.observe) {
      this.disposables.addEventListener(host, "pointerdown", event => {
        const edge = this._observedEdge(event);
        if (edge) this._pointerDown(edge, event);
      }, true);
      this.disposables.addEventListener(host, "scroll", () => this._cancelPointer(), true);
      this.disposables.addEventListener(host, "wheel", () => this._cancelPointer(), { capture: true, passive: true });
    }
    this.refresh();
    return this;
  }

  createElement() {
    const root = super.createElement();
    root.classList.add("dui-edge-action-layer");
    root.setAttribute("aria-hidden", "true");
    for (const [edge, config] of this._edges) {
      const zone = document.createElement("div");
      zone.className = `dui-edge-action-layer__zone dui-edge-action-layer__zone--${edge}`;
      zone.dataset.edge = edge;
      config.zone = zone;
      if (this.observe) zone.style.pointerEvents = "none";
      root.append(zone);
      if (config.indicator != null) {
        const indicator = document.createElement("span");
        indicator.className = "dui-edge-action-layer__indicator";
        indicator.inert = true;
        config.indicatorHost = indicator;
        zone.append(indicator);
        if (typeof config.indicator === "string") indicator.textContent = config.indicator;
        else if (config.indicator instanceof BaseControl) config.indicator.mount(indicator);
        else indicator.append(config.indicator);
        if (this.destroyed) return root;
      }
      this.disposables.addEventListener(zone, "pointerdown", event => this._pointerDown(edge, event));
      for (const [native, type] of [["pointerenter", "enter"], ["pointerleave", "leave"]]) {
        this.disposables.addEventListener(zone, native, event => {
          if (this.isEdgeEnabled(edge)) this.events.emit(type, this._event(edge, event));
        });
      }
      this.disposables.addEventListener(zone, "click", event => { event.preventDefault(); event.stopPropagation(); });
    }
    return root;
  }

  setEdgeEnabled(edge, enabled) {
    this._assertMutable("setEdgeEnabled");
    const config = this._requireEdge(edge);
    if (typeof enabled !== "boolean") throw new TypeError("Edge enabled must be boolean.");
    config.enabled = enabled;
    this.refresh();
    return this;
  }
  setEdgeSize(edge, size) {
    this._assertMutable("setEdgeSize");
    this._requireEdge(edge).size = sizeValue(size);
    this.refresh();
    return this;
  }
  isEdgeEnabled(edge) {
    this._assertMutable("isEdgeEnabled");
    edgeName(edge);
    const config = this._edges.get(edge);
    if (!config || !config.enabled || this.disabled || !this.visible) return false;
    if (config.command) {
      if (this.commands.destroyed || !this.commands.get(config.command)) return false;
      const state = this.commands.state(config.command);
      return !this.destroyed && state.enabled && state.visible;
    }
    return true;
  }
  refresh() {
    this._assertMutable("refresh");
    this._revision++;
    this._cancelPointer();
    const revision = this._revision;
    for (const edge of EDGES) {
      const active = this.isEdgeEnabled(edge);
      if (this.destroyed || revision !== this._revision) return this;
      const config = this._edges.get(edge);
      this.element?.style.setProperty(`--dui-edge-${edge}-size`, active ? config.size : "0px");
      config?.zone?.classList.toggle("dui-edge-action-layer__zone--inactive", !active);
    }
    return this;
  }
  _requireEdge(edge) {
    const config = this._edges.get(edgeName(edge));
    if (!config) throw new Error(`Edge is not configured: ${edge}`);
    return config;
  }
  _applyDisabledState() { super._applyDisabledState(); if (this._edges) this.refresh(); }
  _applyVisibilityState() {
    super._applyVisibilityState();
    this.element?.setAttribute("aria-hidden", "true");
    if (this._edges) this.refresh();
  }
  _event(edge, nativeEvent) { return { source: this, edge, origin: "user", userAction: true, nativeEvent }; }
  _observedEdge(event) {
    const target = this._host.ownerDocument.elementFromPoint(event.clientX, event.clientY);
    if (!target || !this._host.contains(target) || target.closest('button,input,select,textarea,a,[contenteditable=true],[role=button],[role=slider],[role=scrollbar]')) return null;
    // Exclude native scrollbar gutters, including independently scrolling children.
    for (let node = target; node && node !== this._host.parentElement; node = node.parentElement) {
      const box = node.getBoundingClientRect();
      if (node.offsetWidth > node.clientWidth + 2 && event.clientX >= box.left + node.clientLeft + node.clientWidth ||
          node.offsetHeight > node.clientHeight + 2 && event.clientY >= box.top + node.clientTop + node.clientHeight) return null;
    }
    for (const [edge, config] of this._edges) {
      const box = config.zone.getBoundingClientRect();
      if (this.isEdgeEnabled(edge) && event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom) return edge;
    }
    return null;
  }
  _pointerDown(edge, event) {
    if (event.button !== 0 || event.isPrimary === false || !this.isEdgeEnabled(edge)) return;
    if (this._gesture) { this._cancelPointer(); return; }
    const zone = this._edges.get(edge).zone;
    const bag = new DisposableBag();
    const gesture = { edge, zone, id: event.pointerId, x: event.clientX, y: event.clientY, bag, revision: this._revision };
    this._gesture = gesture;
    const moved = point => Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y) > this.dragThreshold;
    bag.addEventListener(zone.ownerDocument, "pointermove", move => {
      if (move.pointerId !== gesture.id) return;
      if ([...(move.getCoalescedEvents?.() ?? []), move].some(moved)) this._cancelPointer();
    }, true);
    bag.addEventListener(zone.ownerDocument, "pointerup", up => {
      if (up.pointerId !== gesture.id) return;
      this._cancelPointer();
      if (up.button !== 0 || moved(up) || gesture.revision !== this._revision || !this.isEdgeEnabled(edge)) return;
      const target = zone.ownerDocument.elementFromPoint(up.clientX, up.clientY);
      if (this.observe ? this._observedEdge(up) !== edge : target !== zone && !zone.contains(target)) return;
      this._activate(edge, up);
    }, true);
    bag.addEventListener(zone.ownerDocument, "pointercancel", cancel => { if (cancel.pointerId === gesture.id) this._cancelPointer(); }, true);
    bag.addEventListener(zone.ownerDocument, "pointerdown", down => { if (down.pointerId !== gesture.id) this._cancelPointer(); }, true);
    bag.addEventListener(zone, "lostpointercapture", () => this._cancelPointer());
    bag.addEventListener(zone.ownerDocument.defaultView, "blur", () => this._cancelPointer());
  }
  _cancelPointer() {
    const gesture = this._gesture;
    this._gesture = null;
    gesture?.bag.dispose();
  }
  _activate(edge, nativeEvent) {
    const revision = this._revision;
    const config = this._edges.get(edge);
    const event = this._event(edge, nativeEvent);
    this.events.emit("activate", event);
    if (this.destroyed || revision !== this._revision || !this.isEdgeEnabled(edge)) return;
    if (config.command) {
      void this.commands.execute(config.command, undefined, { origin: "user", userAction: true });
    } else if (config.action) {
      const report = error => { if (!this.destroyed && revision === this._revision) this.events.emit("actionError", { ...event, error }); };
      try { Promise.resolve(config.action(event)).catch(report); } catch (error) { report(error); }
    }
  }
  destroy() {
    if (this.destroyed || this._disposingEdges) return;
    this._disposingEdges = true;
    this._revision++;
    this._cancelPointer();
    for (const config of this._edges.values()) {
      if (config.indicator instanceof BaseControl) config.indicator.destroy();
      else if (typeof HTMLElement !== "undefined" && config.indicator instanceof HTMLElement) config.indicator.remove();
      config.zone?.remove();
    }
    this._edges.clear();
    this._host = null;
    this.commands = null;
    super.destroy();
    this.options = {};
  }
}
