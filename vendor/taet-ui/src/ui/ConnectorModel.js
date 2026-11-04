import { DataStore } from "../core/DataStore.js";

export class ConnectorModel {
  constructor(options = {}) {
    this.data = new DataStore();
    this.events = this.data.events;
    this.destroyed = false;
    if (options.items) this.parse(options.items, { silent:true, origin:"import" });
  }

  parse(items, options = {}) {
    this._assertUsable("parse");
    this.data.parse(items.map(normalizeConnector), options);
    return this;
  }

  add(connector, options = {}) {
    this._assertUsable("add");
    const normalized = normalizeConnector(connector);
    this.data.add(normalized, options);
    return normalized;
  }

  update(id, patch, options = {}) {
    this._assertUsable("update");
    const current = this.data.get(id);
    if (!current) return false;
    return this.data.update(id, normalizeConnector({ ...current, ...patch }), options);
  }

  remove(id, options = {}) {
    this._assertUsable("remove");
    return this.data.remove(id, options);
  }

  all() {
    this._assertUsable("all");
    return this.data.all();
  }

  get(id) {
    this._assertUsable("get");
    return this.data.get(id) ?? null;
  }

  destroy() {
    if (this.destroyed) return;
    this.data.destroy();
    this.destroyed = true;
  }

  _assertUsable(operation) {
    if (this.destroyed) throw new Error(`Cannot call ${operation}() on destroyed ConnectorModel.`);
  }
}

function normalizeConnector(connector) {
  if (!connector || typeof connector !== "object" || Array.isArray(connector)) throw new TypeError("Connector must be an object.");
  if (typeof connector.id !== "string" || !connector.id) throw new TypeError("Connector id must be a non-empty string.");
  return {
    type:"default",
    directed:false,
    ...connector,
    source:normalizeEndpoint(connector.source, "source"),
    target:normalizeEndpoint(connector.target, "target")
  };
}

function normalizeEndpoint(endpoint, name) {
  if (!endpoint || typeof endpoint !== "object") throw new TypeError(`Connector ${name} endpoint must be an object.`);
  if (typeof endpoint.controlId !== "string" || !endpoint.controlId) throw new TypeError(`Connector ${name}.controlId is required.`);
  const side = endpoint.side ?? (name === "source" ? "right" : "left");
  if (!["left", "right", "top", "bottom"].includes(side)) throw new TypeError(`Unsupported connector endpoint side: ${side}.`);
  return { ...endpoint, side };
}
