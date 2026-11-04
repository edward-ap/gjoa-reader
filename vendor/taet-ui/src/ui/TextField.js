import { EditorControl } from "./EditorControl.js";

export class TextField extends EditorControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.inputType = options.inputType ?? options.type ?? "text";
    this.isPassword =
      options.isPassword === true || options.password === true || this.inputType === "password";
    this.showRevealButton = this.isPassword && options.showRevealButton !== false;
    this.mask = typeof options.mask === "string" && options.mask !== "" ? options.mask : null;
    this.placeholder = options.placeholder ?? this.mask ?? "";
    this.unmaskValue = options.unmaskValue === true;
    this.placeholderChar = options.placeholderChar ?? "_";
    this.maxLength = normalizeOptionalPositiveInteger(options.maxLength ?? options.maxlength);
    this.spellcheck = options.spellcheck;
    this.autocomplete = options.autocomplete ?? null;
    this._passwordVisible = false;
    this._labelElement = null;
    this._inputWrapper = null;
    this._revealButton = null;

    if (this.mask) {
      this._emptyValue = this._normalizeValue(
        Object.prototype.hasOwnProperty.call(options, "emptyValue") ? options.emptyValue : ""
      );
      this._value = this._normalizeValue(
        Object.prototype.hasOwnProperty.call(options, "value") ? options.value : this._emptyValue
      );
      this._cleanValue = this._cloneValue(this._getValue());
    }

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("label");
    root.className = [
      "dui-control",
      "dui-text-field",
      this.showRevealButton ? "dui-text-field--with-button" : "",
      this.mask ? "dui-text-field--masked" : "",
      this.css
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-text-field__label";
    label.textContent = this.label;

    const input = document.createElement("input");
    input.className = "dui-text-field__input";
    input.type = this._getInputType();
    input.placeholder = this.placeholder;
    input.value = this._getDisplayValue(this._value);
    input.disabled = this.disabled;
    input.readOnly = this.isReadOnly();
    input.required = this.isRequired();
    input.dataset.duiFocusTarget = "true";

    if (this.maxLength != null && !this.mask) {
      input.maxLength = this.maxLength;
    }

    if (this.spellcheck != null) {
      input.spellcheck = this.spellcheck === true;
    }

    if (this.autocomplete != null) {
      input.autocomplete = this.autocomplete;
    }

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    if (this.showRevealButton) {
      const wrapper = document.createElement("span");
      wrapper.className = "dui-text-field__group";

      const button = document.createElement("button");
      button.className = "dui-text-field__reveal";
      button.type = "button";
      button.tabIndex = -1;
      button.setAttribute("aria-label", "Show password");
      button.title = "Show password";

      wrapper.append(input, button);
      root.append(label, wrapper, message);
      this._inputWrapper = wrapper;
      this._revealButton = button;
      this._renderRevealButton();
    } else {
      root.append(label, input, message);
    }

    this._labelElement = label;
    this._input = input;
    this._message = message;

    this.disposables.addEventListener(input, "input", () => {
      const value = this._getValueFromInput(input.value);
      const displayValue = this._getDisplayValue(value);

      if (this.mask && input.value !== displayValue) {
        input.value = displayValue;
        input.setSelectionRange(displayValue.length, displayValue.length);
      }

      this._setValue(value, {
        origin: "user",
        userAction: true
      });
    });

    if (this._revealButton) {
      this.disposables.addEventListener(this._revealButton, "click", event => {
        event.preventDefault();
        this.togglePasswordVisible(undefined, {
          origin: "user",
          userAction: true
        });
      });
    }

    return root;
  }

  destroy() {
    super.destroy();
    this._labelElement = null;
    this._inputWrapper = null;
    this._revealButton = null;
  }

  enable() {
    super.enable();
    this._syncStateToInput();
    return this;
  }

  disable() {
    super.disable();
    this._syncStateToInput();
    return this;
  }

  setPasswordVisible(visible, options = {}) {
    this._assertMutable("setPasswordVisible");

    if (!this.isPassword) {
      return false;
    }

    const nextValue = visible === true;

    if (this._passwordVisible === nextValue) {
      return false;
    }

    const oldValue = this._passwordVisible;
    this._passwordVisible = nextValue;

    if (this._input) {
      this._input.type = this._getInputType();
    }

    this._renderRevealButton();

    if (!options.silent) {
      this.events.emit("passwordVisibilityChange", {
        source: this,
        oldValue,
        newValue: this._passwordVisible,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  togglePasswordVisible(visible, options = {}) {
    const nextValue = visible == null ? !this._passwordVisible : visible === true;
    return this.setPasswordVisible(nextValue, options);
  }

  getDisplayValue() {
    return this._getDisplayValue(this._value);
  }

  getRawValue() {
    return this.mask ? unmaskValue(this._getDisplayValue(this._value)) : this._value;
  }

  _normalizeValue(value) {
    const text = value == null ? "" : String(value);

    if (!this.mask) {
      return text;
    }

    const formatted = formatMaskedValue(text, this.mask);
    return this.unmaskValue ? unmaskValue(formatted) : formatted;
  }

  _syncInput(value) {
    const displayValue = this._getDisplayValue(value);

    if (this._input && this._input.value !== displayValue) {
      this._input.value = displayValue;
    }
  }

  _syncStateToInput() {
    if (!this._input) {
      return;
    }

    this._input.readOnly = this.isReadOnly();
    this._input.required = this.isRequired();

    if (this._input.tagName === "INPUT") {
      this._input.type = this._getInputType();
    }

    if (this._revealButton) {
      this._revealButton.disabled = this.disabled || this.isReadOnly();
    }
  }

  _applyEditorLayout() {
    super._applyEditorLayout();
    this._syncAccessibleLabel();
  }

  _syncAccessibleLabel() {
    if (!this._labelElement || !this._input) return;
    const labelId = `${this._accessibilityId}-label`;
    if (this.label) {
      this._labelElement.id = labelId;
      this._input.setAttribute("aria-labelledby", labelId);
    } else if (this._input.getAttribute("aria-labelledby") === labelId) {
      this._input.removeAttribute("aria-labelledby");
      this._labelElement.removeAttribute("id");
    }
  }

  _renderLabel() {
    this._syncAccessibleLabel();
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }
  }

  _getInputType() {
    if (this.isPassword) {
      return this._passwordVisible ? "text" : "password";
    }

    return this.inputType;
  }

  _getValueFromInput(displayValue) {
    if (!this.mask) {
      return displayValue;
    }

    const formatted = formatMaskedValue(displayValue, this.mask);
    return this.unmaskValue ? unmaskValue(formatted) : formatted;
  }

  _getDisplayValue(value) {
    if (!this.mask) {
      return value == null ? "" : String(value);
    }

    return formatMaskedValue(value, this.mask);
  }

  _renderRevealButton() {
    if (!this._revealButton) {
      return;
    }

    this._revealButton.classList.toggle("dui-text-field__reveal--active", this._passwordVisible);
    this._revealButton.setAttribute("aria-pressed", this._passwordVisible ? "true" : "false");
    this._revealButton.setAttribute("aria-label", this._passwordVisible ? "Hide password" : "Show password");
    this._revealButton.title = this._passwordVisible ? "Hide password" : "Show password";
  }
}

function normalizeOptionalPositiveInteger(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function formatMaskedValue(value, mask) {
  const input = String(value ?? "");
  let inputIndex = 0;
  let result = "";

  for (const maskChar of mask) {
    const token = maskTokens[maskChar];

    if (!token) {
      if (inputIndex < input.length || result !== "") {
        if (input[inputIndex] === maskChar) {
          inputIndex += 1;
        }

        result += maskChar;
      }

      continue;
    }

    let accepted = false;

    while (inputIndex < input.length) {
      const nextChar = input[inputIndex];
      inputIndex += 1;

      if (token.test(nextChar)) {
        result += nextChar;
        accepted = true;
        break;
      }
    }

    if (!accepted) {
      break;
    }
  }

  return result;
}

function unmaskValue(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "");
}

const maskTokens = {
  "0": /[0-9]/,
  "9": /[0-9]/,
  A: /[A-Za-z]/,
  a: /[A-Za-z]/,
  "*": /[A-Za-z0-9]/
};
