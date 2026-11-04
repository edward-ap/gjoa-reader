import { CollectionPortProvider } from "./CollectionPortProvider.js";
import { itemGeometry, portPosition, treeAnchor } from "./itemGeometry.js";

export class GridPortProvider extends CollectionPortProvider {
  constructor(grid, options = {}) {
    if (!grid?._body) throw new Error("GridPortProvider requires a mounted Grid or TreeGrid.");
    super(grid, options);
    this.rowHeight = options.rowHeight ?? grid.rowHeight ?? 24;
    this._index = null;
    const invalidate = () => { this._index = null; this._emitChange(); };
    const projection = grid.treeView ?? grid.view;
    this._disposables.push(projection.events.on("invalidate", invalidate));
    const body = grid._body;
    const scroll = () => this._emitChange();
    body.addEventListener("scroll", scroll);
    this._disposables.push({ dispose:() => body.removeEventListener("scroll", scroll) });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(scroll) : null;
    resize?.observe(body);
    const mutation = typeof MutationObserver === "function" ? new MutationObserver(scroll) : null;
    mutation?.observe(body, { childList:true, subtree:true });
    this._disposables.push({ dispose:() => { resize?.disconnect(); mutation?.disconnect(); this._index = null; } });
  }

  getPortPosition(endpoint) {
    if (!this._available() || String(endpoint?.controlId) !== this.controlId) return null;
    const side = endpoint.side ?? "right";
    if (!this.sides.includes(side)) return null;
    const grid = this.control;
    const id = endpoint.itemId ?? endpoint.portId;
    if (!grid.data.get(id)) return null;
    const index = this._getIndex();
    const anchorId = grid.treeView ? treeAnchor(grid.treeView, id) : id;
    if (anchorId == null || !index.has(anchorId)) return null;
    if (this.window?.collapsed) return this._collapsedPosition(side);
    const row = this._rows().get(anchorId);
    if (row) return portPosition(itemGeometry(id, anchorId, row, grid._body, !Object.is(id, anchorId)), side, this.portElements);
    const viewport = grid._body.getBoundingClientRect();
    if (!grid._body.isConnected || viewport.height <= 0 || viewport.width <= 0) return null;
    const top = viewport.top + index.get(anchorId) * this.rowHeight - grid._body.scrollTop;
    return portPosition({ id, anchorId, status:Object.is(id, anchorId) ? "visible" : "collapsed", viewport,
      rect:{ left:viewport.left, right:viewport.right, top, bottom:top + this.rowHeight, width:viewport.width, height:this.rowHeight }
    }, side, this.portElements);
  }

  getPorts() {
    if (!this._available()) return [];
    if (this.window?.collapsed) return this._collapsedPorts();
    const ports = [];
    // Enumerate mounted rows, not all logical rows once per port.
    for (const [id, row] of this._rows()) {
      const geometry = itemGeometry(id, id, row, this.control._body);
      if (geometry.status !== "visible") continue;
      for (const side of this.sides) ports.push({ controlId:this.controlId, itemId:id, side, ...portPosition(geometry, side, this.portElements) });
    }
    return ports;
  }

  _getIndex() {
    if (!this._index) {
      const projection = this.control.treeView ?? this.control.view;
      this._index = new Map(projection.all().map((item, index) => [projection.idOf(item, index), index]));
    }
    return this._index;
  }

  _rows() {
    const grid = this.control;
    return new Map([...grid._body.querySelectorAll("[data-dui-grid-row-id]")].flatMap(row => {
      const id = grid._idsByRowKey.get(row.dataset.duiGridRowId);
      return id == null ? [] : [[id, row]];
    }));
  }
}
