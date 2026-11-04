import { BaseControl } from "../core/BaseControl.js";
import { DataStore } from "../core/DataStore.js";
import { SelectionModel } from "../core/SelectionModel.js";
import { createIcon } from "./Icon.js";
import { itemGeometry, treeAnchor } from "./itemGeometry.js";

export class List extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({ ...options, tabIndex: options.tabIndex ?? 0 });

    this.css = options.css ?? "";
    this.className = options.className ?? "";
    this.textField = options.textField ?? "text";
    this.iconField = options.iconField ?? "icon";
    this.itemHeight = options.itemHeight ?? null;
    this.renderItem = options.renderItem ?? null;
    this.multiSelect = options.multiSelect === true;
    this._ownsData = !options.data;
    this._ownsSelection = !options.selection;
    this._activeId = null;
    this._itemKeysById = new Map();
    this._idsByItemKey = new Map();
    this._itemElementsById = new Map();
    this._itemResizeObserver = null;

    this.data =
      options.data ??
      new DataStore({
        idField: options.idField ?? "id",
        getId: options.getId
      });

    assertDataStore(this.data);

    this.selection =
      options.selection ??
      new SelectionModel({
        multiple: this.multiSelect
      });

    assertSelectionModel(this.selection);

    this.disposables.add(
      this.data.events.on("change", event => {
        if (this.destroyed) return;
        if (!(this.data instanceof DataStore)) this._syncData();
        if (this.destroyed) return;
        this.events.emit("dataChange", {
          source: this,
          dataEvent: event,
          origin: event.origin,
          userAction: event.userAction
        });
      })
    );

    if (this.data instanceof DataStore) {
      this.disposables.add(this.data.events.on("invalidate", () => this._syncData()));
    }

    this.disposables.add(
      this.selection.events.on("change", event => {
        if (this.destroyed) return;
        this._syncSelectionState();
        this.events.emit("selectionChange", {
          source: this,
          items: event.items,
          oldItems: event.oldItems,
          origin: event.origin,
          userAction: event.userAction
        });
      })
    );

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-list", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiFocusTarget = "true";
    root.tabIndex = this.disabled ? -1 : 0;
    root.setAttribute("role", "listbox");
    root.setAttribute("aria-label", this.options.label ?? this.name ?? this.id);
    root.setAttribute("aria-multiselectable", this.multiSelect ? "true" : "false");
    this.disposables.addEventListener(root, "scroll", () => this._notifyItemGeometry());

    if (this.itemHeight != null) {
      root.style.setProperty("--dui-list-item-height", normalizeCssSize(this.itemHeight));
    }

    this.disposables.addEventListener(root, "click", event => {
      const itemElement = event.target.closest?.(".dui-list__item");

      if (!itemElement || !root.contains(itemElement)) {
        return;
      }

      const item = this._getItemFromElement(itemElement);

      if (!item) {
        return;
      }

      this._selectItemFromUser(item, event);
      if (this.destroyed) return;
      this.events.emit("itemClick", {
        source: this,
        item,
        id: this.data.idOf(item),
        nativeEvent: event,
        origin: "user",
        userAction: true
      });
    });

    this.disposables.addEventListener(root, "dblclick", event => {
      const itemElement = event.target.closest?.(".dui-list__item");

      if (!itemElement || !root.contains(itemElement)) {
        return;
      }

      const item = this._getItemFromElement(itemElement);

      if (item) {
        this.events.emit("itemDblClick", {
          source: this,
          item,
          id: this.data.idOf(item),
          nativeEvent: event,
          origin: "user",
          userAction: true
        });
      }
    });

    this.disposables.addEventListener(root, "keydown", event => {
      this._handleKeyDown(event);
    });

    this._renderItems(root);
    return root;
  }

  mount(container) {
    super.mount(container);
    if (this.destroyed) return this;
    if (!this._itemResizeObserver && typeof ResizeObserver === "function") {
      this._itemResizeObserver = new ResizeObserver(() => this._notifyItemGeometry());
      this.disposables.add(() => this._itemResizeObserver?.disconnect());
    }
    this._observeItemGeometry();
    return this;
  }

  getItemGeometry(id) {
    if (this.destroyed || this.data.destroyed || !this.data.get(id)) {
      return { id, anchorId:null, status:"missing", rect:null, viewport:null };
    }
    const anchorId = this.treeView ? treeAnchor(this.treeView, id) : id;
    if (anchorId == null) return { id, anchorId:null, status:"filtered", rect:null, viewport:null };
    return itemGeometry(id, anchorId, this._itemElementsById.get(anchorId), this.element, !Object.is(id, anchorId));
  }

  getVisibleItemGeometries() {
    if (this.destroyed) return [];
    return [...this._itemElementsById.keys()].map(id => this.getItemGeometry(id)).filter(entry => entry.status === "visible");
  }

  _notifyItemGeometry() {
    if (!this.destroyed) this.events.emit("itemGeometryChange", { source:this });
  }

  _observeItemGeometry() {
    this._itemResizeObserver?.disconnect();
    if (this.element) this._itemResizeObserver?.observe(this.element);
    for (const row of this._itemElementsById.values()) this._itemResizeObserver?.observe(row);
    this._notifyItemGeometry();
  }

  refresh() {
    super.refresh();
    this._renderItems();
    return this;
  }

  enable() {
    super.enable();
    this._applyTabIndexState();

    return this;
  }

  disable() {
    super.disable();
    this._applyTabIndexState();

    return this;
  }

  _applyTabIndexState() {
    super._applyTabIndexState();
    if (this.element && this.disabled) this.element.tabIndex = -1;
  }

  destroy() {
    const ownedData = this._ownsData ? this.data : null;
    const ownedSelection = this._ownsSelection ? this.selection : null;

    super.destroy();

    this._itemKeysById.clear();
    this._idsByItemKey.clear();
    this._itemElementsById.clear();

    if (ownedData && !ownedData.destroyed) {
      ownedData.destroy();
    }

    if (ownedSelection && !ownedSelection.destroyed) {
      ownedSelection.destroy();
    }
  }

  _renderItems(element = this.element) {
    if (!element || this.destroyed) {
      return;
    }
    const revision = this._renderRevision = (this._renderRevision ?? 0) + 1;

    this._itemKeysById.clear();
    this._idsByItemKey.clear();
    this._itemElementsById.clear();
    element.replaceChildren();

    const items = this.data.all();

    if (items.length === 0) {
      this._activeId = null;
      element.removeAttribute("aria-activedescendant");
      this._observeItemGeometry();
      return;
    }

    if (this._activeId == null || !this.data.get(this._activeId)) {
      this._activeId = this.data.idOf(items[0], 0);
    }

    for (const [index, item] of items.entries()) {
      const id = this.data.idOf(item, index);
      const itemKey = toItemKey(id);
      const row = document.createElement("div");

      row.className = "dui-list__item";
      row.dataset.duiListItemId = itemKey;
      row.id = `${this.id}-item-${index}`;
      row.setAttribute("role", "option");

      this._itemKeysById.set(id, itemKey);
      this._idsByItemKey.set(itemKey, id);

      if (this.renderItem) {
        const rendered = this.renderItem(item, {
          source: this,
          id,
          index,
          selected: this._isSelected(item),
          active: Object.is(id, this._activeId)
        });
        if (this.destroyed || revision !== this._renderRevision) return;

        if (rendered instanceof Node) {
          row.appendChild(rendered);
        } else {
          row.textContent = rendered == null ? "" : String(rendered);
        }
      } else {
        const icon = this._createItemIcon(item);
        if (icon) row.append(icon);
        const text = document.createElement("span");
        text.className = "dui-list__text";
        const caption = getItemText(item, this.textField);
        if (this.destroyed || revision !== this._renderRevision) return;
        text.textContent = caption;
        row.append(text);
      }

      element.appendChild(row);
      this._itemElementsById.set(id, row);
    }

    this._syncSelectionState(element);
    this._observeItemGeometry();
  }

  _createItemIcon(item) {
    const name = item?.[this.iconField];
    if (!name) return null;
    const icon = createIcon(name);
    icon.classList.add("dui-list__icon");
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  _syncSelectionState(element = this.element) {
    if (!element) {
      return;
    }

    const selectedIds = new Set(
      this.selection
        .get()
        .filter(item => item && typeof item === "object")
        .map(item => this.data.idOf(item))
    );

    element.removeAttribute("aria-activedescendant");
    for (const row of element.querySelectorAll(".dui-list__item")) {
      const id = this._idsByItemKey.get(row.dataset.duiListItemId);
      const selected = selectedIds.has(id);
      const active = Object.is(id, this._activeId);

      row.classList.toggle("dui-selected", selected);
      row.classList.toggle("dui-active", active);
      row.setAttribute("aria-selected", selected ? "true" : "false");
      if (active) element.setAttribute("aria-activedescendant", row.id);
    }
  }

  _selectItemFromUser(item, nativeEvent) {
    if (this.disabled) {
      return false;
    }

    const id = this.data.idOf(item);
    this._activeId = id;

    if (this.multiSelect && (nativeEvent.ctrlKey || nativeEvent.metaKey)) {
      const current = this.selection.get();
      const exists = current.includes(item);
      const next = exists ? current.filter(selected => selected !== item) : [...current, item];

      return this.selection.set(next, {
        origin: "user",
        userAction: true
      });
    }

    return this.selection.set([item], {
      origin: "user",
      userAction: true
    });
  }

  _handleKeyDown(event, items = this.data.all()) {
    if (this.disabled) {
      return;
    }

    if (items.length === 0) {
      return;
    }

    let index = this._getActiveIndex(items);
    let handled = true;

    switch (event.key) {
      case "ArrowDown":
        index = Math.min(items.length - 1, index + 1);
        break;

      case "ArrowUp":
        index = Math.max(0, index - 1);
        break;

      case "Home":
        index = 0;
        break;

      case "End":
        index = items.length - 1;
        break;

      case "Enter":
      case " ":
        this._selectActiveItem(items);
        break;

      default:
        handled = false;
        break;
    }

    if (!handled) {
      return;
    }

    event.preventDefault();

    if (event.key !== "Enter" && event.key !== " ") {
      this._setActiveItem(items[index], {
        origin: "user",
        userAction: true
      });
    }
  }

  _setActiveItem(item, options = {}) {
    const oldId = this._activeId;
    const newId = this.data.idOf(item);

    if (Object.is(oldId, newId)) {
      return false;
    }

    this._activeId = newId;
    this._syncSelectionState();
    this._scrollActiveIntoView();

    this.events.emit("activeChange", {
      source: this,
      oldId,
      id: newId,
      item,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    return true;
  }

  _selectActiveItem(items) {
    const index = this._getActiveIndex(items);
    const item = items[index];

    if (item) {
      this.selection.set([item], {
        origin: "user",
        userAction: true
      });
    }
  }

  _getActiveIndex(items) {
    const index = items.findIndex(item => Object.is(this.data.idOf(item), this._activeId));
    return index >= 0 ? index : 0;
  }

  _scrollActiveIntoView() {
    if (!this.element || this._activeId == null) {
      return;
    }

    const itemKey = this._itemKeysById.get(this._activeId);
    const row = itemKey ? this.element.querySelector(`[data-dui-list-item-id="${cssEscape(itemKey)}"]`) : null;
    row?.scrollIntoView({ block: "nearest" });
  }

  _getItemFromElement(element) {
    const id = this._idsByItemKey.get(element.dataset.duiListItemId);
    return id == null ? null : this.data.get(id) ?? null;
  }

  _isSelected(item) {
    return this.selection.get().includes(item);
  }

  _reconcileSelection() {
    const current = this.selection.get();
    const next = current.flatMap(item => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const id = this.data.idOf(item);
      const currentItem = this.data.get(id);
      return currentItem ? [currentItem] : [];
    });

    if (next.length !== current.length || next.some((item, index) => item !== current[index])) {
      this.selection.set(next, {
        silent: true,
        origin: "system"
      });
    }
  }

  _syncData() {
    if (this.destroyed) return;
    this._reconcileSelection();
    if (!this.destroyed) this._renderItems();
  }
}

function assertDataStore(store) {
  const requiredMethods = ["parse", "all", "get", "add", "update", "remove", "clear", "idOf"];

  for (const method of requiredMethods) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError("List data must implement DataStore.");
    }
  }

  if (!store.events || typeof store.events.on !== "function") {
    throw new TypeError("List data must expose EventBus.");
  }
}

function assertSelectionModel(selection) {
  const requiredMethods = ["get", "set", "clear", "hasAny"];

  for (const method of requiredMethods) {
    if (typeof selection?.[method] !== "function") {
      throw new TypeError("List selection must implement SelectionModel.");
    }
  }

  if (!selection.events || typeof selection.events.on !== "function") {
    throw new TypeError("List selection must expose EventBus.");
  }
}

function getItemText(item, textField) {
  if (typeof textField === "function") {
    return String(textField(item));
  }

  return String(item[textField] ?? item.id ?? "");
}

function toItemKey(id) {
  return `${typeof id}:${String(id)}`;
}

function normalizeCssSize(value) {
  return typeof value === "number" ? `${value}px` : String(value);
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(value);
  }

  return String(value).replaceAll('"', '\\"');
}
