import { TextField } from "./TextField.js";

export class NumberInput extends TextField {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({
      ...options,
      inputType: options.inputType ?? options.type ?? "number",
      value: formatNumberValue(options.value),
      emptyValue: ""
    });

    this.min = options.min ?? null;
    this.max = options.max ?? null;
    this.step = options.step ?? options.increment ?? null;
    this.increment = this.step === "any" ? (options.increment ?? 1) : (this.step ?? 1);
    this.precision = normalizeOptionalInteger(options.precision ?? options.decimalPlaces);
    this.isInteger = options.isInteger === true || options.float === false || options.isFloatValue === false;
    this.clamp = options.clamp !== false && options.clampToRange !== false;
    this.allowSpinOnMouseWheel = options.allowSpinOnMouseWheel === true || options.allowWheel === true;
    this._value = formatNumberValue(
      this._normalizeNumber(Object.prototype.hasOwnProperty.call(options, "value") ? options.value : "")
    );
    this._cleanValue = this._cloneValue(this._getValue());
    if (hasContainer) this.mount(containerOrOptions);
  }

  createElement() {
    const root = super.createElement();
    root.classList.add("dui-number-input");

    if (this._input) {
      this._input.type = "number";
      this._input.classList.add("dui-number-input__input");

      if (this.min != null) {
        this._input.min = String(this.min);
      }

      if (this.max != null) {
        this._input.max = String(this.max);
      }

      if (this.step != null) {
        this._input.step = String(this.step);
      }

      this.disposables.addEventListener(this._input, "keydown", event => {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowUp") {
          event.preventDefault();
          this.spinUp({
            origin: "user",
            userAction: true
          });
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          this.spinDown({
            origin: "user",
            userAction: true
          });
        }
      });

      this.disposables.addEventListener(this._input, "blur", () => {
        if (this.clamp) {
          this._setValue(this._value, {
            silent: true,
            origin: "system"
          });
        }
      });

      this.disposables.addEventListener(this._input, "wheel", event => {
        if (!this.allowSpinOnMouseWheel) {
          return;
        }

        event.preventDefault();

        if (event.deltaY < 0) {
          this.spinUp({
            origin: "user",
            userAction: true
          });
        } else if (event.deltaY > 0) {
          this.spinDown({
            origin: "user",
            userAction: true
          });
        }
      });
    }

    return root;
  }

  spinUp(options = {}) {
    return this.spin(1, options);
  }

  spinDown(options = {}) {
    return this.spin(-1, options);
  }

  spin(direction = 1, options = {}) {
    this._assertMutable("spin");

    if (this.disabled || this.isReadOnly()) {
      return false;
    }

    const delta = (Number(direction) >= 0 ? 1 : -1) * Number(this.increment || 1);
    const current = parseNumberValue(this._value) ?? this._getSpinStartValue(delta);
    return this._setValue(current + delta, options);
  }

  _getValue() {
    return parseNumberValue(this._value);
  }

  _getValidationValue() {
    return this._getValue();
  }

  _setValue(nextValue, options = {}) {
    return super._setValue(formatNumberValue(this._normalizeNumber(nextValue)), options);
  }

  _valueToEventValue(value) {
    return parseNumberValue(value);
  }

  _syncStateToInput() {
    super._syncStateToInput();

    if (!this._input) {
      return;
    }

    if (this.min != null) {
      this._input.min = String(this.min);
    }

    if (this.max != null) {
      this._input.max = String(this.max);
    }

    if (this.step != null) {
      this._input.step = String(this.step);
    }
  }

  _normalizeNumber(value) {
    let parsed = parseNumberValue(value);

    if (parsed == null) {
      return "";
    }

    if (this.isInteger) {
      parsed = Math.trunc(parsed);
    }

    if (this.clamp) {
      parsed = clampNumber(parsed, this.min, this.max);
    }

    if (this.precision != null) {
      parsed = Number(parsed.toFixed(this.precision));
    }

    return parsed;
  }

  _getSpinStartValue(delta) {
    if (delta > 0 && this.min != null) {
      return Number(this.min) - delta;
    }

    if (delta < 0 && this.max != null) {
      return Number(this.max) - delta;
    }

    return 0;
  }
}

function formatNumberValue(value) {
  if (value == null || value === "") {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  return String(value);
}

function parseNumberValue(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value, min, max) {
  let nextValue = value;
  const minValue = min == null ? null : Number(min);
  const maxValue = max == null ? null : Number(max);

  if (Number.isFinite(minValue)) {
    nextValue = Math.max(minValue, nextValue);
  }

  if (Number.isFinite(maxValue)) {
    nextValue = Math.min(maxValue, nextValue);
  }

  return nextValue;
}

function normalizeOptionalInteger(value) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
