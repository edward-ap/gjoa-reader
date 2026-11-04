import { DataStore } from "../core/DataStore.js";
import { overlayScale } from "./overlayGeometry.js";
import { overlayManager } from "../core/OverlayManager.js";
import { normalizeMutationOptions } from "../core/mutationOptions.js";
import { TextField } from "./TextField.js";
import { createIcon } from "./Icon.js";

export class SelectInput extends TextField {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    const emptyValue = options.emptyValue === undefined ? "" : options.emptyValue;
    super({
      ...options,
      tabIndex: options.tabIndex ?? 0,
      emptyValue
    });

    this._customPopup = this._alwaysUsePopup || options.imageField != null || options.iconField != null ||
      options.searchable === true || options.search === true || options.filter === true;
    this._select = null;
    this._optionKeysById = new Map();
    this._idsByOptionKey = new Map();
    this._emptyValue = emptyValue;
    this.textField = options.textField ?? "text";
    this.valueField = options.valueField ?? options.idField ?? "id";
    this.descriptionField = options.descriptionField ?? options.detailsField ?? "description";
    this.imageField = options.imageField ?? "image";
    this.iconField = options.iconField ?? "icon";
    this.placeholder = options.placeholder ?? options.emptyText ?? "";
    this.searchable = options.searchable === true || options.search === true || options.filter === true;
    this.searchPlaceholder = options.searchPlaceholder ?? "Search";
    this.filterMode = options.filterMode ?? "contains";
    this.filterPredicate = typeof options.filterPredicate === "function" ? options.filterPredicate : null;
    this.itemHeight = options.itemHeight ?? null;
    this.popupWidth = options.popupWidth ?? null;
    this.popupHeight = options.popupHeight ?? 180;
    this.renderItem = options.renderItem ?? null;
    this.clearValueOnMissingData = options.clearValueOnMissingData === true;
    this.overlayManager = options.overlayManager ?? overlayManager;
    this._value = options.value ?? this._emptyValue;
    this._cleanValue = this._cloneValue(this._getValue());
    this._labelElement = null;
    this._group = null;
    this._displayElement = null;
    this._displayImageElement = null;
    this._displayTextElement = null;
    this._buttonElement = null;
    this._popupElement = null;
    this._searchElement = null;
    this._listElement = null;
    this._activeId = null;
    this._query = "";
    this._itemKeysById = new Map();
    this._idsByItemKey = new Map();
    this._ownsData = !options.data;
    this.data =
      options.data ??
      new DataStore({
        idField: this.valueField,
        getId: options.getId
      });

    assertDataStore(this.data);

    this.disposables.add(
      this.data.events.on("invalidate", () => {
        if (this.clearValueOnMissingData) this._reconcileValueWithData();
        this._renderOptions();
        this._renderDisplay();
        this._renderItems();
      })
    );
    this.disposables.add(
      this.data.events.on("change", event => {
        this.events.emit("dataChange", { source: this, dataEvent: event,
          origin: event.origin, userAction: event.userAction });
      })
    );

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  get _alwaysUsePopup() {
    return false;
  }

