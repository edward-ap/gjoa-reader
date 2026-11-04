// Internal lifetime and coordinate plumbing; concrete providers stay public.
export class CollectionPortProvider {
  constructor(control, options = {}) {
    if (!control?.element) throw new Error("Port provider requires a mounted control.");
    this.control = control;
    this.controlId = String(options.controlId ?? control.name ?? control.id);
    this.sides = [...new Set(options.sides ?? ["left", "right"])];
    if (this.sides.some(side => !["left", "right", "top", "bottom"].includes(side))) throw new TypeError("Unsupported port side.");
    this.portElements = options.portElements ?? null;
    this.window = options.window ?? null;
    this.destroyed = false;
    this._listeners = new Set();
    this._disposables = [];
    if (this.window) for (const event of ["geometryInvalidate", "show", "hide"]) {
      this._disposables.push(this.window.events.on(event, () => this._emitChange()));
    }
    for (const event of ["show", "hide"]) this._disposables.push(control.events.on(event, () => this._emitChange()));
    control.disposables.add(() => this.destroy());
  }

  onChange(handler) {
    if (!this.destroyed) this._listeners.add(handler);
    return { dispose:() => this._listeners.delete(handler), off:() => this._listeners.delete(handler) };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const disposable of this._disposables) disposable.dispose();
    this._disposables = [];
    this._emitChange();
    this._listeners.clear();
    this.control = null;
    this.window = null;
    this.portElements = null;
  }

  _emitChange() {
    for (const handler of [...this._listeners]) handler({ source:this, destroyed:this.destroyed });
  }

  _available() {
    return !this.destroyed && !this.control?.destroyed && this.control?.visible !== false &&
      this.window?.visible !== false && !this.window?.destroyed;
  }

  _collapsedPosition(side) {
    const rect = this.window?.element?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x:side === "left" ? rect.left : side === "right" ? rect.right : rect.left + rect.width / 2,
      y:side === "top" ? rect.top : side === "bottom" ? rect.bottom : rect.top + rect.height / 2,
      status:"collapsed"
    };
  }

  _collapsedPorts() {
    return this.sides.flatMap(side => {
      const position = this._collapsedPosition(side);
      return position ? [{ controlId:this.controlId, itemId:`__collapsed-${side}`, side, aggregate:true, interactive:false, ...position }] : [];
    });
  }
}
