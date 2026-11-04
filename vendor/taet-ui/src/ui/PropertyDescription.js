import { BaseControl } from "../core/BaseControl.js";

export class PropertyDescription extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);
    this.css = options.css ?? options.className ?? "";
    this.emptyText = options.emptyText ?? "";
    this.title = options.title ?? "";
    this.description = options.description ?? this.emptyText;
    this.property = options.property ?? null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("section");
    root.className = ["dui-control", "dui-property-description", this.css]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.setAttribute("aria-live", "polite");

    const title = document.createElement("div");
    title.className = "dui-property-description__title";
    const text = document.createElement("div");
    text.className = "dui-property-description__text";
    root.append(title, text);
    this._render(root);
    return root;
  }

  bind(property, options = {}) {
    this._assertMutable("bind");
    const oldProperty = this.property;
    this.property = property ?? null;
    this.title = property ? property.label ?? property.name ?? "" : "";
    this.description = property
      ? property.description ?? property.help ?? this.emptyText
      : this.emptyText;
    this._render();

    if (!options.silent && oldProperty !== this.property) {
      this.events.emit("bind", {
        source: this,
        property: this.property,
        oldProperty,
        title: this.title,
        description: this.description,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }
    return this;
  }

  clear(options = {}) {
    return this.bind(null, options);
  }

  getProperty() {
    return this.property;
  }

  getTitle() {
    return this.title;
  }

  getDescription() {
    return this.description;
  }

  setDescription(description, options = {}) {
    this._assertMutable("setDescription");
    const oldValue = this.description;
    this.description = description ?? this.emptyText;
    this._render();

    if (!options.silent && oldValue !== this.description) {
      this.events.emit("descriptionChange", {
        source: this,
        property: this.property,
        oldValue,
        value: this.description,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }
    return this;
  }

  _render(element = this.element) {
    if (!element) return;
    element.querySelector(".dui-property-description__title").textContent = this.title;
    element.querySelector(".dui-property-description__text").textContent = this.description;
    element.classList.toggle("dui-property-description--empty", !this.title && !this.description);
  }
}
