import { BaseControl } from "../core/BaseControl.js";
import { normalizeMutationOptions } from "../core/mutationOptions.js";

let nextAccessibilityId = 1;

export class EditorControl extends BaseControl {
  constructor(options = {}) {
    super(options);
    this._accessibilityId = `dui-editor-a11y-${nextAccessibilityId++}`;

    this.label = options.label ?? "";
    this.labelPosition = normalizeLabelPosition(options.labelPosition, true);
    this.labelWidth = options.labelWidth ?? null;
    this.indent = options.indent ?? options.leftIndent ?? null;
    this.css = options.css ?? "";
    this._emptyValue = this._normalizeValue(
      Object.prototype.hasOwnProperty.call(options, "emptyValue") ? options.emptyValue : ""
    );
    this._value = this._normalizeValue(
      Object.prototype.hasOwnProperty.call(options, "value") ? options.value : this._emptyValue
    );
    this._cleanValue = this._cloneValue(this._getValue());
    this.validators = Array.isArray(options.validators) ? [...options.validators] : [];
    this._input = null;
    this._message = null;
    this._validationErrors = [];

    this.validation = Object.freeze({
      getErrors: () => this.getErrors(),
      clear: options => this.clearValidation(options)
    });

    this.value = Object.freeze({
      get: () => this._getValue(),
      set: (value, options) => this._setValue(value, options),
      clear: options => this._setValue(this._emptyValue, options),
      reset: options => this.reset(options)
    });

    this._bindOptionEvent("beforeChange", options.onBeforeChange);
    this._bindOptionEvent("change", options.onChange);
    this._bindOptionEvent("afterChange", options.onAfterChange);
    this._bindOptionEvent("dirtyChange", options.onDirtyChange);
    this._bindOptionEvent("validate", options.onValidate);
    this._bindOptionEvent("validationClear", options.onValidationClear);

    if (options.readOnly === true || options.readonly === true) {
      this.state.set("readonly", true, { silent: true, origin: "system" });
    }

    if (options.required === true) {
      this.state.set("required", true, { silent: true, origin: "system" });
    }
  }

  mount(container) {
    super.mount(container);
    this._applyEditorLayout();
    return this;
  }

  refresh() {
    super.refresh();
    this._syncInput(this._value);
    this._syncStateToInput();
    this._renderLabel();
    this._renderValidationMessage();
  }

  enable() {
    super.enable();

    if (this._input) {
      this._input.disabled = false;
    }

    return this;
  }

  disable() {
    super.disable();

    if (this._input) {
      this._input.disabled = true;
    }

    return this;
  }

  destroy() {
    super.destroy();
    this._input = null;
    this._message = null;
    this._validationErrors = [];
  }

  getName() {
    return this.name ?? this.id;
  }

  getLabel() {
    return this.label;
  }

