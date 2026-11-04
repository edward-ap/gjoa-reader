import { EditorControl } from "./EditorControl.js";
import { renderIcon } from "./Icon.js";

const groups = new Map();

export class CheckButton extends EditorControl {
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

    this.text = options.text ?? options.caption ?? "";
    this.checkedText = options.checkedText ?? null;
    this.uncheckedText = options.uncheckedText ?? null;
    this.icon = options.icon ?? "";
    this.checkedIcon = options.checkedIcon ?? null;
    this.uncheckedIcon = options.uncheckedIcon ?? null;
    this.checkedIconColor = options.checkedIconColor ?? null;
    this.uncheckedIconColor = options.uncheckedIconColor ?? null;
    this.groupName = options.groupName ?? options.group ?? null;
    this.groupIndex = normalizeGroupIndex(options.groupIndex);
    this.allowAllUnchecked =
      options.allowAllUnchecked === true || (this._getGroupKey() == null && options.allowAllUnchecked !== false);
    this._labelElement = null;
    this._textElement = null;
    this._iconElement = null;
    this._measureElement = null;
    this._button = null;

    registerGroupMember(this);

    if (this._value === true) {
      this._uncheckGroupPeers({
        silent: true,
        origin: "system",
        reason: "init"
      });
    }

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-check-button", this.css].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-check-button__label";
    label.id = `${this.id}-label`;
    label.textContent = this.label;

    const content = document.createElement("span");
    content.className = "dui-check-button__content";

    const button = document.createElement("button");
    button.className = "dui-button dui-check-button__button";
    button.type = "button";
    button.dataset.duiFocusTarget = "true";

    const visible = document.createElement("span");
    visible.className = "dui-check-button__visible";

    const icon = document.createElement("span");
    icon.className = "dui-check-button__icon";
    icon.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "dui-check-button__text";
    text.id = `${this.id}-text`;

    const measure = document.createElement("span");
    measure.className = "dui-check-button__measure";
    measure.setAttribute("aria-hidden", "true");

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    visible.append(icon, text);
    button.append(visible, measure);
    button.setAttribute("aria-labelledby", `${label.id} ${text.id}`);
    content.append(button);
    root.append(label, content, message);

    this._labelElement = label;
    this._textElement = text;
    this._iconElement = icon;
    this._measureElement = measure;
    this._button = button;
    this._input = button;
    this._message = message;
    this._syncInput(this._value);
    this._syncStateToInput();

    this.disposables.addEventListener(button, "click", () => {
      if (this.disabled || this.isReadOnly()) {
        return;
      }

      if (this._value && this._getGroupKey() != null && !this.allowAllUnchecked) {
        return;
      }

      this._setValue(!this._value, {
        origin: "user",
        userAction: true
      });
    });

