import { EditorControl } from "./EditorControl.js";

const MAX_TICKS = 101;

export class TrackBar extends EditorControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const min = parseFiniteNumber(options.min, 0);
    const max = Math.max(min, parseFiniteNumber(options.max, 100));
    const step = Math.max(0, parseFiniteNumber(options.step, 1));
    const value = normalizeTrackValue(
      Object.prototype.hasOwnProperty.call(options, "value") ? options.value : min,
      min,
      max,
      step
    );

    super({
      ...options,
      value,
      emptyValue: min
    });

    this.min = min;
    this.max = max;
    this.step = step;
    this._emptyValue = min;
    this._value = value;
    this._cleanValue = this._cloneValue(value);
    this.smallChange = Math.max(step || 1, parseFiniteNumber(options.smallChange, step || 1));
    this.largeChange = Math.max(this.smallChange, parseFiniteNumber(options.largeChange, this.smallChange * 10));
    this.orientation = normalizeOrientation(options.orientation);
    this.invert = options.invert === true || options.invertLayout === true;
    this.scale = normalizeScale(options.scale ?? options.showScale);
    this.tickFrequency = Math.max(this.step || 1, parseFiniteNumber(options.tickFrequency, this.largeChange));
    this.showTickLabels = options.showTickLabels === true;
    this.showValue = options.showValue === true;
    this.valuePosition = choice(options.valuePosition ?? 'right', ['left','right','top','bottom'], 'valuePosition');
    this.thumbShape = choice(options.thumbShape ?? 'circle', ['circle','ring','grip','line'], 'thumbShape');
    this.valueFormatter = typeof options.valueFormatter === "function" ? options.valueFormatter : null;
    this._labelElement = null;
    this._valueElement = null;
    this._minElement = null;
    this._maxElement = null;
    this._ticksElement = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("label");
    root.className = [
      "dui-control",
      "dui-trackbar",
      `dui-trackbar--${this.orientation}`,
      `dui-trackbar--scale-${this.scale}`,
      this.invert && "dui-trackbar--inverted",
      this.showValue && "dui-trackbar--show-value",
      this.css
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.valuePosition = this.valuePosition;
    root.dataset.thumbShape = this.thumbShape;

    const label = document.createElement("span");
    label.className = "dui-trackbar__label";
    label.textContent = this.label;

    const content = document.createElement("span");
    content.className = "dui-trackbar__content";

    const scale = document.createElement("span");
    scale.className = "dui-trackbar__scale";

    const minLabel = document.createElement("span");
    minLabel.className = "dui-trackbar__range-label dui-trackbar__range-label--min";

    const slider = document.createElement("span");
    slider.className = "dui-trackbar__slider";

    const input = document.createElement("input");
    input.className = "dui-trackbar__input";
    input.type = "range";
    input.setAttribute("aria-orientation", this.orientation);
    input.dataset.duiFocusTarget = "true";

    const ticks = document.createElement("span");
    ticks.className = "dui-trackbar__ticks";
    ticks.setAttribute("aria-hidden", "true");

    const maxLabel = document.createElement("span");
    maxLabel.className = "dui-trackbar__range-label dui-trackbar__range-label--max";

    const value = document.createElement("span");
    value.className = "dui-trackbar__value";

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    slider.append(ticks, input);
    scale.append(minLabel, slider, maxLabel);
    content.append(scale, value);
    root.append(label, content, message);

    this._labelElement = label;
    this._input = input;
    this._message = message;
    this._valueElement = value;
    this._minElement = minLabel;
    this._maxElement = maxLabel;
    this._ticksElement = ticks;

    this._syncStateToInput();
    this._syncInput(this._value);
    this._renderRangeLabels();
    this._renderTicks();

    this.disposables.addEventListener(input, "input", () => {
      this._setValue(input.value, {
        origin: "user",
        userAction: true
      });
    });

    this.disposables.addEventListener(input, "keydown", event => {
      this._handleKeyDown(event);
    });

    this.disposables.addEventListener(input, "wheel", event => {
      if (this.disabled || this.isReadOnly()) {
        return;
      }

      event.preventDefault();
      this._nudge(event.deltaY < 0 ? this.smallChange : -this.smallChange, {
        origin: "user",
        userAction: true
      });
    });

    return root;
  }

  setValuePosition(position) {
    this._assertMutable('setValuePosition');
    this.valuePosition = choice(position, ['left','right','top','bottom'], 'valuePosition');
    if (this.element) this.element.dataset.valuePosition = this.valuePosition;
    return this;
  }

  setThumbShape(shape) {
    this._assertMutable('setThumbShape');
    this.thumbShape = choice(shape, ['circle','ring','grip','line'], 'thumbShape');
    if (this.element) this.element.dataset.thumbShape = this.thumbShape;
    return this;
  }

  setShowValue(show) {
    this._assertMutable('setShowValue'); this.showValue = Boolean(show);
    this.element?.classList.toggle('dui-trackbar--show-value', this.showValue);
    return this;
  }

  destroy() {
    super.destroy();
    this._labelElement = null;
    this._valueElement = null;
    this._minElement = null;
    this._maxElement = null;
    this._ticksElement = null;
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

  setRange(min, max, options = {}) {
    this._assertMutable("setRange");

    const nextMin = parseFiniteNumber(min, this.min);
    const nextMax = Math.max(nextMin, parseFiniteNumber(max, this.max));
    this.min = nextMin;
    this.max = nextMax;
    this._emptyValue = nextMin;
    this._syncStateToInput();
    this._renderRangeLabels();
    this._renderTicks();

    return this._setValue(this._value, options);
  }

  setStep(step, options = {}) {
    this._assertMutable("setStep");
    this.step = Math.max(0, parseFiniteNumber(step, this.step));
    this._syncStateToInput();
    return this._setValue(this._value, options);
  }

  moveBegin(options = {}) {
    return this._setValue(this.invert ? this.max : this.min, options);
  }

  moveEnd(options = {}) {
    return this._setValue(this.invert ? this.min : this.max, options);
  }

  moveLeft(options = {}) {
    return this._nudge(this.invert ? this.smallChange : -this.smallChange, options);
  }

  moveRight(options = {}) {
    return this._nudge(this.invert ? -this.smallChange : this.smallChange, options);
  }

  moveUp(options = {}) {
    return this._nudge(this.invert ? -this.smallChange : this.smallChange, options);
  }

  moveDown(options = {}) {
    return this._nudge(this.invert ? this.smallChange : -this.smallChange, options);
  }

  _normalizeValue(value) {
    return normalizeTrackValue(value, this.min, this.max, this.step);
  }

  _syncInput(value) {
    if (this._input) {
      this._input.value = String(value);
      this._input.style.setProperty("--dui-trackbar-percent", `${this._getValuePercent(value)}%`);
    }

    this._renderValue();
  }

  _syncStateToInput() {
    if (!this._input) {
      return;
    }

    this._input.min = String(this.min);
    this._input.max = String(this.max);
    this._input.step = this.step > 0 ? String(this.step) : "any";
    this._input.disabled = this.disabled || this.isReadOnly();

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

  _handleKeyDown(event) {
    if (this.disabled || this.isReadOnly()) {
      return;
    }

    const options = {
      origin: "user",
      userAction: true
    };

    if (event.key === "Home") {
      event.preventDefault();
      this.moveBegin(options);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      this.moveEnd(options);
      return;
    }

    if (event.key === "PageUp") {
      event.preventDefault();
      this._nudge(this.largeChange, options);
      return;
    }

    if (event.key === "PageDown") {
      event.preventDefault();
      this._nudge(-this.largeChange, options);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.moveLeft(options);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.moveRight(options);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.moveUp(options);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.moveDown(options);
    }
  }

  _nudge(delta, options = {}) {
    return this._setValue(this._value + delta, options);
  }

  _renderRangeLabels() {
    if (this._minElement) {
      this._minElement.textContent = this._formatValue(this.min);
    }

    if (this._maxElement) {
      this._maxElement.textContent = this._formatValue(this.max);
    }
  }

  _renderValue() {
    if (this._valueElement) {
      this._valueElement.textContent = this._formatValue(this._value);
    }
  }

  _renderTicks() {
    if (!this._ticksElement) {
      return;
    }

    this._ticksElement.replaceChildren();

    if (this.scale !== "ticks") {
      return;
    }

    const values = createTickValues(this.min, this.max, this.tickFrequency);

    for (const value of values) {
      const tick = document.createElement("span");
      tick.className = "dui-trackbar__tick";
      tick.style.setProperty("--dui-trackbar-tick-percent", `${this._getValuePercent(value)}%`);

      if (this.showTickLabels) {
        const label = document.createElement("span");
        label.className = "dui-trackbar__tick-label";
        label.textContent = this._formatValue(value);
        tick.append(label);
      }

      this._ticksElement.append(tick);
    }
  }

  _getValuePercent(value) {
    if (this.max <= this.min) {
      return 0;
    }

    const percent = ((value - this.min) / (this.max - this.min)) * 100;
    return this.invert ? 100 - percent : percent;
  }

  _formatValue(value) {
    return this.valueFormatter ? this.valueFormatter(value) : String(value);
  }
}

function parseFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTrackValue(value, min = 0, max = 100, step = 1) {
  const parsed = parseFiniteNumber(value, min);
  const clamped = Math.min(max, Math.max(min, parsed));

  if (!step) {
    return clamped;
  }

  const snapped = min + Math.round((clamped - min) / step) * step;
  const precision = Math.max(getStepPrecision(step), getStepPrecision(min), getStepPrecision(max));
  const bounded = Math.min(max, Math.max(min, snapped));
  return precision > 100 ? bounded : Number(bounded.toFixed(precision));
}

function normalizeOrientation(orientation) {
  return orientation === "vertical" ? "vertical" : "horizontal";
}

function normalizeScale(scale) {
  if (scale === true || scale === "ticks") {
    return "ticks";
  }

  if (scale === "range" || scale === "labels" || scale === "minmax") {
    return "range";
  }

  return "none";
}

function createTickValues(min, max, frequency) {
  const values = [];

  if (frequency <= 0 || max <= min) {
    return [min, max];
  }

  for (let value = min, count = 0; value <= max && count < MAX_TICKS; value += frequency, count += 1) {
    values.push(normalizeTrackValue(value, min, max, 0));
  }

  if (!values.includes(max) && values.length < MAX_TICKS) {
    values.push(max);
  }

  return values;
}

function getStepPrecision(step) {
  const [coefficient, exponent = "0"] = String(step).toLowerCase().split("e");
  const fraction = coefficient.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent));
}

function choice(value, allowed, name) {
  if (!allowed.includes(value)) throw new TypeError(`Invalid TrackBar ${name}: ${value}`);
  return value;
}
