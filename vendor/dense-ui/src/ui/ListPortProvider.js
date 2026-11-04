import { CollectionPortProvider } from "./CollectionPortProvider.js";
import { portPosition } from "./itemGeometry.js";

export class ListPortProvider extends CollectionPortProvider {
  constructor(list, options = {}) {
    if (typeof list?.getItemGeometry !== "function" || typeof list?.getVisibleItemGeometries !== "function") {
      throw new TypeError("ListPortProvider requires a List-compatible geometry control.");
    }
    super(list, options);
    this._disposables.push(list.events.on("itemGeometryChange", () => this._emitChange()));
  }

  getPortPosition(endpoint) {
    if (!this._available() || String(endpoint?.controlId) !== this.controlId) return null;
    const side = endpoint.side ?? "right";
    if (!this.sides.includes(side)) return null;
    const geometry = this.control.getItemGeometry(endpoint.itemId ?? endpoint.portId);
    if (geometry.status === "missing" || geometry.status === "filtered") return null;
    return this.window?.collapsed ? this._collapsedPosition(side) : portPosition(geometry, side, this.portElements);
  }

  getPorts() {
    if (!this._available()) return [];
    if (this.window?.collapsed) return this._collapsedPorts();
    return this.control.getVisibleItemGeometries().flatMap(geometry => this.sides.map(side => ({
      controlId:this.controlId, itemId:geometry.id, side, ...portPosition(geometry, side, this.portElements)
    })));
  }
}
