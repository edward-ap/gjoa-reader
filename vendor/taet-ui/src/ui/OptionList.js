import { List } from "./List.js";
import { DataStore } from "../core/DataStore.js";

export class OptionList extends List {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const multiSelect = options.multiSelect === true || options.multiple === true;

    super({
      ...options,
      multiSelect,
      renderItem: options.renderItem ?? renderOptionItem
    });

    this.emptyValue = multiSelect ? [] : null;
    this._hasPendingValue = Object.prototype.hasOwnProperty.call(options, "value");
    this._pendingValue = options.value;

    this.value = Object.freeze({
      get: () => this._getValue(),
      set: (value, options) => this._setValue(value, options),
      clear: options => this._setValue(this.emptyValue, options)
    });

    this.disposables.add(
      this.selection.events.on("change", event => {
        if (this.destroyed) return;
        const oldValue = this._itemsToValue(event.oldItems);
        const newValue = this._itemsToValue(event.items);
        this.events.emit("change", {
          source: this,
          oldValue,
          newValue,
          oldItems: event.oldItems,
          items: event.items,
          origin: event.origin,
          userAction: event.userAction
        });

        if (this.destroyed) return;
        this.events.emit("afterChange", {
          source: this,
          oldValue,
          newValue,
          oldItems: event.oldItems,
          items: event.items,
          origin: event.origin,
          userAction: event.userAction
        });
      })
    );

    this.disposables.add(
      this.data.events.on(this.data instanceof DataStore ? "invalidate" : "change", () => {
        if (!this.destroyed && this._hasPendingValue) {
          this._applyPendingValue();
        }
      })
    );

    if (this._hasPendingValue) {
      this._applyPendingValue();
    }

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = super.createElement();
    root.classList.add("dui-option-list");
    return root;
  }

  _selectItemFromUser(item) {
    if (this.disabled) {
      return false;
    }

    this._activeId = this.data.idOf(item);

    if (!this.multiSelect) {
      return this.selection.set([item], {
        origin: "user",
        userAction: true
      });
    }

    const current = this.selection.get();
    const exists = current.includes(item);
    const next = exists ? current.filter(selected => selected !== item) : [...current, item];

    return this.selection.set(next, {
      origin: "user",
      userAction: true
    });
  }

  _selectActiveItem(items) {
    const index = this._getActiveIndex(items);
    const item = items[index];

    if (item) {
      this._selectItemFromUser(item);
    }
  }

  _getValue() {
    return this._itemsToValue(this.selection.get());
  }

  _setValue(value, options = {}) {
    this._assertMutable("value.set");

    const ids = this._normalizeValueIds(value);
    const items = ids.map(id => this.data.get(id)).filter(Boolean);
    const hasMissingItems = items.length !== ids.length;

    if (hasMissingItems && options.keepPending !== false) {
      this._hasPendingValue = true;
      this._pendingValue = Array.isArray(value) ? [...value] : value;
    } else {
      this._hasPendingValue = false;
      this._pendingValue = undefined;
    }

    const changed = this.selection.set(items, options);

    if (!this.destroyed && options.silent) {
      this._syncSelectionState();
    }

    return changed;
  }

  _applyPendingValue() {
    if (!this._hasPendingValue) {
      return;
    }

    this._setValue(this._pendingValue, {
      silent: true,
      origin: "system",
      keepPending: true
    });
  }

  _itemsToValue(items) {
    const ids = items.map(item => this.data.idOf(item));
    return this.multiSelect ? ids : ids[0] ?? null;
  }

  _normalizeValueIds(value) {
    if (this.multiSelect) {
      if (value == null) {
        return [];
      }

      if (!Array.isArray(value)) {
        throw new TypeError("OptionList multi value must be an array.");
      }

      return value;
    }

    if (value == null) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.slice(-1);
    }

    return [value];
  }

  _getOptionText(item) {
    if (typeof this.textField === "function") {
      return String(this.textField(item));
    }

    return String(item[this.textField] ?? item.id ?? "");
  }
}

function renderOptionItem(item, context) {
  const content = document.createElement("span");
  content.className = "dui-option-list__content";

  const mark = document.createElement("span");
  mark.className = "dui-option-list__mark";
  mark.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "dui-option-list__text";
  text.textContent = context.source._getOptionText(item);

  content.append(mark);
  const icon = context.source._createItemIcon(item);
  if (icon) {
    content.classList.add("dui-option-list__content--has-icon");
    content.append(icon);
  }
  content.append(text);
  return content;
}
