import { CheckBox } from "./CheckBox.js";

export class CheckLetter extends CheckBox {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);
    this.letter = String(options.letter ?? options.marker ?? "");
    this._letterElement = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = super.createElement();
    root.classList.add("dui-check-letter");
    this._input?.classList.add("dui-check-letter__input");

    const marker = document.createElement("span");
    marker.className = "dui-check-letter__marker";
    marker.setAttribute("aria-hidden", "true");
    this._input?.after(marker);
    this._letterElement = marker;
    this._renderLetter();
    return root;
  }

  destroy() {
    super.destroy();
    this._letterElement = null;
  }

  setLetter(letter, options = {}) {
    this._assertMutable("setLetter");
    const oldValue = this.letter;
    this.letter = String(letter ?? "");
    this._renderLetter();

    if (!options.silent && oldValue !== this.letter) {
      this.events.emit("letterChange", {
        source: this,
        oldValue,
        newValue: this.letter,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }
    return this;
  }

  getLetter() {
    return this.letter;
  }

  setText(text, options = {}) {
    super.setText(text, options);
    this._renderLetter();
    return this;
  }

  _renderLetter() {
    if (this._letterElement) {
      this._letterElement.textContent = this.letter;
    }
    if (this._input) {
      const accessibleText = [this.letter, this.text].filter(Boolean).join(". ");
      if (accessibleText) this._input.setAttribute("aria-label", accessibleText);
      else this._input.removeAttribute("aria-label");
    }
  }
}
