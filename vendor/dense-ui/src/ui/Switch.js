import { EditorControl } from "./EditorControl.js";
import { renderIcon } from "./Icon.js";

export class Switch extends EditorControl {
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
    this.onText = options.onText ?? "On";
    this.offText = options.offText ?? "Off";
    this.onIcon = options.onIcon ?? null;
    this.offIcon = options.offIcon ?? null;
    this._labelElement = null;
    this._offIconElement = null;
    this._onIconElement = null;
    this._textElement = null;
    this._stateElement = null;
    this._visualElement = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("label");
    root.className = [
      "dui-control",
      "dui-switch",
      this.offIcon || this.onIcon ? "dui-switch--state-icons" : "",
      this.css
    ].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-switch__label";
    label.textContent = this.label;

    const content = document.createElement("span");
    content.className = "dui-switch__content";

    const input = document.createElement("input");
    input.className = "dui-switch__input";
    input.type = "checkbox";
    input.checked = this._value;
    input.disabled = this.disabled;
    input.dataset.duiFocusTarget = "true";

    const offIcon = document.createElement("span");
    offIcon.className = "dui-switch__state-icon dui-switch__state-icon--off";
    offIcon.setAttribute("aria-hidden", "true");
    renderIcon(offIcon, this.offIcon);

    const visual = Switch.createIndicator(this._value);
    visual.removeAttribute("role");
    visual.removeAttribute("aria-label");
    visual.setAttribute("aria-hidden", "true");

    const onIcon = document.createElement("span");
    onIcon.className = "dui-switch__state-icon dui-switch__state-icon--on";
    onIcon.setAttribute("aria-hidden", "true");
    renderIcon(onIcon, this.onIcon);

    const state = document.createElement("span");
    state.className = "dui-switch__state";

    const text = document.createElement("span");
    text.className = "dui-switch__text";
    text.textContent = this.text;

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    content.append(offIcon, input, visual, onIcon, state, text);
    root.append(label, content, message);

    this._labelElement = label;
    this._offIconElement = offIcon;
    this._onIconElement = onIcon;
    this._textElement = text;
    this._stateElement = state;
    this._visualElement = visual;
    this._input = input;
    this._message = message;
    this._syncInput(this._value);
    this._syncStateToInput();
    this._renderStateText();

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
    this._offIconElement = null;
    this._onIconElement = null;
    this._textElement = null;
    this._stateElement = null;
    this._visualElement = null;
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

  setStateText(onText, offText, options = {}) {
    this._assertMutable("setStateText");

    const oldValue = {
      onText: this.onText,
      offText: this.offText
    };

    this.onText = onText ?? "";
    this.offText = offText ?? "";
    this._renderStateText();

    if (!options.silent && (oldValue.onText !== this.onText || oldValue.offText !== this.offText)) {
      this.events.emit("stateTextChange", {
        source: this,
        oldValue,
        newValue: {
          onText: this.onText,
          offText: this.offText
        },
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  _normalizeValue(value) {
    return value === true;
  }

  _syncInput(value) {
    if (this._input) {
      this._input.checked = value === true;
    }

    this._visualElement?.classList.toggle("dui-switch__visual--checked", value === true);

    this._renderStateText();
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

    this._input.disabled = this.disabled || this.isReadOnly();
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

  _renderStateText() {
    if (this._stateElement) {
      this._stateElement.textContent = this._value ? this.onText : this.offText;
    }
    if (this._input) {
      const stateText = this._value ? this.onText : this.offText;
      this._input.setAttribute("aria-label", [this.label, stateText].filter(Boolean).join(": "));
    }
  }

  static createIndicator(value, options = {}) {
    const visual = document.createElement("span");
    visual.className = ["dui-switch__visual", options.className].filter(Boolean).join(" ");
    visual.classList.toggle("dui-switch__visual--checked", value === true);
    visual.setAttribute("role", "img");
    visual.setAttribute("aria-label", options.ariaLabel ?? (value === true ? "On" : "Off"));

    const track = document.createElement("span");
    track.className = "dui-switch__track";
    const thumb = document.createElement("span");
    thumb.className = "dui-switch__thumb";
    track.append(thumb);
    visual.append(track);
    return visual;
  }
}
