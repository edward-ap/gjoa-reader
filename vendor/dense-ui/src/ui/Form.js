import { Panel } from "./Panel.js";
import { normalizeMutationOptions } from "../core/mutationOptions.js";

export class Form extends Panel {
  constructor(containerOrOptions = {}, maybeOptions, maybeContext = {}) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const context = hasContainer ? maybeContext ?? {} : maybeOptions ?? {};

    super(options);

    this.layout = options.layout ?? "property";
    this.labelPosition = normalizeLabelPosition(options.labelPosition ?? "left");
    this.labelWidth = options.labelWidth ?? null;
    this.fieldIndent = options.fieldIndent ?? options.leftIndent ?? 0;
    this.css = options.css ?? "";
    this.commands = options.commands ?? context.commands ?? null;
    this._rows = [];
    this._fieldSubscriptions = new Map();
    // Keep only live subscriptions; removed fields must not stay in the bag.
    this.disposables.add(() => {
      for (const subscription of this._fieldSubscriptions.values()) subscription.dispose();
      this._fieldSubscriptions.clear();
    });
    this._batchDepth = 0;
    this._batchedChanges = [];
    this._initialValue = { ...(options.initialValue ?? options.value ?? {}) };

    this.value = Object.freeze({
      get: () => this.getValue(),
      set: (value, options) => this.setValue(value, options),
      clear: options => this.clearValues(options),
      reset: options => this.reset(options)
    });

    this._bindOptionEvent("beforeSubmit", options.onBeforeSubmit);
    this._bindOptionEvent("submit", options.onSubmit);
    this._bindOptionEvent("afterSubmit", options.onAfterSubmit);
    this._bindOptionEvent("validationFail", options.onValidationFail);
    this._bindOptionEvent("change", options.onChange);
    this._bindOptionEvent("clear", options.onClear);
    this._bindOptionEvent("reset", options.onReset);

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = [
      "dui-control",
      "dui-form",
      `dui-form--${this.layout}`,
      `dui-form--labels-${this.labelPosition}`,
      this.css,
      this.className
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    setOptionalCssProperty(root, "--dui-label-width", this.labelWidth);
    setOptionalCssProperty(root, "--dui-form-field-indent", this.fieldIndent);
    this._applyPanelAppearance(root);

    return root;
  }

  mount(container) {
    super.mount(container);
    if (this.destroyed || this._destroying) return this;
    this._renderPendingRows();
    if (this.destroyed || this._destroying) return this;

    if (Object.keys(this._initialValue).length > 0) {
      this.setValue(this._initialValue, {
        silent: true,
        origin: "import"
      });
      this._markFieldsClean(this._initialValue);
    }

    return this;
  }

  attach(control, options = {}) {
    const attached = super.attach(control, options);

    if (!attached || this.destroyed || this._destroying || attached.destroyed || attached.parent !== this) {
      return null;
    }

    this._registerFormControl(attached);
    if (this.destroyed || this._destroying || attached.destroyed) return null;
    this._applyFormItemClass(attached);

    return attached;
  }

  row(...controls) {
    this._assertMutable("row");
    return this._addControlRow(controls.flat(), "cols");
  }

  col(...controls) {
    this._assertMutable("col");
    return this._addControlRow(controls.flat(), "rows");
  }

  columns(...columns) {
    this._assertMutable("columns");

    const normalizedColumns = columns.map(column => this._normalizeColumn(column));

    if (!this._claimComposedControls(normalizedColumns.flatMap(column => column.controls))) return this;

    const row = { columns: normalizedColumns, direction: "columns", host: null };
    this._rows.push(row);

    if (this.element) {
      this._renderRow(row);
    }

    return this;
  }

  static column(...controls) {
    return controls.flat();
  }

  _addControlRow(controls, direction) {
    if (!this._claimComposedControls(controls)) return this;

    const row = { controls, direction, host: null };
    this._rows.push(row);

    if (this.element) {
      this._renderRow(row);
    }

    return this;
  }