    return root;
  }

  destroy() {
    unregisterGroupMember(this);
    super.destroy();
    this._labelElement = null;
    this._textElement = null;
    this._iconElement = null;
    this._measureElement = null;
    this._button = null;
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

  isChecked() {
    return this._value === true;
  }

  setChecked(checked, options = {}) {
    return this._setValue(checked, options);
  }

  toggle(options = {}) {
    return this._setValue(!this._value, options);
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

  setIcon(icon, options = {}) {
    this._assertMutable("setIcon");

    const oldValue = this.icon;
    this.icon = icon ?? "";
    this._renderIcon();
    this._renderMeasure();

    if (!options.silent && oldValue !== this.icon) {
      this.events.emit("iconChange", {
        source: this,
        oldValue,
        newValue: this.icon,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  _setValue(nextValue, options = {}) {
    const changed = super._setValue(nextValue, options);

    if (changed && this._value === true) {
      this._uncheckGroupPeers(options);
    }

    return changed;
  }

  _normalizeValue(value) {
    return value === true;
  }

  _syncInput(value) {
    if (!this._button) {
      return;
    }

    const checked = value === true;
    this._button.setAttribute("aria-pressed", checked ? "true" : "false");
    this._button.classList.toggle("dui-check-button__button--checked", checked);
    this._renderText();
    this._renderIcon();
    this._renderMeasure();
  }

  _syncStateToInput() {
    if (!this._button) {
      return;
    }

    this._button.disabled = this.disabled || this.isReadOnly();

    if (this.isReadOnly()) {
      this._button.setAttribute("aria-readonly", "true");
    } else {
      this._button.removeAttribute("aria-readonly");
    }
  }

  _renderLabel() {
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }
  }

  _renderText() {
    if (!this._textElement) {
      return;
    }

    this._textElement.textContent =
      this._value && this.checkedText != null
        ? this.checkedText
        : !this._value && this.uncheckedText != null
          ? this.uncheckedText
          : this.text;
  }

  _renderIcon() {
    if (!this._iconElement) {
      return;
    }

    const icon =
      this._value && this.checkedIcon != null
        ? this.checkedIcon
        : !this._value && this.uncheckedIcon != null
          ? this.uncheckedIcon
          : this.icon;

    renderIcon(this._iconElement, icon);
    this._iconElement.style.color = getIconColor(this, this._value) ?? "";
  }

  _renderMeasure() {
    if (!this._measureElement) {
      return;
    }

    this._measureElement.replaceChildren(
      createMeasureState(getDisplayIcon(this, false), getDisplayText(this, false)),
      createMeasureState(getDisplayIcon(this, true), getDisplayText(this, true))
    );
  }

  _getGroupKey() {
    if (this.groupName != null && this.groupName !== "") {
      return `name:${this.groupName}`;
    }

    if (this.groupIndex > 0) {
      return `index:${this.groupIndex}`;
    }

    return null;
  }

  _uncheckGroupPeers(options = {}) {
    const groupKey = this._getGroupKey();

    if (!groupKey) {
      return;
    }

    const members = groups.get(groupKey);

    if (!members) {
      return;
    }

    for (const member of members) {
      if (member !== this && member._value === true && !member.destroyed) {
        member._setValue(false, {
          ...options,
          origin: options.origin ?? "system",
          reason: options.reason ?? "group-uncheck"
        });
      }
    }
  }
}

function getDisplayText(control, checked) {
  if (checked && control.checkedText != null) {
    return control.checkedText;
  }

  if (!checked && control.uncheckedText != null) {
    return control.uncheckedText;
  }

  return control.text;
}

function getDisplayIcon(control, checked) {
  if (checked && control.checkedIcon != null) {
    return control.checkedIcon;
  }

  if (!checked && control.uncheckedIcon != null) {
    return control.uncheckedIcon;
  }

  return control.icon;
}

function getIconColor(control, checked) {
  if (checked && control.checkedIconColor != null) {
    return control.checkedIconColor;
  }

  if (!checked && control.uncheckedIconColor != null) {
    return control.uncheckedIconColor;
  }

  return null;
}

function createMeasureState(icon, text) {
  const state = document.createElement("span");
  state.className = "dui-check-button__measure-state";

  const iconElement = document.createElement("span");
  iconElement.className = "dui-check-button__icon";
  renderIcon(iconElement, icon);

  const textElement = document.createElement("span");
  textElement.className = "dui-check-button__text";
  textElement.textContent = text;

  state.append(iconElement, textElement);
  return state;
}

function normalizeGroupIndex(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function registerGroupMember(control) {
  const groupKey = control._getGroupKey();

  if (!groupKey) {
    return;
  }

  if (!groups.has(groupKey)) {
    groups.set(groupKey, new Set());
  }

  groups.get(groupKey).add(control);
}

function unregisterGroupMember(control) {
  const groupKey = control._getGroupKey();

  if (!groupKey) {
    return;
  }

  const members = groups.get(groupKey);

  if (!members) {
    return;
  }

  members.delete(control);

  if (members.size === 0) {
    groups.delete(groupKey);
  }
}
