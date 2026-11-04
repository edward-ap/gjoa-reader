import { BaseControl } from "../core/BaseControl.js";
import { SelectionModel } from "../core/SelectionModel.js";
import { ConnectorModel } from "./ConnectorModel.js";
import { listenUntilPointerUp } from "../core/pointerTracking.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export class ConnectorLayer extends BaseControl {
  constructor(options = {}) {
    super({ ...options, observeResize:true });
    this.model = options.model instanceof ConnectorModel ? options.model : new ConnectorModel({ items:options.items });
    this._ownsModel = !(options.model instanceof ConnectorModel);
    this.selection = options.selection instanceof SelectionModel ? options.selection : new SelectionModel();
    this._ownsSelection = !(options.selection instanceof SelectionModel);
    this.workspace = options.workspace ?? null;
    this.providers = new Map();
    this._providerSubscriptions = new Map();
    this._renderQueued = false;
    this._connectionSequence = 0;
    this._pointerTracking = null;
    this._draft = null;
    this._portLayer = null;
    this.canConnect = options.canConnect ?? null;
    if (this.canConnect != null && typeof this.canConnect !== "function") throw new TypeError("canConnect must be a function.");
    this._portEndpoints = new WeakMap();
    this.disposables.add(this.model.events.on("invalidate", () => {
      if (this.destroyed) return;
      this.selection.set(this.selection.get().flatMap(item => this.model.get(item.id) ?? []), { silent:true });
      this.requestRender();
    }));
    this.disposables.add(this.selection.events.on("change", () => this.requestRender()));
    if (options.workspace?.events) {
      this.disposables.add(options.workspace.events.on("windowGeometryChange", () => this.requestRender()));
      this.disposables.add(options.workspace.events.on("windowAdd", () => this.requestRender()));
      this.disposables.add(options.workspace.events.on("windowRemove", () => this.requestRender()));
      this.disposables.add(options.workspace.events.on("activeWindowChange", () => this.requestRender()));
    }
    this.events.on("resize", () => this.requestRender());
  }

  createElement() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("dui-control", "dui-connector-layer");
    svg.dataset.duiControlId = this.id;
    svg.setAttribute("aria-label", this.options.ariaLabel ?? "Connections");
    svg.addEventListener("click", event => {
      const path = event.target.closest?.("[data-dui-connector-id]");
      if (!path) return;
      const connector = this.model.get(path.dataset.duiConnectorId);
      if (connector) this.selection.set([connector], { origin:"user", userAction:true });
      path.focus();
    });
    svg.addEventListener("keydown", event => {
      const id = event.target.dataset?.duiConnectorId;
      if (!id) return;
      const options = { origin:"user", userAction:true };
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.removeConnection(id, options);
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        this.startReconnect(id, event.shiftKey ? "source" : "target");
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selection.set([this.model.get(id)], options);
      }
    });
    return svg;
  }

  mount(container) {
    super.mount(container);
    const ports = document.createElementNS(SVG_NS, "svg");
    ports.classList.add("dui-connector-port-layer");
    ports.setAttribute("aria-label", "Connection ports");
    this.element.parentElement?.appendChild(ports);
    this._portLayer = ports;
    this.disposables.addEventListener(window, "keydown", event => {
      if (event.key === "Escape" && this._draft) { event.preventDefault(); this.cancelConnection(); }
    });
    this.disposables.addEventListener(window, "pointercancel", () => this.cancelConnection());
    this.disposables.addEventListener(window, "blur", () => this.cancelConnection());
    this.requestRender();
    return this;
  }

  registerProvider(provider) {
    if (!provider?.controlId || typeof provider.getPortPosition !== "function") throw new TypeError("Connector provider requires controlId and getPortPosition().");
    this.unregisterProvider(provider.controlId);
    this.providers.set(String(provider.controlId), provider);
    if (typeof provider.onChange === "function") this._providerSubscriptions.set(String(provider.controlId), provider.onChange(() => {
      if (provider.destroyed && this.providers.get(String(provider.controlId)) === provider) this.unregisterProvider(provider.controlId);
      else this.requestRender();
    }));
    this.requestRender();
    return provider;
  }

  unregisterProvider(controlId) {
    const key = String(controlId);
    this._providerSubscriptions.get(key)?.dispose?.();
    this._providerSubscriptions.delete(key);
    const removed = this.providers.get(key) ?? null;
    removed?.window?._layers?.delete(this);
    this.providers.delete(key);
    if ([this._draft?.source, this._draft?.originalEndpoint].some(endpoint => String(endpoint?.controlId) === key)) this.cancelConnection();
    this.requestRender();
    return removed;
  }

  requestRender() {
    if (this._renderQueued || !this.element) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      if (!this.destroyed) this.render();
    });
  }

  render() {
    if (!this.element) return this;
    const focused = document.activeElement;
    const focusedPort = this._portEndpoints.get(focused);
    const focusedConnection = this.element.contains(focused) ? focused?.dataset?.duiConnectorId : null;
    this.element.querySelectorAll(".dui-connector-layer__connection").forEach(element => element.remove());
    this._portLayer?.querySelectorAll(".dui-connector-layer__port, .dui-connector-layer__draft").forEach(element => element.remove());
    const layerRect = this.element.getBoundingClientRect();
    const selectedId = this.selection.get()[0]?.id ?? null;
    const connected = new Set();
    for (const connector of this.model.all()) {
      connected.add(endpointKey(connector.source));
      connected.add(endpointKey(connector.target));
      const source = this._resolve(connector.source);
      const target = this._resolve(connector.target);
      if (source?.proxyItemId != null) connected.add(endpointKey({ ...connector.source, itemId:source.proxyItemId }));
      if (target?.proxyItemId != null) connected.add(endpointKey({ ...connector.target, itemId:target.proxyItemId }));
      if (!source || !target) continue;
      const start = { x:source.x - layerRect.left, y:source.y - layerRect.top };
      const end = { x:target.x - layerRect.left, y:target.y - layerRect.top };
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", connectorPath(start, end, connector));
      path.setAttribute("class", `dui-connector-layer__connection${selectedId === connector.id ? " dui-selected" : ""}`);
      path.dataset.duiConnectorId = connector.id;
      path.dataset.duiSourceStatus = source.status;
      path.dataset.duiTargetStatus = target.status;
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", connector.label ?? `Connection ${connector.id}; Delete removes, R reconnects target, Shift+R reconnects source`);
      this.element.appendChild(path);
      if (focusedConnection === connector.id) path.focus({ preventScroll:true });
    }
    for (const provider of this.providers.values()) {
      for (const port of provider.getPorts?.() ?? []) {
        if (this._isPortOccluded(port)) continue;
        const isConnected = port.aggregate
          ? this.model.all().some(connector => [connector.source, connector.target].some(endpoint =>
            String(endpoint.controlId) === String(port.controlId) && endpoint.side === port.side
          ))
          : connected.has(endpointKey(port));
        const circle = this._createAvailablePort({ x:port.x - layerRect.left, y:port.y - layerRect.top }, port, isConnected);
        this._portLayer?.appendChild(circle);
        if (focusedPort && endpointKey(focusedPort) === endpointKey(port)) circle.focus({ preventScroll:true });
      }
    }
    this._renderDraft();
    return this;
  }

  connect(source, target, options = {}) {
    const candidate = { id:`connection-${Date.now()}-${++this._connectionSequence}`, source:logicalEndpoint(source, "right"), target:logicalEndpoint(target, "left") };
    if (!this._approveConnection(candidate, null, options)) return null;
    const connector = this.model.add(candidate, options);
    if (!this.destroyed && !options.silent) this.events.emit("connectionCreate", { source:this, connector, origin:options.origin ?? "api", userAction:options.userAction === true });
    return connector;
  }

  reconnect(id, end, endpoint, options = {}) {
    if (!["source", "target"].includes(end)) throw new TypeError("Connection end must be source or target.");
    if (this.destroyed || this.model.destroyed) return false;
    const oldConnector = this.model.get(id);
    if (!oldConnector) return false;
    const candidate = { ...oldConnector, [end]:logicalEndpoint(endpoint, end === "source" ? "right" : "left") };
    if (!this._approveConnection(candidate, oldConnector, options) || this.model.get(id) !== oldConnector) return false;
    const changed = this.model.update(id, candidate, options);
    if (changed && !this.destroyed && !options.silent) this.events.emit("connectionChange", { source:this, connector:this.model.get(id), oldConnector, origin:options.origin ?? "api", userAction:options.userAction === true });
    return changed;
  }

  removeConnection(id, options = {}) {
    if (this.destroyed || this.model.destroyed) return false;
    const connector = this.model.get(id);
    if (!connector) return false;
    const event = { source:this, connector, cancel:false, origin:options.origin ?? "api", userAction:options.userAction === true };
    if (!options.silent) this.events.emit("beforeConnectionRemove", event);
    if (event.cancel || this.destroyed || this.model.destroyed || this.model.get(id) !== connector) return false;
    if (this._draft?.connectorId === id) this.cancelConnection();
    const changed = this.model.remove(id, options);
    if (changed && !this.destroyed && !options.silent) this.events.emit("connectionRemove", event);
    return changed;
  }

  startReconnect(id, end = "target") {
    if (!["source", "target"].includes(end)) throw new TypeError("Connection end must be source or target.");
    if (this.destroyed || this.model.destroyed) return false;
    const connector = this.model.get(id);
    if (!connector) return false;
    this.cancelConnection();
    const source = connector[end === "source" ? "target" : "source"];
    const position = this._resolve(source);
    if (!position) return false;
    this._draft = { source, originalEndpoint:connector[end], connectorId:id, end, x:position.x, y:position.y };
    this._renderDraft();
    return true;
  }

  cancelConnection() {
    this._pointerTracking?.dispose();
    this._pointerTracking = null;
    this._draft = null;
    this._portLayer?.querySelector(".dui-connector-layer__draft")?.remove();
  }

  _approveConnection(connector, oldConnector, options) {
    if (this._preparingConnection) return false;
    const live = () => !this.destroyed && !this.model.destroyed && this._resolve(connector.source) && this._resolve(connector.target);
    if (!live() || endpointKey(connector.source) === endpointKey(connector.target)) return false;
    this._preparingConnection = true;
    try {
      if (this.canConnect?.({ source:this, connector, oldConnector }) === false || !live()) return false;
      const event = { source:this, connector, oldConnector, cancel:false, origin:options.origin ?? "api", userAction:options.userAction === true };
      if (!options.silent) this.events.emit("beforeConnectionChange", event);
      return !event.cancel && !!live() && endpointKey(connector.source) !== endpointKey(connector.target);
    } finally { this._preparingConnection = false; }
  }

  _finishConnection(target) {
    const draft = this._draft;
    this.cancelConnection();
    if (!draft || !target) return;
    const options = { origin:"user", userAction:true };
    if (draft.connectorId) this.reconnect(draft.connectorId, draft.end, target, options);
    else this.connect(draft.source, target, options);
  }

  destroy() {
    this.cancelConnection();
    for (const provider of this.providers.values()) provider.window?._layers?.delete(this);
    for (const subscription of this._providerSubscriptions.values()) subscription.dispose?.();
    this._providerSubscriptions.clear();
    this.providers.clear();
    this._pointerTracking?.dispose();
    this._portLayer?.remove();
    this._portLayer = null;
    if (this._ownsSelection) this.selection.destroy();
    if (this._ownsModel) this.model.destroy();
    super.destroy();
  }

  _resolve(endpoint) {
    const position = this.providers.get(String(endpoint.controlId))?.getPortPosition(endpoint);
    return position && position.status !== "missing" && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : null;
  }

  _isPortOccluded(port) {
    const owner = this.providers.get(String(port.controlId))?.window;
    if (!owner?.element || !this.workspace?.windows) return false;
    const ownerZ = stackingOrder(owner.element);
    return this.workspace.windows().some(window => {
      if (window === owner || !window.visible || !window.element) return false;
      if (stackingOrder(window.element) <= ownerZ) return false;
      return pointInsideRect(port.x, port.y, window.element.getBoundingClientRect(), 5);
    });
  }

  _createAvailablePort(point, endpoint, connected) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", "4");
    circle.setAttribute("class", `dui-connector-layer__port${connected ? " dui-connected" : ""}`);
    if (endpoint.aggregate) circle.classList.add("dui-connector-layer__port--aggregate");
    circle.dataset.duiPortControlId = endpoint.controlId;
    circle.dataset.duiPortItemId = String(endpoint.itemId ?? "");
    circle.dataset.duiPortSide = endpoint.side;
    if (endpoint.interactive !== false) {
      this._portEndpoints.set(circle, logicalEndpoint(endpoint));
      circle.setAttribute("tabindex", "0");
      circle.setAttribute("role", "button");
      circle.setAttribute("aria-label", `${endpoint.controlId}: ${endpoint.label ?? endpoint.itemId ?? endpoint.portId}, ${endpoint.side} port`);
      circle.addEventListener("pointerdown", event => this._startConnection(event, endpoint));
      circle.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (this._draft) this._finishConnection(logicalEndpoint(endpoint));
        else { this._draft = { source:logicalEndpoint(endpoint), x:endpoint.x, y:endpoint.y }; this._renderDraft(); }
      });
    }
    return circle;
  }

  _startConnection(event, source) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (this._draft && !this._pointerTracking) { this._finishConnection(logicalEndpoint(source)); return; }
    const providerWindow = this.providers.get(String(source.controlId))?.window;
    providerWindow?.parent?.activateWindow?.(providerWindow, { origin:"user", userAction:true });
    if (this.destroyed) return;
    this._draft = { source:logicalEndpoint(source), x:event.clientX, y:event.clientY };
    this._pointerTracking?.dispose();
    this._pointerTracking = listenUntilPointerUp({
      target:window,
      move:move => {
        if (!this._draft) return;
        this._draft.x = move.clientX;
        this._draft.y = move.clientY;
        this._renderDraft();
      },
      up:up => {
        this._pointerTracking = null;
        const targetElement = document.elementFromPoint(up.clientX, up.clientY)?.closest?.("[data-dui-port-control-id]");
        const target = targetElement ? this._portEndpoints.get(targetElement) : null;
        this._finishConnection(target);
        this.requestRender();
      }
    });
    this._renderDraft();
  }

  _renderDraft() {
    if (!this.element || !this._portLayer || !this._draft) return;
    this._portLayer.querySelector(".dui-connector-layer__draft")?.remove();
    const layerRect = this.element.getBoundingClientRect();
    const source = this._resolve(this._draft.source);
    if (!source) return;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "dui-connector-layer__draft");
    path.setAttribute("d", connectorPath(
      { x:source.x - layerRect.left, y:source.y - layerRect.top },
      { x:this._draft.x - layerRect.left, y:this._draft.y - layerRect.top },
      {}
    ));
    this._portLayer.appendChild(path);
  }
}

function endpointKey(endpoint) {
  const id = endpoint.itemId ?? endpoint.portId ?? "";
  return JSON.stringify([endpoint.controlId, typeof id, id, endpoint.side]);
}

function logicalEndpoint(endpoint, fallback = "right") {
  return { controlId:endpoint.controlId, ...(endpoint.itemId != null ? { itemId:endpoint.itemId } : {}),
    ...(endpoint.portId != null ? { portId:endpoint.portId } : {}), side:endpoint.side ?? fallback };
}

function pointInsideRect(x, y, rect, margin = 0) {
  return x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin;
}

function stackingOrder(element) {
  const value = Number(getComputedStyle(element).zIndex);
  return Number.isFinite(value) ? value : 0;
}

function connectorPath(start, end, connector) {
  if (connector.routing === "straight") return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  const distance = Math.max(48, Math.abs(end.x - start.x) * 0.45);
  const direction = end.x >= start.x ? 1 : -1;
  return `M ${start.x} ${start.y} C ${start.x + distance * direction} ${start.y}, ${end.x - distance * direction} ${end.y}, ${end.x} ${end.y}`;
}