  _claimComposedControls(controls) {
    const keys = new Map(Object.entries(this.controls));
    const seen = new Set();
    const composed = new Set(getLogicalChildren(this));
    for (const control of controls) {
      this._assertControl(control);
      this._preflightControl(control);
      if (seen.has(control) || composed.has(control)) throw new Error("A Form control may occupy only one composition slot.");
      seen.add(control);
      for (const key of [control.id, control.name]) {
        if (!key) continue;
        if (keys.has(String(key)) && keys.get(String(key)) !== control) throw new Error("Duplicate child control key: " + key + ".");
        keys.set(String(key), control);
      }
    }
    for (const control of controls) {
      this.addControl(control);
      this._registerFormControl(control);
      if (this.destroyed || this._destroying) return false;
    }
    return true;
  }

  _forgetControl(control) {
    super._forgetControl(control);
    this._unregisterFormControl(control);
    for (const row of this._rows) {
      if (row.controls) row.controls = row.controls.filter(item => item !== control);
      for (const column of row.columns ?? []) column.controls = column.controls.filter(item => item !== control);
      const children = row.controls ?? row.columns.flatMap(column => column.controls);
      if (!children.length) row.host?.remove();
    }
    this._rows = this._rows.filter(row => (row.controls ?? row.columns.flatMap(column => column.controls)).length > 0);
  }

  _renderPendingRows() {
    for (const row of [...this._rows]) {
      if (this.destroyed || this._destroying) return;
      if (!row.host) {
        this._renderRow(row);
      }
    }
  }

  _renderRow(row) {
    if (row.direction === "columns") {
      this._renderColumns(row);
      return;
    }

    const host = document.createElement("div");
    host.className = `dui-form__${row.direction}`;
    this.element.appendChild(host);
    row.host = host;

    for (const control of [...row.controls]) {
      if (this.destroyed || this._destroying) return;
      if (control.destroyed || control._destroying || !this.items.includes(control)) continue;
      this._mountControl(control, host);
    }
  }

  _renderColumns(row) {
    const host = document.createElement("div");
    host.className = "dui-form__columns";
    host.style.setProperty("--dui-form-column-count", String(row.columns.length));
    this.element.appendChild(host);
    row.host = host;

    for (const column of row.columns) {
      if (this.destroyed || this._destroying) return;
      const columnHost = document.createElement("div");
      columnHost.className = "dui-form__column";
      host.appendChild(columnHost);
      column.host = columnHost;

      for (const control of [...column.controls]) {
        if (this.destroyed || this._destroying) return;
        if (control.destroyed || control._destroying || !this.items.includes(control)) continue;
        this._mountControl(control, columnHost);
      }
    }
  }

  _mountControl(control, container) {
    this._assertControl(control);

    if (control.command && !control.commands && this.commands && typeof control.bindCommand === "function") {
      control.bindCommand(this.commands, control.command);
    }

    return this.attach(control, { container });
  }

  _normalizeColumn(column) {
    const controls = Array.isArray(column) ? column.flat() : [column];
    return { controls, host: null };
  }

  _applyFormItemClass(control) {
    if (!control.element) {
      return;
    }

    control.element.classList.add("dui-form__item");

    if (this._isFillControl(control)) {
      control.element.classList.add("dui-form__item--fill");
    }
  }

  _isFillControl(control) {
    const element = control.element;

    if (!element) {
      return false;
    }

    return (
      element.classList.contains("dui-text-field") ||
      element.classList.contains("dui-checkbox") ||
      element.classList.contains("dui-radio-group") ||
      element.classList.contains("dui-switch") ||
      element.classList.contains("dui-trackbar") ||
      element.classList.contains("dui-progress-bar") ||
      element.classList.contains("dui-file-picker") ||
      element.classList.contains("dui-readonly-text")
    );
  }

