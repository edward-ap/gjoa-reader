import { CheckButton } from "./CheckButton.js";

/** Borderless boolean action using CheckButton's value/validation lifecycle. */
export class ToggleIconButton extends CheckButton {
  createElement() {
    const root = super.createElement();
    root.classList.add("dui-toggle-icon-button");
    this._button.classList.remove("dui-button", "dui-check-button__button");
    this._button.classList.add("dui-tool-button", "dui-icon-button");
    return root;
  }

  _renderText() {
    super._renderText();
    if (!this._button) return;
    const name = this._textElement?.textContent || this.label;
    this._button.removeAttribute("aria-labelledby");
    this._button.setAttribute("aria-label", name);
    this._renderValidationMessage();
  }

  _renderLabel() {
    super._renderLabel();
    this._renderText();
  }

  _renderValidationMessage() {
    super._renderValidationMessage();
    if (this._button && !this._button.hasAttribute("title")) {
      this._button.title = this._textElement?.textContent || this.label;
    }
  }
}
