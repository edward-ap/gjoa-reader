import { ToolButton } from "./ToolButton.js";

/** Borderless icon action; text/label supplies its accessible name. */
export class IconButton extends ToolButton {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer = typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    super({ ...options, showText: false });
    this.pressed = options.pressed ?? null;
    if (hasContainer) this.mount(containerOrOptions);
  }

  createElement() {
    const button = super.createElement();
    button.classList.add("dui-icon-button");
    if (this.pressed != null) button.setAttribute("aria-pressed", String(this.pressed));
    return button;
  }

  setPressed(value) {
    this._assertMutable("setPressed");
    if (value !== null && typeof value !== "boolean") throw new TypeError("pressed must be boolean or null");
    this.pressed = value;
    if (value === null) this.element?.removeAttribute("aria-pressed");
    else this.element?.setAttribute("aria-pressed", String(value));
    return this;
  }
}
