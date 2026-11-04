import { GridPortProvider } from "./GridPortProvider.js";
import { MdiWindow } from "./MdiWindow.js";
import { StaticPortProvider } from "./StaticPortProvider.js";
import { ListPortProvider } from "./ListPortProvider.js";
import { TreeListPortProvider } from "./TreeListPortProvider.js";

export class MapperWindow extends MdiWindow {
  constructor(options = {}) {
    super(options);
    this.portSides = normalizeSides(options.portSides);
    this.portProviderFactory = options.portProviderFactory ?? defaultPortProviderFactory;
    this.portDefinitions = options.portDefinitions ?? null;
    this.portProvider = null;
    this.statusText = options.statusText ?? "Ready";
    this._mapperContentElement = null;
    this._portElements = null;
    this._statusElement = null;
    this._layers = new Set();
  }

  createElement() {
    const root = super.createElement();
    const body = this._contentElement;
    body.classList.add("dui-mapper-window__body");

    const left = document.createElement("div");
    left.className = "dui-mapper-window__ports dui-mapper-window__ports--left";
    const content = document.createElement("div");
    content.className = "dui-mapper-window__content";
    const right = document.createElement("div");
    right.className = "dui-mapper-window__ports dui-mapper-window__ports--right";
    const status = document.createElement("div");
    status.className = "dui-mapper-window__status";
    status.textContent = this.statusText;

    body.append(left, content, right, status);
    this._mapperContentElement = content;
    this._portElements = { left, right };
    this._statusElement = status;
    return root;
  }

  mount(container) {
    super.mount(container);
    this.portProvider ??= this.portProviderFactory(this.content, {
      controlId:this.name ?? this.id,
      sides:this.portSides,
      window:this,
      portElements:this._portElements,
      ports:this.portDefinitions
    });
    this.element?.classList.add("dui-mapper-window");
    return this;
  }

  connect(layer) {
    if (!this.portProvider) throw new Error("MapperWindow must be mounted before connect().");
    layer.registerProvider(this.portProvider);
    this._layers.add(layer);
    return this;
  }

  getContentElement() {
    return this._mapperContentElement ?? super.getContentElement();
  }

  setStatus(text) {
    this.statusText = text == null ? "" : String(text);
    if (this._statusElement) this._statusElement.textContent = this.statusText;
    return this;
  }

  destroy() {
    for (const layer of this._layers) {
      if (layer.providers.get(String(this.portProvider?.controlId)) === this.portProvider) layer.unregisterProvider(this.portProvider.controlId);
    }
    this._layers.clear();
    this.portProvider?.destroy?.();
    this.portProvider = null;
    this._mapperContentElement = null;
    this._portElements = null;
    this._statusElement = null;
    super.destroy();
  }
}

function defaultPortProviderFactory(control, options) {
  if (options.ports) return new StaticPortProvider(options);
  if (!control) throw new TypeError("MapperWindow requires content or a custom portProviderFactory.");
  if (typeof control.getItemGeometry === "function") return control.treeView
    ? new TreeListPortProvider(control, options) : new ListPortProvider(control, options);
  return new GridPortProvider(control, options);
}

function normalizeSides(sides = ["left", "right"]) {
  const result = [...new Set(sides)];
  if (result.length === 0 || result.some(side => side !== "left" && side !== "right")) {
    throw new TypeError("MapperWindow portSides must contain left and/or right.");
  }
  return result;
}
