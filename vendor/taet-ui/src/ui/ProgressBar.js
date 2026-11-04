import { EditorControl } from "./EditorControl.js";

export class ProgressBar extends EditorControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const min = parseFiniteNumber(options.min ?? options.minimum, 0);
    const max = Math.max(min, parseFiniteNumber(options.max ?? options.maximum, 100));
    const value = normalizeProgressValue(
      Object.prototype.hasOwnProperty.call(options, "value") ? options.value : min,
      min,
      max
    );

    super({
      ...options,
      value,
      emptyValue: min
    });

    this.min = min;
    this.max = max;
    this._emptyValue = min;
    this._value = value;
    this._cleanValue = this._cloneValue(value);
    this.orientation = options.orientation === "vertical" ? "vertical" : "horizontal";
    this.showText = options.showText !== false;
    this.textMode = options.textMode ?? options.percentView ?? "percent";
    this.text = options.text ?? "";
    this.valueFormatter = typeof options.valueFormatter === "function" ? options.valueFormatter : null;
    this._fillTextElement = null;
    this._labelElement = null;
    this._trackElement = null;
    this._fillElement = null;
    this._textElement = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = [
      "dui-control",
      "dui-text-field",
      "dui-progress-bar",
      `dui-progress-bar--${this.orientation}`,
      this.showText && "dui-progress-bar--show-text",
      this.css
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-text-field__label dui-progress-bar__label";
    label.textContent = this.label;

    const track = document.createElement("div");
    track.className = "dui-progress-bar__track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", String(this.min));
    track.setAttribute("aria-valuemax", String(this.max));

    const fill = document.createElement("div");
    fill.className = "dui-progress-bar__fill";

    const text = document.createElement("div");
    text.className = "dui-progress-bar__text dui-progress-bar__text--track";
    text.setAttribute("aria-hidden", "true");
    const fillText = document.createElement("div");
    fillText.className = "dui-progress-bar__text dui-progress-bar__text--fill";
    fillText.setAttribute("aria-hidden", "true");

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    track.append(fill, text, fillText);
    root.append(label, track, message);

    this._labelElement = label;
    this._trackElement = track;
    this._fillElement = fill;
    this._textElement = text;
    this._fillTextElement = fillText;
    this._input = track;
    this._message = message;
    this._syncInput(this._value);

    return root;
  }

  destroy() {
    super.destroy();
    this._labelElement = null;
    this._trackElement = null;
    this._fillElement = null;
    this._textElement = null;
    this._fillTextElement = null;
  }

  setRange(min, max, options = {}) {
    this._assertMutable("setRange");
    const nextMin = parseFiniteNumber(min, this.min);
    const nextMax = Math.max(nextMin, parseFiniteNumber(max, this.max));
    this.min = nextMin;
    this.max = nextMax;
    this._emptyValue = nextMin;

    if (this._trackElement) {
      this._trackElement.setAttribute("aria-valuemin", String(this.min));
      this._trackElement.setAttribute("aria-valuemax", String(this.max));
    }

    return this._setValue(this._value, options);
  }

  setText(text, options = {}) {
    this._assertMutable("setText");
    const oldValue = this.text;
    this.text = text ?? "";
    this._renderText();

    if (!this.destroyed && !options.silent && oldValue !== this.text) {
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

  _normalizeValue(value) {
    return normalizeProgressValue(value, this.min, this.max);
  }

  _syncInput(value) {
    if (!this._trackElement && !this._textElement) return;
    const percent = this._getPercent(value);
    const text = this._formatText(value, percent);
    if (this.destroyed) return;

    if (this._trackElement) {
      this._trackElement.setAttribute("aria-valuenow", String(value));
      this._trackElement.setAttribute("aria-valuetext", text);
      this._trackElement.style.setProperty("--dui-progress-percent", `${percent}%`);
    }

    if (this._textElement) this._textElement.textContent = text;
    if (this._fillTextElement) this._fillTextElement.textContent = text;
  }

  _syncStateToInput() {
    if (!this._trackElement) {
      return;
    }

    if (this.isReadOnly()) {
      this._trackElement.setAttribute("aria-readonly", "true");
    } else {
      this._trackElement.removeAttribute("aria-readonly");
    }
  }

  _renderLabel() {
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }
  }

  _renderText() {
    this._syncInput(this._value);
  }

  _getPercent(value) {
    if (this.max <= this.min) {
      return 0;
    }

    return Math.min(100, Math.max(0, ((value - this.min) / (this.max - this.min)) * 100));
  }

  _formatText(value, percent) {
    if (this.valueFormatter) {
      return this.valueFormatter(value, {
        source: this,
        percent,
        min: this.min,
        max: this.max
      });
    }

    if (this.textMode === "value") {
      return String(value);
    }

    if (this.textMode === "custom") {
      return this.text;
    }

    return `${Math.round(percent)}%`;
  }
}

function parseFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProgressValue(value, min = 0, max = 100) {
  const parsed = parseFiniteNumber(value, min);
  return Math.min(max, Math.max(min, parsed));
}