  validate(context = {}) {
    this._assertMutable("validate");

    const errors = [];

    for (const control of this.getFields()) {
      if (this.destroyed || this._destroying) break;
      if (control.destroyed || control._destroying) continue;
      if (typeof control.validate !== "function") {
        continue;
      }

      const result = control.validate({
        ...context,
        form: this
      });

      if (this.destroyed || this._destroying) return { source: this, ok: false, errors, value: {} };
      if (!result?.errors) {
        continue;
      }

      for (const error of result.errors) {
        errors.push({
          control,
          path: control.name ?? control.id,
          ...error
        });
      }
    }

    const result = {
      source: this,
      ok: errors.every(error => error.severity !== "error"),
      errors,
      value: this.getValue()
    };

    this.events.emit("validate", result);

    if (!this.destroyed && !this._destroying && !result.ok) {
      this.events.emit("validationFail", {
        source: this,
        errors,
        value: result.value,
        origin: context.origin ?? "api",
        userAction: context.userAction === true
      });
    }

    return result;
  }

  isValid() {
    return this.validate().ok;
  }

  clearValidation(options = {}) {
    this._assertMutable("clearValidation");

    for (const control of this.getFields()) {
      if (this.destroyed || this._destroying) break;
      if (control.destroyed || control._destroying) continue;
      control.clearValidation?.(options);
      if (this.destroyed || this._destroying) return;
    }

    if (!options.silent) {
      this.events.emit("validationClear", {
        source: this,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }
  }

  getFields() {
    const fields = [];
    collectValueFields(this, fields, new Set());
    return fields;
  }

  forEach(callback) {
    this.getFields().forEach((control, index) => {
      callback(control, control.name ?? control.id, index, this);
    });
    return this;
  }

  getValue() {
    const values = {};

    for (const control of this.getFields()) {
      if (this.destroyed || this._destroying) break;
      if (control.destroyed || control._destroying) continue;
      Object.defineProperty(values, control.name ?? control.id, {
        value: control.value.get(), enumerable: true, writable: true, configurable: true
      });
    }

    return values;
  }

  getValues() {
    return this.getValue();
  }

  setValue(values = {}, options = {}) {
    this._assertMutable("setValue");

    if (!values || typeof values !== "object") {
      throw new TypeError("Form value must be an object.");
    }

    const mutation = normalizeMutationOptions(options);
    const oldValue = this.getValue();
    const beforeEvent = {
      source: this,
      oldValue,
      newValue: { ...oldValue, ...values },
      values,
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) {
      this.events.emit("beforeValueSet", beforeEvent);
    }

    if (beforeEvent.cancel === true || this.destroyed || this._destroying) {
      return false;
    }

    const changes = this._runValueBatch(() => {
      for (const control of this.getFields()) {
      if (this.destroyed || this._destroying) break;
      if (control.destroyed || control._destroying) continue;
        const key = control.name ?? control.id;

        if (!Object.prototype.hasOwnProperty.call(values, key)) {
          continue;
        }

        control.value.set(values[key], mutation);
        if (this.destroyed || this._destroying) break;
      }
    });
    if (this.destroyed || this._destroying) return false;
    const newValue = this.getValue();

    if (!mutation.silent) {
      this.events.emit("valueSet", {
        source: this,
        oldValue,
        newValue,
        values,
        changes,
        origin: mutation.origin,
        userAction: mutation.userAction
      });

      this._emitFormChange(oldValue, newValue, changes, mutation);
    }

    return true;
  }

  setValues(values = {}, options = {}) {
    return this.setValue(values, options);
  }

  clear() {
    this._assertMutable("clear");

    for (const control of [...getLogicalChildren(this)].reverse()) {
      if (this.destroyed || this._destroying) return this;
      if (this.items.includes(control)) {
        this.remove(control);
      } else {
        this._unregisterFormControl(control);
        control.destroy?.();
      }
    }

    for (const row of this._rows) {
      row.host?.remove?.();

      for (const column of row.columns ?? []) {
        column.host = null;
      }

      row.host = null;
    }

    this._rows = [];
    return this;
  }

  clearValues(options = {}) {
    this._assertMutable("clearValues");

    const mutation = normalizeMutationOptions(options);
    const oldValue = this.getValue();
    const beforeEvent = {
      source: this,
      oldValue,
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) {
      this.events.emit("beforeClear", beforeEvent);
    }

    if (beforeEvent.cancel === true || this.destroyed || this._destroying) {
      return false;
    }

    const changes = this._runValueBatch(() => {
      for (const control of this.getFields()) {
      if (this.destroyed || this._destroying) break;
      if (control.destroyed || control._destroying) continue;
        control.value.clear(mutation);
        if (this.destroyed || this._destroying) break;
      }
    });
    if (this.destroyed || this._destroying) return false;

    this.clearValidation({
      silent: true
    });
    this._markFieldsClean(this._initialValue);
    if (this.destroyed || this._destroying) return false;

    const newValue = this.getValue();

    if (!mutation.silent) {
      const event = {
        source: this,
        oldValue,
        newValue,
        changes,
        origin: mutation.origin,
        userAction: mutation.userAction
      };

      this.events.emit("clear", event);
      if (this.destroyed || this._destroying) return true;
      this.events.emit("afterClear", cloneEventForAfter(event));
      this._emitFormChange(oldValue, newValue, changes, mutation);
    }

    return true;
  }

  resetValues(options = {}) {
    return this.reset(options);
  }

  reset(options = {}) {
    this._assertMutable("reset");

    const mutation = normalizeMutationOptions(options);
    const oldValue = this.getValue();
    const beforeEvent = {
      source: this,
      oldValue,
      newValue: { ...this._initialValue },
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) {
      this.events.emit("beforeReset", beforeEvent);
    }

    if (beforeEvent.cancel === true || this.destroyed || this._destroying) {
      return false;
    }

    const changed = this.setValue(this._initialValue, {
      ...mutation,
      silent: true
    });

    if (!changed) {
      return false;
    }

    this.clearValidation({
      silent: true
    });

    const newValue = this.getValue();
    const changes = diffValueObjects(oldValue, newValue, mutation);

    if (!mutation.silent) {
      const event = {
        source: this,
        oldValue,
        newValue,
        changes,
        origin: mutation.origin,
        userAction: mutation.userAction
      };

      this.events.emit("reset", event);
      if (this.destroyed || this._destroying) return true;
      this.events.emit("afterReset", cloneEventForAfter(event));
      this._emitFormChange(oldValue, newValue, changes, mutation);
    }

    return true;
  }

  setInitialValue(value = this.getValue()) {
    return this.setCleanValue(value);
  }

  isDirty() {
    return this.getFields().some(control => control.isDirty?.() === true);
  }

  setCleanValue(value = this.getValue(), options = {}) {
    this._assertMutable("setCleanValue");

    const oldValue = this.isDirty();
    this._initialValue = { ...value };
    this._markFieldsClean(this._initialValue);
    const newValue = this.isDirty();

    if (!options.silent && oldValue !== newValue) {
      this.events.emit("dirtyChange", {
        source: this,
        oldValue,
        newValue,
        value: this.getValue(),
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  submit(options = {}) {
    this._assertMutable("submit");

    const mutation = normalizeMutationOptions(options);
    const value = this.getValue();
    const beforeEvent = {
      source: this,
      value,
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) {
      this.events.emit("beforeSubmit", beforeEvent);
    }

    if (beforeEvent.cancel === true || this.destroyed || this._destroying) {
      return false;
    }

    const validation = this.validate({
      origin: mutation.origin,
      userAction: mutation.userAction
    });

    if (this.destroyed || this._destroying) return false;
    if (!validation.ok) {
      if (options.focusInvalid !== false) {
        this.focusFirstInvalid();
      }

      return false;
    }

    if (!mutation.silent) {
      const event = {
        source: this,
        value: this.getValue(),
        validation,
        origin: mutation.origin,
        userAction: mutation.userAction
      };

      this.events.emit("submit", event);
      if (this.destroyed || this._destroying) return true;
      this.events.emit("afterSubmit", cloneEventForAfter(event));
    }

    return true;
  }

  focusFirstInvalid(options = {}) {
    const invalid = this.getFields().find(control => control.state?.has?.("invalid"));

    if (!invalid) {
      return false;
    }

    return invalid.focus?.({
      preventScroll: options.preventScroll === true,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    }) === true;
  }

  enable() {
    super.enable();

    for (const control of this.items) {
      control.enable?.();
    }

    return this;
  }

  disable() {
    super.disable();

    for (const control of this.items) {
      control.disable?.();
    }

    return this;
  }

  setReadOnly(readOnly, options = {}) {
    this._assertMutable("setReadOnly");

    for (const control of this.getFields()) {
      if (this.destroyed || this._destroying) break;
      if (control.destroyed || control._destroying) continue;
      if (readOnly) {
        control.state?.set?.("readonly", true, {
          origin: options.origin ?? "api",
          userAction: options.userAction === true,
          silent: options.silent === true
        });
      } else {
        control.state?.clear?.("readonly", {
          origin: options.origin ?? "api",
          userAction: options.userAction === true,
          silent: options.silent === true
        });
      }
    }

    if (this.destroyed || this._destroying) return this;
    if (!options.silent) {
      this.events.emit("readOnlyChange", {
        source: this,
        value: readOnly === true,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  isReadOnly() {
    const fields = this.getFields();
    return fields.length > 0 && fields.every(control => control.state?.has?.("readonly"));
  }

  remove(controlOrName, options = {}) {
    const control = typeof controlOrName === "string" ? this.getItem(controlOrName) : controlOrName;
    const removed = super.remove(controlOrName, options);

    if (removed) {
      this._unregisterFormControl(control);
    }

    return removed;
  }

  destroy() {
    super.destroy();
    this._fieldSubscriptions.clear();
    this._batchedChanges = [];
  }

  _registerFormControl(control) {
    if (this._fieldSubscriptions.has(control)) {
      return;
    }

    let subscription = null;

    if (control instanceof Form) {
      subscription = control.events.on("change", event => {
        this._handleNestedFormChange(control, event);
      });
    } else if (isValueControl(control)) {
      subscription = control.events.on("change", event => {
        this._handleFieldChange(control, event);
      });
    }

    if (!subscription) {
      return;
    }

    this._fieldSubscriptions.set(control, subscription);

    const key = control.name ?? control.id;

    if (Object.prototype.hasOwnProperty.call(this._initialValue, key)) {
      this._applyInitialValueToControl(control);
    }
  }

  _applyInitialValueToControl(control) {
    if (!isValueControl(control)) {
      return;
    }

    const key = control.name ?? control.id;

    if (!Object.prototype.hasOwnProperty.call(this._initialValue, key)) {
      return;
    }

    control.value.set(this._initialValue[key], {
      silent: true,
      origin: "import"
    });
    if (!this.destroyed && !this._destroying && !control.destroyed && !control._destroying) control.setCleanValue?.(control.value.get());
  }

  _unregisterFormControl(control) {
    const subscription = this._fieldSubscriptions.get(control);

    if (!subscription) {
      return;
    }

    subscription.dispose();
    this._fieldSubscriptions.delete(control);
  }

  _handleFieldChange(control, event) {
    if (this.destroyed || this._destroying) return;
    const path = control.name ?? control.id;
    const change = {
      control,
      path,
      oldValue: event.oldValue,
      newValue: event.newValue,
      origin: event.origin ?? "api",
      userAction: event.userAction === true
    };

    if (this._batchDepth > 0) {
      this._batchedChanges.push(change);
      return;
    }

    this.events.emit("change", {
      source: this,
      control,
      path,
      oldValue: event.oldValue,
      newValue: event.newValue,
      value: this.getValue(),
      changes: [change],
      origin: change.origin,
      userAction: change.userAction
    });
  }

  _handleNestedFormChange(control, event) {
    if (this.destroyed || this._destroying) return;
    const changes = event.changes ?? [];

    if (this._batchDepth > 0) {
      this._batchedChanges.push(...changes);
      return;
    }

    this.events.emit("change", {
      source: this,
      control,
      path: control.name ?? control.id,
      oldValue: event.oldValue,
      newValue: event.newValue,
      value: this.getValue(),
      changes,
      origin: event.origin ?? "api",
      userAction: event.userAction === true
    });
  }

  _runValueBatch(callback) {
    this._batchDepth += 1;

    try {
      callback();
    } finally {
      this._batchDepth -= 1;
    }

    if (this._batchDepth > 0) {
      return [];
    }

    const changes = this._batchedChanges;
    this._batchedChanges = [];
    return changes;
  }

  _emitFormChange(oldValue, newValue, changes, mutation) {
    if (this.destroyed || this._destroying) return;
    if (changes.length === 0 && shallowEqualObjects(oldValue, newValue)) {
      return;
    }

    this.events.emit("change", {
      source: this,
      oldValue,
      newValue,
      value: newValue,
      changes,
      origin: mutation.origin,
      userAction: mutation.userAction
    });
  }

  _markFieldsClean(values = this.getValue()) {
    for (const control of this.getFields()) {
      if (this.destroyed || this._destroying) break;
      if (control.destroyed || control._destroying) continue;
      const key = control.name ?? control.id;

      if (Object.prototype.hasOwnProperty.call(values, key)) {
        control.setCleanValue?.(values[key]);
      } else {
        control.setCleanValue?.();
      }
    }
  }
}

function normalizeLabelPosition(position) {
  const normalized = String(position).toLowerCase();

  if (normalized !== "left" && normalized !== "top") {
    throw new TypeError('Form labelPosition must be either "left" or "top".');
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

function isValueControl(control) {
  return (
    !(control instanceof Form) &&
    control?.value &&
    typeof control.value.get === "function" &&
    typeof control.value.set === "function" &&
    typeof control.value.clear === "function"
  );
}

function collectValueFields(container, fields, seen) {
  for (const control of getLogicalChildren(container)) {
    if (!control || seen.has(control)) {
      continue;
    }

    seen.add(control);

    if (isValueControl(control)) {
      fields.push(control);
      continue;
    }

    if (control instanceof Form) {
      collectValueFields(control, fields, seen);
      continue;
    }

    if (Array.isArray(control?.items)) {
      collectValueFields(control, fields, seen);
    }
  }
}

function getLogicalChildren(container) {
  const result = [];

  for (const row of container._rows ?? []) {
    if (Array.isArray(row.controls)) {
      result.push(...row.controls);
    }

    if (Array.isArray(row.columns)) {
      for (const column of row.columns) {
        result.push(...(column.controls ?? []));
      }
    }
  }

  for (const control of container.items ?? []) {
    if (!result.includes(control)) {
      result.push(control);
    }
  }

  return result;
}

function shallowEqualObjects(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(key => Object.is(left[key], right[key]));
}

function diffValueObjects(oldValue, newValue, mutation = {}) {
  const changes = [];
  const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);

  for (const key of keys) {
    if (Object.is(oldValue[key], newValue[key])) {
      continue;
    }

    changes.push({
      path: key,
      oldValue: oldValue[key],
      newValue: newValue[key],
      origin: mutation.origin ?? "api",
      userAction: mutation.userAction === true
    });
  }

  return changes;
}

function cloneEventForAfter(event) {
  const clone = { ...event };
  delete clone.type;
  return clone;
}
