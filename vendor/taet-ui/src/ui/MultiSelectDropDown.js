import { normalizeMutationOptions } from "../core/mutationOptions.js";
import { DropDownList } from "./DropDownList.js";
import { renderIcon } from "./Icon.js";

export class MultiSelectDropDown extends DropDownList {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({
      ...options,
      emptyValue: [],
      value: normalizeIds(options.value)
    });

    this.closeOnSelect = options.closeOnSelect === true;

    if (hasContainer) this.mount(containerOrOptions);
  }

  createElement() {
    const root = super.createElement();
    root.classList.add("dui-multi-select-dropdown");
    this._listElement?.setAttribute("aria-multiselectable", "true");
    return root;
  }

  getSelectedItem() {
    return this.getSelectedItems()[0] ?? null;
  }

  getSelectedItems() {
    return this._value.map(id => this.data.get(id)).filter(Boolean);
  }

  isDirty() {
    return !sameIds(this._value, this._cleanValue);
  }

  _getValue() {
    return [...(this._value ?? [])];
  }

  _setValue(nextValue, options = {}) {
    this._assertMutable("value.set");
    const mutation = normalizeMutationOptions(options);
    const oldValue = [...this._value];
    const newValue = normalizeIds(nextValue);

    if ((this.disabled || this.isReadOnly()) && mutation.userAction) {
      this._syncInput(oldValue);
      return false;
    }

    if (sameIds(oldValue, newValue)) {
      this._syncInput(oldValue);
      return false;
    }

    const oldItems = oldValue.map(id => this.data.get(id)).filter(Boolean);
    const newItems = newValue.map(id => this.data.get(id)).filter(Boolean);
    const wasDirty = this.isDirty();
    const beforeEvent = {
      source: this,
      oldValue,
      newValue: [...newValue],
      oldItems,
      newItems,
      origin: mutation.origin,
      userAction: mutation.userAction,
      cancel: false
    };

    if (!mutation.silent) this.events.emit("beforeChange", beforeEvent);
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
      const event = {
        source: this,
        oldValue,
        newValue: [...newValue],
        oldItems,
        newItems,
        origin: mutation.origin,
        userAction: mutation.userAction
      };
      this.events.emit("change", event);
      if (this.destroyed) return true;
      this.events.emit("afterChange", { ...event });
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

  _renderDisplay() {
    if (!this._displayTextElement || !this._displayImageElement) return;
    this._displayImageElement.replaceChildren();
    this._displayImageElement.hidden = true;
    this._displayTextElement.replaceChildren();
    this._displayTextElement.classList.toggle("dui-placeholder", this._value.length === 0);

    if (this._value.length === 0) {
      this._displayTextElement.textContent = this.placeholder;
      return;
    }

    for (const id of this._value) {
      const item = this.data.get(id);
      if (!item) continue;
      const token = document.createElement("span");
      token.className = "dui-multi-select-dropdown__token";

      const text = document.createElement("span");
      text.className = "dui-multi-select-dropdown__token-text";
      text.textContent = this._getItemText(item);

      const remove = document.createElement("button");
      remove.className = "dui-multi-select-dropdown__token-remove";
      remove.type = "button";
      remove.dataset.duiMultiSelectRemove = `${typeof id}:${String(id)}`;
      remove.title = `Remove ${text.textContent}`;
      remove.setAttribute("aria-label", remove.title);
      remove.disabled = this.disabled || this.isReadOnly();
      renderIcon(remove, "window.close");

      token.append(text, remove);
      this._displayTextElement.append(token);
    }
  }

  _handleDisplayClick(event) {
    const remove = event.target.closest?.("[data-dui-multi-select-remove]");
    if (!remove) {
      super._handleDisplayClick(event);
      return;
    }

    event.stopPropagation();
    const id = this._value.find(value => `${typeof value}:${String(value)}` === remove.dataset.duiMultiSelectRemove);
    if (id !== undefined) this.removeValue(id, { origin: "user", userAction: true });
  }

  _handleKeyDown(event) {
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      event.target === this._displayElement &&
      this._value.length > 0 &&
      !this.disabled &&
      !this.isReadOnly()
    ) {
      event.preventDefault();
      this.removeValue(this._value[this._value.length - 1], { origin: "user", userAction: true });
      return;
    }

    super._handleKeyDown(event);
  }

  _selectItemFromUser(item) {
    const id = this.data.idOf(item);
    const next = this._isSelectedId(id)
      ? this._value.filter(value => !Object.is(value, id))
      : [...this._value, id];
    this._activeId = id;
    this._setValue(next, { origin: "user", userAction: true });
    if (this.destroyed) return;

    if (this.closeOnSelect) {
      this.closePopup();
      this._displayElement?.focus();
    }
  }

  _isSelectedId(id) {
    return this._value.some(value => Object.is(value, id));
  }

  _reconcileValueWithData() {
    const next = this._value.filter(id => this.data.get(id));
    if (!sameIds(next, this._value)) this._setValue(next, { silent: true, origin: "system" });
  }

  addValue(id, options = {}) {
    this._assertMutable("addValue");
    if (this._isSelectedId(id)) return false;
    return this._setValue([...this._value, id], options);
  }

  removeValue(id, options = {}) {
    this._assertMutable("removeValue");
    if (!this._isSelectedId(id)) return false;
    return this._setValue(this._value.filter(value => !Object.is(value, id)), options);
  }
}

function normalizeIds(value) {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) throw new TypeError("MultiSelectDropDown value must be an array.");
  return value.filter((id, index, ids) => ids.findIndex(other => Object.is(other, id)) === index);
}

function sameIds(left = [], right = []) {
  return left.length === right.length && left.every((id, index) => Object.is(id, right[index]));
}
