import { BaseControl } from "../core/BaseControl.js";

export class LogPanel extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);
    this.css = options.css ?? "";

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-log-panel", this.css].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    root.setAttribute("aria-live", "polite");
    return root;
  }

  write(message) {
    this._assertMutable("write");

    const row = document.createElement("div");
    row.className = "dui-log-panel__row";
    row.textContent = message;
    this.element?.prepend(row);
  }

  clear() {
    this._assertMutable("clear");

    if (this.element) {
      this.element.textContent = "";
    }
  }
}
