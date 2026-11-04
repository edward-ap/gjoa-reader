export class StaticPortProvider {
  constructor(options = {}) {
    if (!options.controlId) throw new TypeError("StaticPortProvider requires controlId.");
    this.controlId = String(options.controlId);
    this.window = options.window ?? null;
    this.portElements = options.portElements ?? null;
    this.portSpacing = positive(options.portSpacing, 24);
    this._listeners = new Set();
    this.destroyed = false;
    this._geometrySubscriptions = this.window ? ["geometryInvalidate", "show", "hide"].map(event => this.window.events.on(event, () => this._emitChange())) : [];
    this._ports = [];
    this.setPorts(options.ports ?? []);
  }

  all() {
    return this._ports.map(port => ({ ...port }));
  }

  setPorts(ports) {
    if (!Array.isArray(ports)) throw new TypeError("StaticPortProvider ports must be an array.");
    this._ports = ports.map(normalizePort);
    assertUniquePorts(this._ports);
    this._emitChange();
    return this;
  }

  addPort(port) {
    const normalized = normalizePort(port);
    if (this._ports.some(current => current.id === normalized.id && current.side === normalized.side)) {
      throw new Error(`Duplicate static port: ${normalized.side}.${normalized.id}.`);
    }
    this._ports.push(normalized);
    this._emitChange();
    return { ...normalized };
  }

  removePort(id, side = null) {
    const index = this._ports.findIndex(port => port.id === String(id) && (side == null || port.side === side));
    if (index < 0) return null;
    const [removed] = this._ports.splice(index, 1);
    this._emitChange();
    return { ...removed };
  }

  getPorts() {
    if (this.destroyed || this.window?.destroyed || this.window?.visible === false) return [];
    if (this.window?.collapsed) {
      return ["left", "right"].filter(side => this._ports.some(port => port.side === side)).map(side => ({
        controlId:this.controlId,
        itemId:`__collapsed-${side}`,
        portId:`__collapsed-${side}`,
        side,
        aggregate:true,
        interactive:false,
        ...this._collapsedPosition(side)
      }));
    }
    return this._ports.map(port => ({
      controlId:this.controlId,
      itemId:port.id,
      portId:port.id,
      side:port.side,
      label:port.label,
      ...this._position(port)
    })).filter(port => port.status === "visible");
  }

  getPortPosition(endpoint) {
    if (this.destroyed || this.window?.destroyed || this.window?.visible === false) return null;
    if (!endpoint || String(endpoint.controlId) !== this.controlId) return null;
    if (this.window?.collapsed) return this._collapsedPosition(endpoint.side);
    const id = String(endpoint.itemId ?? endpoint.portId ?? "");
    const port = this._ports.find(current => current.id === id && current.side === endpoint.side);
    return port ? this._position(port) : null;
  }

  onChange(handler) {
    this._listeners.add(handler);
    return { dispose:() => this._listeners.delete(handler), off:() => this._listeners.delete(handler) };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const subscription of this._geometrySubscriptions) subscription.dispose();
    this._geometrySubscriptions = [];
    this._emitChange();
    this._listeners.clear();
    this._ports = [];
    this.window = null;
    this.portElements = null;
  }

  _position(port) {
    const rail = this.portElements?.[port.side];
    if (!rail) return { x:0, y:0, status:"missing" };
    const rect = rail.getBoundingClientRect();
    const peers = this._ports.filter(current => current.side === port.side);
    const index = peers.indexOf(port);
    const spacing = Math.min(this.portSpacing, peers.length > 1 ? rect.height / (peers.length - 1) : this.portSpacing);
    return {
      x:rect.left + rect.width / 2,
      y:rect.top + rect.height / 2 + (index - (peers.length - 1) / 2) * spacing,
      status:"visible"
    };
  }

  _collapsedPosition(side) {
    const rect = this.window?.element?.getBoundingClientRect?.();
    if (!rect) return { x:0, y:0, status:"missing" };
    return {
      x:side === "left" ? rect.left : rect.right,
      y:rect.top + rect.height / 2,
      status:"collapsed"
    };
  }

  _emitChange() {
    for (const handler of [...this._listeners]) handler({ source:this });
  }
}

function normalizePort(port) {
  if (!port || typeof port !== "object") throw new TypeError("Static port must be an object.");
  const id = String(port.id ?? "");
  if (!id) throw new TypeError("Static port id is required.");
  const side = port.side;
  if (side !== "left" && side !== "right") throw new TypeError("Static port side must be left or right.");
  return { ...port, id, side, label:port.label == null ? id : String(port.label) };
}

function assertUniquePorts(ports) {
  const keys = new Set();
  for (const port of ports) {
    const key = `${port.side}\u0000${port.id}`;
    if (keys.has(key)) throw new Error(`Duplicate static port: ${port.side}.${port.id}.`);
    keys.add(key);
  }
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
