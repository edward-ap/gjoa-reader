import { Panel } from "./Panel.js";
import { PropertyGrid } from "./PropertyGrid.js";

export class PropertyInspector extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({
      ...options,
      css: ["dui-property-inspector", options.css].filter(Boolean).join(" "),
      scroll: "hidden"
    });

    this.grid = options.grid instanceof PropertyGrid
      ? options.grid
      : new PropertyGrid(options.grid ?? options.propertyGrid ?? {});

    this.disposables.add(
      this.grid.events.on("propertyFocusChange", event => {
        this.events.emit("propertyFocusChange", {
          ...event,
          source: this,
          grid: this.grid
        });
      })
    );

    for (const type of ["beforePropertyChange", "propertyChange", "afterPropertyChange"]) {
      this.disposables.add(
        this.grid.events.on(type, event => {
          const forwarded = { ...event, source: this, grid: this.grid };
          this.events.emit(type, forwarded);
          if (type === "beforePropertyChange" && forwarded.cancel) event.cancel = true;
        })
      );
    }

    if (options.source) {
      this.bind(options.source, { silent: true, origin: "system" });
    }

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = super.createElement();
    const gridHost = document.createElement("div");
    gridHost.className = "dui-property-inspector__grid";
    root.append(gridHost);
    return root;
  }

  mount(container) {
    super.mount(container);

    if (!this.hasItem(this.grid)) {
      this.attach(this.grid, {
        container: this.element.querySelector(".dui-property-inspector__grid")
      });
    }
    return this;
  }

  bind(source, options = {}) {
    this._assertMutable("bind");
    this.grid.bind(source, options);
    return this;
  }

  refresh(options = {}) {
    this._assertMutable("refresh");
    this.grid.refresh(options);
    return this;
  }

  clear(options = {}) {
    this._assertMutable("clear");

    if (this._destroyingChildren) {
      return Panel.prototype.clear.call(this);
    }

    this.grid.clear(options);
    return this;
  }

  getSelectedProperty() {
    return this.grid.getSelectedProperty();
  }

  selectProperty(pathOrName, options = {}) {
    return this.grid.selectProperty(pathOrName, options);
  }

  clearPropertySelection(options = {}) {
    return this.grid.clearPropertySelection(options);
  }

  destroy() {
    if (this.destroyed || this._destroying) return;
    if (!this.hasItem(this.grid)) this.grid.destroy();
    this._destroyingChildren = true;
    super.destroy();
    this._destroyingChildren = false;
  }
}
