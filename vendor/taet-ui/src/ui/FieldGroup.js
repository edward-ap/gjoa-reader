import { Form } from "./Form.js";

export class FieldGroup extends Form {
  constructor(containerOrOptions = {}, maybeOptions, maybeContext = {}) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const context = hasContainer ? maybeContext ?? {} : maybeOptions ?? {};

    super(options, context);

    this.title = options.title ?? options.label ?? "";
    this._legend = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("fieldset");
    root.className = [
      "dui-control",
      "dui-form",
      `dui-form--${this.layout}`,
      "dui-field-group",
      this.css,
      this.className
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    if (this.labelWidth != null) {
      root.style.setProperty("--dui-label-width", `${this.labelWidth}px`);
    }

    const legend = document.createElement("legend");
    legend.className = "dui-field-group__title";
    legend.textContent = this.title;
    legend.hidden = this.title.length === 0;
    root.appendChild(legend);
    this._legend = legend;

    return root;
  }

  setTitle(title) {
    this._assertMutable("setTitle");
    this.title = title ?? "";

    if (this._legend) {
      this._legend.textContent = this.title;
      this._legend.hidden = this.title.length === 0;
    }

    return this;
  }

  destroy() {
    super.destroy();
    this._legend = null;
  }
}
