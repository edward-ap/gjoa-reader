import { EditorControl } from "./EditorControl.js";

export class CheckBox extends EditorControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({
      ...options,
      value: Object.prototype.hasOwnProperty.call(options, "value") ? options.value : options.checked,
      emptyValue: false
    });

    this.text = options.text ?? "";
    this._labelElement = null;
    this._textElement = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("label");
    root.className = ["dui-control", "dui-checkbox", this.css].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-checkbox__label";
    label.textContent = this.label;

    const content = document.createElement("span");
    content.className = "dui-checkbox__content";

    const input = document.createElement("input");
    input.className = "dui-checkbox__box";
    input.type = "checkbox";
    input.checked = this._value;
    input.disabled = this.disabled;
    input.dataset.duiFocusTarget = "true";

    const text = document.createElement("span");
    text.className = "dui-checkbox__text";
    text.textContent = this.text;

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    content.append(input, text);
    root.append(label, content, message);
    this._labelElement = label;
    this._textElement = text;
    this._input = input;
    this._message = message;
    this._syncStateToInput();

    this.disposables.addEventListener(input, "change", () => {
      this._setValue(input.checked, {
        origin: "user",
        userAction: true
      });
    });

    return root;
  }

  destroy() {
    super.destroy();
    this._labelElement = null;
    this._textElement = null;
  }

  setText(text, options = {}) {
    this._assertMutable("setText");

    const oldValue = this.text;
    this.text = text ?? "";
    this._renderText();

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

  getText() {
    return this.text;
  }

  _normalizeValue(value) {
    return value === true;
  }

  _syncInput(value) {
    if (this._input) {
      this._input.checked = value === true;
    }
  }

  _syncStateToInput() {
    if (!this._input) {
      return;
    }

    if (this.isReadOnly()) {
      this._input.setAttribute("aria-readonly", "true");
    } else {
      this._input.removeAttribute("aria-readonly");
    }
  }

  _renderLabel() {
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }
  }

  _renderText() {
    if (this._textElement) {
      this._textElement.textContent = this.text;
    }
  }
}