  setLabel(label, options = {}) {
    this._assertMutable("setLabel");

    const oldValue = this.label;
    this.label = label ?? "";
    this._renderLabel();

    if (!options.silent && oldValue !== this.label) {
      this.events.emit("labelChange", {
        source: this,
        oldValue,
        newValue: this.label,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  setLabelPosition(position) {
    this._assertMutable("setLabelPosition");
    this.labelPosition = normalizeLabelPosition(position, true);
    this._applyEditorLayout();
    return this;
  }

  setLabelWidth(width) {
    this._assertMutable("setLabelWidth");
    this.labelWidth = width ?? null;
    this._applyEditorLayout();
    return this;
  }

  setIndent(indent) {
    this._assertMutable("setIndent");
    this.indent = indent ?? null;
    this._applyEditorLayout();
    return this;
  }

  isReadOnly() {
    return this.state.has("readonly");
  }

  setReadOnly(readOnly, options = {}) {
    this._assertMutable("setReadOnly");

    if (readOnly) {
      this.state.set("readonly", true, options);
    } else {
      this.state.clear("readonly", options);
    }

    return this;
  }

  isRequired() {
    return this.state.has("required");
  }

  setRequired(required, options = {}) {
    this._assertMutable("setRequired");

    if (required) {
      this.state.set("required", true, options);
    } else {
      this.state.clear("required", options);
    }

    return this;
  }

  getErrors() {
    return [...this._validationErrors];
  }

  setValidators(validators = []) {
    this._assertMutable("setValidators");

    if (!Array.isArray(validators)) {
      throw new TypeError("Validators must be an array.");
    }

    this.validators = [...validators];
    return this;
  }

  addValidator(validator) {
    this._assertMutable("addValidator");

    if (typeof validator !== "function") {
      throw new TypeError("Validator must be a function.");
    }

    this.validators.push(validator);
    return this;
  }

  validate(context = {}) {
    this._assertMutable("validate");

    const errors = [];
    const value = this._getValidationValue();

    for (const validator of this.validators) {
      if (typeof validator !== "function") {
        throw new TypeError("Validator must be a function.");
      }

      const validation = validator(value, { ...context, control: this, value });
      // A validator may close the owning screen, destroying this control.
      if (this.destroyed) return { source: this, ok: false, errors, value };
      const normalized = normalizeValidationResult(validation, this);

      if (normalized) {
        errors.push(normalized);
      }
    }

    this._validationErrors = errors;
    this._applyValidationState(errors);
    this._renderValidationMessage();

    const result = {
      source: this,
      ok: !errors.some(error => error.severity === "error"),
      errors,
      value
    };

    this.events.emit("validate", result);
    return result;
  }

  isValid() {
    return this.validate().ok;
  }

  clearValidation(options = {}) {
    this._assertMutable("clearValidation");
    this._validationErrors = [];
    this.state.clear("invalid", { silent: true, origin: "system" });
    this.state.clear("warning", { silent: true, origin: "system" });
    this._renderValidationMessage();

    if (!options.silent) {
      this.events.emit("validationClear", {
        source: this,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  isDirty() {
    return !Object.is(this._getValue(), this._cleanValue);
  }

  setCleanValue(value = this._getValue()) {
    this._assertMutable("setCleanValue");
    this._cleanValue = this._cloneValue(value);
    this._applyDirtyState();
    return this;
  }

  reset(options = {}) {
    return this._setValue(this._cleanValue, options);
  }

  _getValue() {
    return this._value;
  }

  _getValidationValue() {
    return this._getValue();
  }

  _normalizeValue(value) {
    return value;
  }

  _cloneValue(value) {
    if (value && typeof value === "object") {
      return structuredClone(value);
    }

    return value;
  }

  _setValue(nextValue, options = {}) {
    this._assertMutable("value.set");

    const mutation = normalizeMutationOptions(options);
    const oldValue = this._value;
    const newValue = this._normalizeValue(nextValue);

    if ((this.disabled || this.isReadOnly()) && mutation.userAction) {
      this._syncInput(oldValue);
      return false;
    }

    if (Object.is(oldValue, newValue)) {
      this._syncInput(oldValue);
      return false;
    }

    const wasDirty = this.isDirty();
    const beforeEvent = {
      source: this,
      oldValue: this._valueToEventValue(oldValue),
      newValue: this._valueToEventValue(newValue),
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) {
      this.events.emit("beforeChange", beforeEvent);
    }

    if (this.destroyed) return false;

    if (beforeEvent.cancel) {
      this._syncInput(oldValue);
      return false;
    }

    this._value = newValue;
    this._syncInput(newValue);
    this.clearValidation({ silent: true });

    const isDirty = this.isDirty();
    this._applyDirtyState();

    if (!mutation.silent) {
      const changeEvent = {
        source: this,
        oldValue: this._valueToEventValue(oldValue),
        newValue: this._valueToEventValue(newValue),
        origin: mutation.origin,
        userAction: mutation.userAction
      };

      this.events.emit("change", changeEvent);
      if (this.destroyed) return true;
      this.events.emit("afterChange", cloneEventForAfter(changeEvent));
      if (this.destroyed) return true;

      if (wasDirty !== isDirty) {
        this.events.emit("dirtyChange", {
          source: this,
          oldValue: wasDirty,
          newValue: isDirty,
          origin: mutation.origin,
          userAction: mutation.userAction
        });
      }
    }

    return true;
  }

  _valueToEventValue(value) {
    return value;
  }

  _syncInput(_value) {}

  _syncStateToInput() {}

  _renderLabel() {}

  _applyEditorLayout() {
    if (!this.element) {
      return;
    }

    this.element.classList.add("dui-editor");
    this.element.classList.toggle("dui-editor--label-left", this.labelPosition === "left");
    this.element.classList.toggle("dui-editor--label-top", this.labelPosition === "top");
    setOptionalCssProperty(this.element, "--dui-label-width", this.labelWidth);
    setOptionalCssProperty(this.element, "--dui-editor-indent", this.indent);
  }

  _afterStateChange(name) {
    if (name === "readonly" || name === "required") {
      this._syncStateToInput();
    }

    if (name === "invalid" || name === "warning") {
      this._renderValidationMessage();
    }
  }

  _applyValidationState(errors) {
    const firstError = errors.find(error => error.severity === "error");
    const firstWarning = errors.find(error => error.severity === "warning");

    if (firstError) {
      this.state.set("invalid", firstError, { silent: true, origin: "system" });
    } else {
      this.state.clear("invalid", { silent: true, origin: "system" });
    }

    if (firstWarning) {
      this.state.set("warning", firstWarning, { silent: true, origin: "system" });
    } else {
      this.state.clear("warning", { silent: true, origin: "system" });
    }
  }

  _applyDirtyState() {
    if (this.isDirty()) {
      this.state.set("dirty", true, { silent: true, origin: "system" });
    } else {
      this.state.clear("dirty", { silent: true, origin: "system" });
    }
  }

  _renderValidationMessage() {
    if (!this._message) {
      return;
    }

    const message = this._validationErrors[0]?.message ?? "";
    this._message.textContent = message;
    this._message.hidden = message === "";
    this.element?.toggleAttribute("data-dui-has-hint", message !== "");

    if (this._input) {
      if (message) {
        this._input.title = message;
        this._input.setAttribute("aria-invalid", this.state.has("invalid") ? "true" : "false");
        this._input.setAttribute("aria-describedby", `${this._accessibilityId}-message`);
        this._message.id = `${this._accessibilityId}-message`;
      } else {
        this._input.removeAttribute("title");
        this._input.removeAttribute("aria-invalid");
        this._input.removeAttribute("aria-describedby");
        this._message.removeAttribute("id");
      }
    }
  }
}

export function normalizeValidationResult(result, control) {
  if (result == null || result === true) {
    return null;
  }

  if (typeof result === "string") {
    return {
      control,
      path: control.name ?? control.id,
      severity: "error",
      message: result
    };
  }

  if (typeof result === "object") {
    if (result.ok === true) {
      return null;
    }

    return {
      control,
      path: control.name ?? control.id,
      severity: result.severity === "warning" ? "warning" : "error",
      message: result.message ?? "Invalid value",
      code: result.code
    };
  }

  return {
    control,
    path: control.name ?? control.id,
    severity: "error",
    message: "Invalid value"
  };
}

function cloneEventForAfter(event) {
  const clone = { ...event };
  delete clone.type;
  return clone;
}

function normalizeLabelPosition(position, optional = false) {
  if (position == null && optional) {
    return null;
  }

  const normalized = String(position ?? "left").toLowerCase();

  if (normalized !== "left" && normalized !== "top") {
    throw new TypeError('labelPosition must be either "left" or "top".');
  }

  return normalized;
}

function setOptionalCssProperty(element, name, value) {
  if (value == null || value === "") {
    element.style.removeProperty(name);
    return;
  }

  element.style.setProperty(name, typeof value === "number" ? `${value}px` : String(value));
}