  _applyTabIndexState() {
    super._applyTabIndexState();
    if (this._customPopup) this._syncStateToInput();
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

  createElement() {
    if (!this._customPopup) return this._createNativeElement();
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-text-field", "dui-select-input", "dui-dropdown-list", this.css]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-text-field__label";
    label.textContent = this.label;

    const group = document.createElement("span");
    group.className = "dui-dropdown-list__group";

    const display = document.createElement("div");
    display.className = "dui-dropdown-list__display";
    display.tabIndex = 0;
    display.setAttribute("role", "combobox");
    display.dataset.duiFocusTarget = "true";
    display.setAttribute("aria-haspopup", "listbox");
    display.setAttribute("aria-expanded", "false");

    const image = document.createElement("span");
    image.className = "dui-dropdown-list__display-image";

    const textWrap = document.createElement("span");
    textWrap.className = "dui-dropdown-list__display-text-wrap";

    const text = document.createElement("span");
    text.className = "dui-dropdown-list__display-text";

    const button = document.createElement("button");
    button.className = "dui-dropdown-list__button";
    button.type = "button";
    button.setAttribute("aria-label", "Open list");

    const popup = document.createElement("div");
    popup.className = "dui-dropdown-list__popup";
    popup.hidden = true;

    if (this.popupWidth != null) {
      popup.style.width = normalizeCssSize(this.popupWidth);
    }

    popup.style.maxHeight = normalizeCssSize(this.popupHeight);

    const search = document.createElement("input");
    search.className = "dui-dropdown-list__search";
    search.type = "text";
    search.placeholder = this.searchPlaceholder;
    search.hidden = !this.searchable;

    const list = document.createElement("div");
    list.className = "dui-dropdown-list__items";
    list.setAttribute("role", "listbox");

    if (this.itemHeight != null) {
      list.style.setProperty("--dui-dropdown-list-item-height", normalizeCssSize(this.itemHeight));
    }

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    textWrap.append(text);
    display.append(image, textWrap);
    popup.append(search, list);
    group.append(display, button);
    root.append(label, group, message);

    this._labelElement = label;
    this._group = group;
    this._displayElement = display;
    this._displayImageElement = image;
    this._displayTextElement = text;
    this._buttonElement = button;
    this._popupElement = popup;
    this._searchElement = search;
    this._listElement = list;
    this._input = display;
    this._message = message;
    display.setAttribute("aria-label", this.label || this.name || this.id);
    list.id = `${this.id}-options`;
    display.setAttribute("aria-controls", list.id);

    this._syncStateToInput();
    this._renderDisplay();
    this._renderItems();

    if (this.destroyed) return root;

    this.disposables.addEventListener(display, "click", event => {
      event.preventDefault();
      this._handleDisplayClick(event);
    });

    this.disposables.addEventListener(button, "click", event => {
      event.preventDefault();
      this.togglePopup();
    });

    this.disposables.addEventListener(display, "keydown", event => {
      this._handleKeyDown(event);
    });

    this.disposables.addEventListener(search, "input", () => {
      this.setFilter(search.value, {
        origin: "user",
        userAction: true
      });
    });

    this.disposables.addEventListener(search, "keydown", event => {
      this._handleKeyDown(event);
    });

    this.disposables.addEventListener(list, "click", event => {
      const itemElement = event.target.closest?.(".dui-dropdown-list__item");

      if (!itemElement || !list.contains(itemElement)) {
        return;
      }

      const item = this._getItemFromElement(itemElement);

      if (!item) {
        return;
      }

      this._selectItemFromUser(item);
    });

    this.disposables.addEventListener(window, "resize", () => this._positionPopup());
    this.disposables.addEventListener(document, "scroll", () => this._positionPopup(), true);

    return root;
  }

  _createNativeElement() {
    const root = document.createElement("label");
    root.className = ["dui-control", "dui-text-field", "dui-select-input", this.css]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-text-field__label";
    label.textContent = this.label;

    const select = document.createElement("select");
    select.className = "dui-text-field__input dui-select-input__select";
    select.disabled = this.disabled;
    select.required = this.state.has("required");
    select.dataset.duiFocusTarget = "true";

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    root.append(label, select, message);
    this._labelElement = label;
    this._input = select;
    this._select = select;
    this._message = message;
    this._renderOptions();

    this.disposables.addEventListener(select, "change", () => {
      const nextValue = this._idsByOptionKey.get(select.value) ?? this._emptyValue;

      this._setValue(nextValue, {
        origin: "user",
        userAction: true
      });
    });

    return root;
  }

  destroy() {
    const ownedData = this._ownsData ? this.data : null;
    const popup = this._popupElement;

    this.closePopup({ silent: true, restoreFocus: false });

    super.destroy();

    popup?.remove();

    this._select = null;
    this._optionKeysById.clear();
    this._idsByOptionKey.clear();
    this._labelElement = null;
    this._group = null;
    this._displayElement = null;
    this._displayImageElement = null;
    this._displayTextElement = null;
    this._buttonElement = null;
    this._popupElement = null;
    this._searchElement = null;
    this._listElement = null;
    this._itemKeysById.clear();
    this._idsByItemKey.clear();

    if (ownedData && !ownedData.destroyed) {
      ownedData.destroy();
    }
  }

  openPopup(options = {}) {
    this._assertMutable("openPopup");

    if (this.disabled || this.isReadOnly() || !this._popupElement) {
      return this;
    }

    this.overlayManager.getRoot().appendChild(this._popupElement);
    this._popupElement.hidden = false;
    this._displayElement?.setAttribute("aria-expanded", "true");
    this._ensureActiveItem();
    this._renderItems();
    if (this.destroyed || !this._popupElement || this._popupElement.hidden) return this;
    const popup = this._popupElement;
    this.overlayManager.open(this, {
      element: this._popupElement,
      anchor: this._group,
      modal: false,
      closeOnOutsideClick: true,
      closeOnEscape: true,
      restoreFocus: false,
      silent: options.silent,
      requestClose: request => {
        const localEscape = request.reason === "escape" &&
          (popup.contains(request.nativeEvent?.target) || this.element?.contains(request.nativeEvent?.target));
        this.closePopup({ origin: "user", userAction: true, reason: request.reason });
        const active = typeof document !== "undefined" ? document.activeElement : null;
        if (localEscape && !this.destroyed && !this.disabled && !this.isReadOnly() && this._popupElement === popup && popup.hidden &&
            (active === document.body || popup.contains(active) || this.element?.contains(active))) {
          this._displayElement?.focus({ preventScroll: true });
        }
      }
    });
    if (this.destroyed || this._popupElement !== popup || popup.hidden) return this;
    this._positionPopup();

    if (this.searchable) {
      this._searchElement?.focus();
    }

    if (!options.silent) this.events.emit("open", {
      source: this,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    return this;
  }

  closePopup(options = {}) {
    if (!this._popupElement || this._popupElement.hidden) {
      return this;
    }

    const popup = this._popupElement;
    popup.hidden = true;
    this._displayElement?.setAttribute("aria-expanded", "false");
    this.overlayManager.close(this, {
      silent: options.silent,
      restoreFocus: options.restoreFocus === true
    });
    if (!options.silent && !this.destroyed && this._popupElement === popup && popup.hidden) {
      this.events.emit("close", {
        source: this,
        reason: options.reason ?? "api",
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  togglePopup() {
    if (!this._popupElement || this._popupElement.hidden) {
      return this.openPopup();
    }

    return this.closePopup();
  }

  _positionPopup() {
    if (!this._popupElement || this._popupElement.hidden || !this._group?.isConnected) return false;
    const anchor = this._group.getBoundingClientRect();
    const gap = 2;
    const viewportGap = 4;
    const scale = overlayScale(this._popupElement);
    this._popupElement.style.width = this.popupWidth == null
      ? `${Math.round(anchor.width) / scale}px`
      : normalizeCssSize(this.popupWidth);
    const popup = this._popupElement.getBoundingClientRect();
    let top = anchor.bottom + gap;
    if (top + popup.height > window.innerHeight - viewportGap && anchor.top >= popup.height + gap) {
      top = anchor.top - popup.height - gap;
    }
    let left = anchor.left;
    left = Math.max(viewportGap, Math.min(left, window.innerWidth - popup.width - viewportGap));
    top = Math.max(viewportGap, Math.min(top, window.innerHeight - popup.height - viewportGap));
    this._popupElement.style.left = `${Math.round(left) / scale}px`;
    this._popupElement.style.top = `${Math.round(top) / scale}px`;
    return true;
  }

  setFilter(query = "", options = {}) {
    this._assertMutable("setFilter");
    const oldValue = this._query;
    this._query = String(query ?? "");
    this._activeId = null;
    this._renderItems();

    if (!options.silent && !this.destroyed && oldValue !== this._query) {
      this.events.emit("filterChange", {
        source: this,
        oldValue,
        newValue: this._query,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  getSelectedItem() {
    return this.data.get(this._value) ?? null;
  }

  _handleDisplayClick() {
    this.togglePopup();
  }

  _setValue(nextValue, options = {}) {
    this._assertMutable("value.set");

    const mutation = normalizeMutationOptions(options);
    const oldValue = this._value;
    const newValue = nextValue ?? this._emptyValue;

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
      oldValue,
      newValue,
      oldItem: this.data.get(oldValue) ?? null,
      newItem: this.data.get(newValue) ?? null,
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
        oldValue,
        newValue,
        oldItem: beforeEvent.oldItem,
        newItem: beforeEvent.newItem,
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

  _syncInput(value) {
    if (this._select) {
      const optionKey = this._optionKeysById.get(value);
      this._select.value = optionKey ?? "";
      return;
    }
    this._renderDisplay();
    this._syncSelectionState();
  }

  _syncStateToInput() {
    if (this._select) {
      this._select.required = this.isRequired();
      this._select.disabled = this.disabled;
      if (this.isReadOnly()) this._select.setAttribute("aria-readonly", "true");
      else this._select.removeAttribute("aria-readonly");
      return;
    }
    const disabled = this.disabled || this.isReadOnly();
    if (disabled) this.closePopup({ silent: true, restoreFocus: false });

    if (this._displayElement) {
      this._displayElement.tabIndex = disabled ? -1 : (this.tabIndex ?? 0);
      this._displayElement.setAttribute("aria-disabled", disabled ? "true" : "false");
      this._displayElement.setAttribute("aria-required", this.isRequired() ? "true" : "false");
    }

    if (this._buttonElement) {
      this._buttonElement.disabled = disabled;
    }

    if (this._searchElement) {
      this._searchElement.disabled = disabled;
    }

    if (this.isReadOnly()) {
      this._displayElement?.setAttribute("aria-readonly", "true");
    } else {
      this._displayElement?.removeAttribute("aria-readonly");
    }
  }

  _renderLabel() {
    this._displayElement?.setAttribute("aria-label", this.label || this.name || this.id);
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }
  }

  _renderOptions() {
    if (!this._select) {
      return;
    }

    this._optionKeysById.clear();
    this._idsByOptionKey.clear();
    this._select.replaceChildren();

    if (this.placeholder !== "") {
      this._select.appendChild(this._createOption(this._emptyValue, this.placeholder));
    }

    for (const item of this.data.all()) {
      const id = this.data.idOf(item);
      const option = this._createOption(id, this._getItemText(item));
      this._select.appendChild(option);
    }

    this._syncInput(this._value);
  }

  _createOption(id, text) {
    const optionKey = toItemKey(id);
    const option = document.createElement("option");

    option.value = optionKey;
    option.textContent = text;
    this._optionKeysById.set(id, optionKey);
    this._idsByOptionKey.set(optionKey, id);

    return option;
  }

  _renderDisplay() {
    if (!this._displayTextElement || !this._displayImageElement) {
      return;
    }

    const item = this.data.get(this._value);

    this._displayImageElement.replaceChildren();
    this._displayImageElement.hidden = true;

    if (!item) {
      this._displayTextElement.textContent = this.placeholder;
      this._displayTextElement.classList.toggle("dui-placeholder", true);
      return;
    }

    this._displayTextElement.textContent = this._getItemText(item);
    this._displayTextElement.classList.toggle("dui-placeholder", false);
    this._renderItemImage(this._displayImageElement, item);
  }

  _renderItems() {
    if (!this._listElement || this.destroyed) {
      return;
    }
    const revision = this._itemRenderRevision = (this._itemRenderRevision ?? 0) + 1;

    this._itemKeysById.clear();
    this._idsByItemKey.clear();
    this._listElement.replaceChildren();

    const items = this._getFilteredItems();
    if (this.destroyed || revision !== this._itemRenderRevision) return;

    if (items.length === 0) {
      this._activeId = null;
      const empty = document.createElement("div");
      empty.className = "dui-dropdown-list__empty";
      empty.textContent = "No items";
      this._listElement.append(empty);
      return;
    }

    if (this._activeId == null || !items.some(item => Object.is(this.data.idOf(item), this._activeId))) {
      const selectedItem = items.find(item => this._isSelectedId(this.data.idOf(item)));
      this._activeId = selectedItem ? this.data.idOf(selectedItem) : this.data.idOf(items[0], 0);
    }

    for (const [index, item] of items.entries()) {
      const id = this.data.idOf(item, index);
      const itemKey = toItemKey(id);
      const row = document.createElement("div");

      row.className = "dui-dropdown-list__item";
      row.dataset.duiDropdownItemId = itemKey;
      row.setAttribute("role", "option");

      this._itemKeysById.set(id, itemKey);
      this._idsByItemKey.set(itemKey, id);

      if (this.renderItem) {
        const rendered = this.renderItem(item, {
          source: this,
          id,
          index,
          selected: this._isSelectedId(id),
          active: Object.is(this._activeId, id)
        });
        if (this.destroyed || revision !== this._itemRenderRevision) return;

        if (rendered instanceof Node) {
          row.append(rendered);
        } else {
          row.textContent = rendered == null ? "" : String(rendered);
        }
      } else {
        row.append(this._createDefaultItemContent(item));
      }
      if (this.destroyed || revision !== this._itemRenderRevision) return;
      this._listElement.append(row);
    }

    this._syncSelectionState();
  }

  _createDefaultItemContent(item) {
    const content = document.createElement("span");
    content.className = "dui-dropdown-list__item-content";

    const image = document.createElement("span");
    image.className = "dui-dropdown-list__item-image";
    this._renderItemImage(image, item);

    const textWrap = document.createElement("span");
    textWrap.className = "dui-dropdown-list__item-text-wrap";

    const text = document.createElement("span");
    text.className = "dui-dropdown-list__item-text";
    text.textContent = this._getItemText(item);

    const description = document.createElement("span");
    description.className = "dui-dropdown-list__item-description";
    description.textContent = this._getItemDescription(item);
    description.hidden = description.textContent === "";

    textWrap.append(text, description);
    content.append(image, textWrap);
    return content;
  }

  _renderItemImage(host, item) {
    host.replaceChildren();
    host.hidden = true;

    const image = getFieldValue(item, this.imageField);

    if (image) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = String(image);
      host.append(img);
      host.hidden = false;
      return;
    }

    const icon = getFieldValue(item, this.iconField);

    if (icon) {
      const span = document.createElement("span");
      span.className = "dui-dropdown-list__item-icon";
      span.append(createIcon(String(icon)));
      host.append(span);
      host.hidden = false;
    }
  }

  _syncSelectionState() {
    if (!this._listElement) {
      return;
    }

    for (const row of this._listElement.querySelectorAll(".dui-dropdown-list__item")) {
      const id = this._idsByItemKey.get(row.dataset.duiDropdownItemId);
      const selected = this._isSelectedId(id);
      const active = Object.is(this._activeId, id);
      row.classList.toggle("dui-selected", selected);
      row.classList.toggle("dui-active", active);
      row.setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  _isSelectedId(id) {
    return Object.is(this._value, id);
  }

  _handleKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || this.disabled || this.isReadOnly()) {
      return;
    }

    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      this.openPopup();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.closePopup();
      this._displayElement?.focus();
      return;
    }

    if (event.key === "Enter") {
      if (!this._popupElement || this._popupElement.hidden) {
        event.preventDefault();
        this.openPopup();
        return;
      }

      event.preventDefault();
      this._selectActiveItem();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }

    event.preventDefault();

    if (!this._popupElement || this._popupElement.hidden) {
      this.openPopup();
    }
    if (this.destroyed) return;

    const items = this._getFilteredItems();

    if (items.length === 0) {
      return;
    }

    let index = this._getActiveIndex(items);

    if (event.key === "ArrowDown") {
      index = Math.min(items.length - 1, index + 1);
    } else if (event.key === "ArrowUp") {
      index = Math.max(0, index - 1);
    } else if (event.key === "Home") {
      index = 0;
    } else if (event.key === "End") {
      index = items.length - 1;
    }

    this._setActiveItem(items[index]);
  }

  _setActiveItem(item) {
    if (!item) {
      return false;
    }

    this._activeId = this.data.idOf(item);
    this._syncSelectionState();
    this._scrollActiveIntoView();
    return true;
  }

  _ensureActiveItem() {
    const items = this._getFilteredItems();

    if (items.length === 0) {
      this._activeId = null;
      return;
    }

    const selectedItem = items.find(item => this._isSelectedId(this.data.idOf(item)));

    if (selectedItem) {
      this._activeId = this.data.idOf(selectedItem);
      return;
    }

    if (!items.some(item => Object.is(this.data.idOf(item), this._activeId))) {
      this._activeId = this.data.idOf(items[0], 0);
    }
  }

  _selectActiveItem() {
    const item = this._getFilteredItems().find(current => Object.is(this.data.idOf(current), this._activeId));

    if (item) {
      this._selectItemFromUser(item);
    }
  }

  _selectItemFromUser(item) {
    const id = this.data.idOf(item);
    this._setValue(id, {
      origin: "user",
      userAction: true
    });
    if (this.destroyed) return;
    this.closePopup();
    this._displayElement?.focus();
  }

  _getActiveIndex(items) {
    const index = items.findIndex(item => Object.is(this.data.idOf(item), this._activeId));
    return index === -1 ? 0 : index;
  }

  _scrollActiveIntoView() {
    if (!this._listElement) {
      return;
    }

    const key = this._itemKeysById.get(this._activeId);
    const row = key ? this._listElement.querySelector(`[data-dui-dropdown-item-id="${CSS.escape(key)}"]`) : null;
    row?.scrollIntoView?.({ block: "nearest" });
  }

  _getItemFromElement(element) {
    const id = this._idsByItemKey.get(element.dataset.duiDropdownItemId);
    return id == null ? null : this.data.get(id) ?? null;
  }

  _getFilteredItems() {
    const items = this.data.all();
    const query = this._query.trim().toLowerCase();

    if (!query) {
      return items;
    }

    return items.filter(item => {
      if (this.filterPredicate) {
        return this.filterPredicate(item, query, this);
      }

      const haystack = `${this._getItemText(item)} ${this._getItemDescription(item)}`.toLowerCase();
      return this.filterMode === "startsWith" ? haystack.startsWith(query) : haystack.includes(query);
    });
  }

  _getItemText(item) {
    return String(getFieldValue(item, this.textField) ?? item.id ?? "");
  }

  _getItemDescription(item) {
    return String(getFieldValue(item, this.descriptionField) ?? "");
  }

  _reconcileValueWithData() {
    if (Object.is(this._value, this._emptyValue)) {
      return;
    }

    if (this.data.get(this._value)) {
      return;
    }

    this._setValue(this._emptyValue, {
      silent: true,
      origin: "system"
    });
  }
}

function assertDataStore(store) {
  const requiredMethods = ["parse", "all", "get", "add", "update", "remove", "clear", "idOf"];

  for (const method of requiredMethods) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError("SelectInput data must implement DataStore.");
    }
  }

  if (!store.events || typeof store.events.on !== "function") {
    throw new TypeError("SelectInput data must expose EventBus.");
  }
}

function getFieldValue(item, field) {
  if (typeof field === "function") {
    return field(item);
  }

  return item?.[field];
}

function normalizeCssSize(value) {
  return typeof value === "number" ? `${value}px` : String(value);
}

function toItemKey(id) {
  return `${typeof id}:${String(id)}`;
}

function cloneEventForAfter(event) {
  const clone = { ...event };
  delete clone.type;
  return clone;
}
