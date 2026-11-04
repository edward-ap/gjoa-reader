import { BaseControl } from "../core/BaseControl.js";

export class LabelText extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this._textSource = options.text ?? "";
    this.text = this._resolveText();
    this.role = options.role ?? "label";
    this.ariaRole = options.ariaRole ?? (["status", "alert"].includes(this.role) ? this.role : null);
    this.ariaLive = options.ariaLive ?? (this.ariaRole === "status" ? "polite" : this.ariaRole === "alert" ? "assertive" : null);
    this.ariaAtomic = options.ariaAtomic ?? (this.ariaRole ? true : null);
    if (this.ariaRole != null && !["status", "alert"].includes(this.ariaRole)) throw new TypeError("ariaRole must be status or alert.");
    if (this.ariaLive != null && !["off", "polite", "assertive"].includes(this.ariaLive)) throw new TypeError("Invalid ariaLive.");
    if (this.ariaAtomic != null && typeof this.ariaAtomic !== "boolean") throw new TypeError("ariaAtomic must be boolean.");
    this.className = options.className ?? options.css ?? "";

    this._bindOptionEvent("textChange", options.onTextChange);

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const element = document.createElement("span");
    element.className = ["dui-control", "dui-label-text", this.className].filter(Boolean).join(" ");
    element.dataset.duiControlId = this.id;
    element.textContent = this._resolveText();
    if (this.ariaRole) element.setAttribute("role", this.ariaRole);
    if (this.ariaLive) element.setAttribute("aria-live", this.ariaLive);
    if (this.ariaAtomic != null) element.setAttribute("aria-atomic", String(this.ariaAtomic));
    return element;
  }

  refresh() {
    super.refresh();
    this.text = this._resolveText();

    if (this.element) {
      this.element.textContent = this.text;
    }
  }

  getText() {
    return this.text;
  }

  setText(text, options = {}) {
    this._assertMutable("setText");
    const oldValue = this.text;
    this._textSource = text ?? "";
    this.text = String(text ?? "");

    if (this.element) {
      this.element.textContent = this.text;
    }

    if (!options.silent && oldValue !== this.text) {
      this.events.emit("textChange", {
        source: this,
        oldValue,
        newValue: this.text,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  _resolveText() {
    return typeof this._textSource === "function" ? String(this._textSource()) : String(this._textSource ?? "");
  }
}
