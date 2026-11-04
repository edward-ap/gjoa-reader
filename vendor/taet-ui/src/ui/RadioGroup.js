import { EditorControl } from "./EditorControl.js";

export class RadioGroup extends EditorControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({
      ...options,
      tabIndex: options.tabIndex ?? 0,
      emptyValue: Object.prototype.hasOwnProperty.call(options, "emptyValue")
        ? options.emptyValue
        : null
    });

    this.layout = normalizeLayout(options.layout ?? options.itemsLayout ?? "column");
    this.columns = normalizeColumns(options.columns);
    this.textField = options.textField ?? "text";
    this.descriptionField = options.descriptionField ?? "description";
    this.valueField = options.valueField ?? "value";
    this.disabledField = options.disabledField ?? "disabled";
    this.markerField = options.markerField ?? "marker";
    this.markerStyle = normalizeMarkerStyle(options.markerStyle);
    this.items = normalizeItems(options.items ?? options.options ?? [], this);
    this._labelElement = null;
    this._contentElement = null;
    this._itemElements = new Map();
    this._inputElements = new Map();

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = [
      "dui-control",
      "dui-radio-group",
      `dui-radio-group--${this.layout}`,
      this.markerStyle === "letter" ? "dui-radio-group--letter" : "",
      this.css
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    if (this.columns != null) {
      root.style.setProperty("--dui-radio-columns", String(this.columns));
    }

    const label = document.createElement("span");
    label.className = "dui-radio-group__label";
    label.textContent = this.label;

    const content = document.createElement("div");
    content.className = "dui-radio-group__content";
    content.dataset.duiFocusTarget = "true";
    content.tabIndex = this.tabIndex ?? 0;
    content.setAttribute("role", "radiogroup");

    if (this.label) {
      content.setAttribute("aria-label", this.label);
    }

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    root.append(label, content, message);

    this._labelElement = label;
    this._contentElement = content;
    this._input = content;
    this._message = message;

    this._renderItems();
    this._syncInput(this._value);
    this._syncStateToInput();

    this.disposables.addEventListener(content, "keydown", event => {
      this._handleKeyDown(event);
    });

    this.disposables.addEventListener(content, "change", event => {
      const input = event.target.closest?.(".dui-radio-group__input");

      if (!input?.checked) {
        return;
      }

      const item = this._findItemByKey(input.value);

      if (item) {
        this._setValue(item.value, {
          origin: "user",
          userAction: true
        });
      }
    });

    this.disposables.addEventListener(content, "click", event => {
      const itemElement = event.target.closest?.(".dui-radio-group__item");

      if (!itemElement || !content.contains(itemElement)) {
        return;
      }

      const item = this._findItemByKey(itemElement.dataset.duiRadioValue);

      if (this.disabled || this.isReadOnly() || item?.disabled) {
        event.preventDefault();
        return;
      }

      content.focus();

      if (item) {
        this._setValue(item.value, {
          origin: "user",
          userAction: true
        });
      }
    });

    return root;
  }

  destroy() {
    super.destroy();
    this._labelElement = null;
    this._contentElement = null;
    this._itemElements = new Map();
    this._inputElements = new Map();
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

  setItems(items = [], options = {}) {
    this._assertMutable("setItems");

    const oldItems = this.items;
    this.items = normalizeItems(items, this);
    this._renderItems();

    if (this._value != null && !this._findItemByValue(this._value)) {
      this._setValue(this._emptyValue, {
        silent: options.silent === true,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    } else {
      this._syncInput(this._value);
    }

    if (!this.destroyed && !options.silent) {
      this.events.emit("itemsChange", {
        source: this,
        oldValue: oldItems,
        newValue: [...this.items],
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  getItems() {
    return this.items.map(item => ({ ...item }));
  }

  getLayout() {
    return this.layout;
  }

  setLayout(layout, options = {}) {
    this._assertMutable("setLayout");
    const oldValue = this.layout;
    this.layout = normalizeLayout(layout);
    this._renderAppearance();
    this._emitAppearanceChange("layout", oldValue, this.layout, options);
    return this;
  }

  getColumns() {
    return this.columns;
  }

  setColumns(columns, options = {}) {
    this._assertMutable("setColumns");
    const oldValue = this.columns;
    this.columns = normalizeColumns(columns);
    this._renderAppearance();
    this._emitAppearanceChange("columns", oldValue, this.columns, options);
    return this;
  }

  getSelectedItem() {
    const item = this._findItemByValue(this._value);
    return item ? { ...item } : null;
  }

  getSelectedIndex() {
    return this.items.findIndex(item => Object.is(item.value, this._value));
  }

  setSelectedIndex(index, options = {}) {
    this._assertMutable("setSelectedIndex");

    const normalizedIndex = Number(index);

    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= this.items.length) {
      return this._setValue(this._emptyValue, options);
    }

    const item = this.items[normalizedIndex];

    if (item?.disabled) {
      return false;
    }

    return this._setValue(item.value, options);
  }

  _normalizeValue(value) {
    return value === undefined ? null : value;
  }

  _syncInput(value) {
    const valueKey = toValueKey(value);

    for (const [itemKey, input] of this._inputElements) {
      const selected = itemKey === valueKey;
      input.checked = selected;
      input.setAttribute("aria-checked", selected ? "true" : "false");
    }

    for (const [itemKey, element] of this._itemElements) {
      element.classList.toggle("dui-radio-group__item--selected", itemKey === valueKey);
    }
  }

  _syncStateToInput() {
    if (!this._contentElement) {
      return;
    }

    const unavailable = this.disabled || this.isReadOnly();
    this._contentElement.setAttribute("aria-disabled", unavailable ? "true" : "false");

    if (this.isReadOnly()) {
      this._contentElement.setAttribute("aria-readonly", "true");
    } else {
      this._contentElement.removeAttribute("aria-readonly");
    }

    for (const item of this.items) {
      const input = this._inputElements.get(item.key);

      if (input) {
        input.disabled = unavailable || item.disabled;
      }
    }
  }

  _renderLabel() {
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }

    if (this._contentElement) {
      if (this.label) {
        this._contentElement.setAttribute("aria-label", this.label);
      } else {
        this._contentElement.removeAttribute("aria-label");
      }
    }
  }

  _renderItems() {
    if (!this._contentElement) {
      return;
    }

    this._contentElement.replaceChildren();
    this._itemElements = new Map();
    this._inputElements = new Map();

    for (const item of this.items) {
      const row = document.createElement("label");
      row.className = "dui-radio-group__item";
      row.dataset.duiRadioValue = item.key;

      if (item.disabled) {
        row.classList.add("dui-radio-group__item--disabled");
      }

      const input = document.createElement("input");
      input.className = "dui-radio-group__input";
      input.type = "radio";
      input.name = `${this.id}-radio`;
      input.value = item.key;
      input.tabIndex = -1;
      input.disabled = this.disabled || this.isReadOnly() || item.disabled;

      const visual = document.createElement("span");
      visual.className = "dui-radio-group__visual";
      visual.setAttribute("aria-hidden", "true");
      if (this.markerStyle === "letter") {
        visual.classList.add("dui-radio-letter__marker");
        visual.textContent = item.marker;
        input.setAttribute("aria-label", [item.marker, item.text].filter(Boolean).join(". "));
      }

      const text = document.createElement("span");
      text.className = "dui-radio-group__text";
      text.textContent = item.text;

      row.append(input, visual, text);
      this._contentElement.append(row);
      this._itemElements.set(item.key, row);
      this._inputElements.set(item.key, input);

    }

    this._syncInput(this._value);
    this._syncStateToInput();
  }

  _renderAppearance() {
    if (!this.element) {
      return;
    }

    this.element.classList.toggle("dui-radio-group--column", this.layout === "column");
    this.element.classList.toggle("dui-radio-group--flow", this.layout === "flow");

    if (this.columns == null) {
      this.element.style.removeProperty("--dui-radio-columns");
    } else {
      this.element.style.setProperty("--dui-radio-columns", String(this.columns));
    }
  }

  _emitAppearanceChange(name, oldValue, value, options = {}) {
    if (options.silent || oldValue === value) {
      return;
    }

    this.events.emit("appearanceChange", {
      source: this,
      name,
      oldValue,
      value,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
  }

  _handleKeyDown(event) {
    if (this.disabled || this.isReadOnly()) {
      return;
    }

    const keyActions = {
      ArrowDown: () => this._moveSelection(1),
      ArrowRight: () => this._moveSelection(1),
      ArrowUp: () => this._moveSelection(-1),
      ArrowLeft: () => this._moveSelection(-1),
      Home: () => this._selectBoundary("first"),
      PageUp: () => this._selectBoundary("first"),
      End: () => this._selectBoundary("last"),
      PageDown: () => this._selectBoundary("last")
    };

    const action = keyActions[event.key];

    if (!action) {
      return;
    }

    event.preventDefault();
    action();
  }

  _moveSelection(delta) {
    const enabledItems = this.items.filter(item => !item.disabled);

    if (enabledItems.length === 0) {
      return false;
    }

    const currentIndex = enabledItems.findIndex(item => Object.is(item.value, this._value));
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : enabledItems.length - 1
        : (currentIndex + delta + enabledItems.length) % enabledItems.length;

    return this._setValue(enabledItems[nextIndex].value, {
      origin: "user",
      userAction: true
    });
  }

  _selectBoundary(edge) {
    const item =
      edge === "last"
        ? [...this.items].reverse().find(candidate => !candidate.disabled)
        : this.items.find(candidate => !candidate.disabled);

    if (!item) {
      return false;
    }

    return this._setValue(item.value, {
      origin: "user",
      userAction: true
    });
  }

  _findItemByValue(value) {
    return this.items.find(item => Object.is(item.value, value)) ?? null;
  }

  _findItemByKey(key) {
    return this.items.find(item => item.key === key) ?? null;
  }
}

function normalizeItems(items, control) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item, index) => normalizeItem(item, index, control));
}

function normalizeItem(item, index, control) {
  if (item == null || typeof item !== "object") {
    const value = item;
    return {
      key: toValueKey(value),
      value,
      text: String(value ?? ""),
      marker: String(value ?? ""),
      disabled: false,
      raw: item
    };
  }

  const value = Object.prototype.hasOwnProperty.call(item, control.valueField)
    ? item[control.valueField]
    : Object.prototype.hasOwnProperty.call(item, "id")
      ? item.id
      : index;

  const text = Object.prototype.hasOwnProperty.call(item, control.textField)
    ? item[control.textField]
    : Object.prototype.hasOwnProperty.call(item, control.descriptionField)
      ? item[control.descriptionField]
      : Object.prototype.hasOwnProperty.call(item, "label")
        ? item.label
        : String(value ?? "");

  return {
    ...item,
    key: toValueKey(value),
    value,
    text: String(text ?? ""),
    marker: String(item[control.markerField] ?? item.label ?? value ?? ""),
    disabled: item[control.disabledField] === true,
    raw: item
  };
}

function toValueKey(value) {
  return `${typeof value}:${String(value)}`;
}

function normalizeLayout(layout) {
  if (layout == null || layout === "column") {
    return "column";
  }

  if (layout === "flow") {
    return "flow";
  }

  throw new TypeError("RadioGroup layout must be column or flow.");
}

function normalizeColumns(columns) {
  if (columns == null) {
    return null;
  }

  const normalized = Number(columns);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new TypeError("RadioGroup columns must be a positive integer or null.");
  }

  return normalized;
}

function normalizeMarkerStyle(style) {
  if (style == null || style === "default") return "default";
  if (style === "letter") return "letter";
  throw new TypeError("RadioGroup markerStyle must be default or letter.");
}
