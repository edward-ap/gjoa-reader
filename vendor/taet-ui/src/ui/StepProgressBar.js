import { BaseControl } from "../core/BaseControl.js";
import { createIcon } from "./Icon.js";

export class StepProgressBar extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.items = normalizeItems(options.items ?? []);
    this.selectedItemIndex = normalizeSelectedIndex(
      options.selectedItemIndex ?? options.selectedIndex ?? -1,
      this.items.length
    );
    this.orientation = options.orientation === "vertical" ? "vertical" : "horizontal";
    this.layoutMode = normalizeLayoutMode(options.layoutMode ?? options.layout ?? "compact");
    this.contentAlignment = normalizeContentAlignment(options.contentAlignment ?? "start");
    this.inverse = options.inverse === true || options.reverse === true;
    this.drawConnectors = options.drawConnectors !== false;
    this.allowUserInteraction = options.allowUserInteraction === true || options.interactive === true;
    this.css = options.css ?? "";
    this.className = options.className ?? "";
    this.indicatorWidth = parsePositiveNumber(options.indicatorWidth ?? options.indicatorSize, 24);
    this.indicatorLineThickness = parsePositiveNumber(options.indicatorLineThickness, 2);
    this.connectorLineThickness = parsePositiveNumber(options.connectorLineThickness, 2);
    this.indentBetweenItems = parsePositiveNumber(options.indentBetweenItems, 42);
    this.connectorOffset = parseFiniteNumber(options.connectorOffset, 6);
    this.showIndex = options.showIndex !== false;
    this._listElement = null;
    this._itemElements = new Map();
    this._connectorObserver = null;

    this._bindOptionEvent("itemClick", options.onItemClick);
    this._bindOptionEvent("selectedItemChanged", options.onSelectedItemChanged);

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  mount(container) {
    super.mount(container);
    this._updateConnectorGeometry();

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => this._updateConnectorGeometry());
    }

    return this;
  }

  createElement() {
    const root = document.createElement("div");
    root.className = [
      "dui-control",
      "dui-step-progress",
      `dui-step-progress--${this.orientation}`,
      `dui-step-progress--${this.layoutMode}`,
      `dui-step-progress--align-${this.contentAlignment}`,
      this.inverse ? "dui-step-progress--inverse" : "",
      this.drawConnectors ? "" : "dui-step-progress--no-connectors",
      this.allowUserInteraction ? "dui-step-progress--interactive" : "",
      this.css,
      this.className
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.style.setProperty("--dui-step-indicator-size", `${this.indicatorWidth}px`);
    root.style.setProperty("--dui-step-indicator-line", `${this.indicatorLineThickness}px`);
    root.style.setProperty("--dui-step-connector-line", `${this.connectorLineThickness}px`);
    root.style.setProperty("--dui-step-indent", `${this.indentBetweenItems}px`);
    root.style.setProperty("--dui-step-connector-offset", `${this.connectorOffset}px`);

    const list = document.createElement("div");
    list.className = "dui-step-progress__items";
    list.setAttribute("role", "list");
    list.dataset.duiFocusTarget = "true";
    list.tabIndex = this.tabIndex ?? 0;

    root.append(list);
    this._listElement = list;
    this._input = list;
    this._renderItems();

    this.disposables.addEventListener(list, "click", event => {
      const itemElement = event.target.closest?.(".dui-step-progress__item");

      if (!itemElement || !list.contains(itemElement)) {
        return;
      }

      this._handleItemClick(Number(itemElement.dataset.duiStepIndex), event);
    });

    this.disposables.addEventListener(list, "keydown", event => {
      this._handleKeyDown(event);
    });

    return root;
  }

  destroy() {
    super.destroy();
    this._listElement = null;
    this._itemElements = new Map();
    this._disconnectConnectorObserver();
  }

  enable() {
    super.enable();
    this._syncSelection();
    return this;
  }

  disable() {
    super.disable();
    this._syncSelection();
    return this;
  }

  refresh() {
    super.refresh();
    this._renderItems();
    return this;
  }

  setItems(items = [], options = {}) {
    this._assertMutable("setItems");

    const oldValue = this.items;
    this.items = normalizeItems(items);
    this.selectedItemIndex = normalizeSelectedIndex(this.selectedItemIndex, this.items.length);
    this._renderItems();

    if (!options.silent) {
      this.events.emit("itemsChange", {
        source: this,
        oldValue,
        newValue: this.getItems(),
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  getItems() {
    return this.items.map(item => ({
      ...item,
      contentBlock1: { ...item.contentBlock1 },
      contentBlock2: { ...item.contentBlock2 }
    }));
  }

  getSelectedItemIndex() {
    return this.selectedItemIndex;
  }

  getSelectedItems() {
    return this.items
      .filter((item, index) => this._getItemVisualState(item, index) === "active")
      .map(item => ({ ...item }));
  }

  selectItem(itemOrIndex, options = {}) {
    this._assertMutable("selectItem");

    const index = typeof itemOrIndex === "number" ? itemOrIndex : this.items.indexOf(itemOrIndex);
    return this.setSelectedItemIndex(index, options);
  }

  setSelectedItemIndex(index, options = {}) {
    this._assertMutable("setSelectedItemIndex");

    const nextIndex = normalizeSelectedIndex(index, this.items.length);

    if (nextIndex >= 0 && !this._canSelectItem(nextIndex)) {
      return false;
    }

    if (nextIndex === this.selectedItemIndex) {
      return false;
    }

    const oldValue = this.selectedItemIndex;
    this.selectedItemIndex = nextIndex;
    this._syncSelection();

    if (!options.silent) {
      this.events.emit("selectedItemChanged", {
        source: this,
        oldValue,
        newValue: this.selectedItemIndex,
        selectedItem: this.items[this.selectedItemIndex] ?? null,
        selectedItems: this.getSelectedItems(),
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  selectAll(options = {}) {
    return this.setSelectedItemIndex(this.items.length - 1, options);
  }

  unselectAll(options = {}) {
    return this.setSelectedItemIndex(-1, options);
  }

  selectNext(options = {}) {
    this._assertMutable("selectNext");
    const nextIndex = findSelectableIndex(this.items, this.selectedItemIndex + 1, 1);
    return nextIndex === -1 ? false : this.setSelectedItemIndex(nextIndex, options);
  }

  selectPrevious(options = {}) {
    this._assertMutable("selectPrevious");
    const startIndex = this.selectedItemIndex <= 0 ? -1 : this.selectedItemIndex - 1;

    if (startIndex === -1) {
      return this.unselectAll(options);
    }

    const previousIndex = findSelectableIndex(this.items, startIndex, -1);
    return previousIndex === -1 ? this.unselectAll(options) : this.setSelectedItemIndex(previousIndex, options);
  }

  setItemProgress(itemOrIndex, progress, options = {}) {
    this._assertMutable("setItemProgress");

    const index = typeof itemOrIndex === "number" ? itemOrIndex : this.items.indexOf(itemOrIndex);

    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) {
      return false;
    }

    const item = this.items[index];
    const oldValue = item.progress;
    item.progress = clampProgress(progress);
    this._syncSelection();

    if (!options.silent && oldValue !== item.progress) {
      this.events.emit("itemProgressChange", {
        source: this,
        item,
        index,
        oldValue,
        newValue: item.progress,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  scrollToItem(itemOrIndex) {
    const index = typeof itemOrIndex === "number" ? itemOrIndex : this.items.indexOf(itemOrIndex);
    const element = this._itemElements.get(index);

    if (!element) {
      return false;
    }

    element.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
    return true;
  }

  _renderItems() {
    if (!this._listElement) {
      return;
    }

    this._listElement.replaceChildren();
    this._itemElements = new Map();

    const renderItems = this.inverse ? [...this.items].reverse() : this.items;

    for (const item of renderItems) {
      const index = this.items.indexOf(item);
      const element = this._createItemElement(item, index);
      this._listElement.append(element);
      this._itemElements.set(index, element);
    }

    this._syncSelection();
    this._updateConnectorGeometry();
    this._connectConnectorObserver();
  }

  _createItemElement(item, index) {
    const element = document.createElement("div");
    element.className = "dui-step-progress__item";
    element.dataset.duiStepIndex = String(index);
    element.setAttribute("role", "listitem");
    element.style.setProperty("--dui-step-connector-progress", "0%");

    const block1 = createContentBlock(item.contentBlock1, "dui-step-progress__block--one");
    const node = document.createElement("button");
    node.className = "dui-step-progress__node";
    node.type = "button";
    node.tabIndex = this._canFocusItem(index) ? 0 : -1;
    node.disabled = this.disabled || !item.enabled || !this._canInteractWithItem(index);
    node.setAttribute("aria-label", createAriaLabel(item, index));

    const indicator = document.createElement("span");
    indicator.className = "dui-step-progress__indicator";

    const indicatorText = document.createElement("span");
    indicatorText.className = "dui-step-progress__indicator-text";
    if (item.icon) {
      indicatorText.append(createIcon(item.icon));
    } else if (this.showIndex) {
      indicatorText.textContent = String(index + 1);
    }

    const connector = document.createElement("span");
    connector.className = "dui-step-progress__connector";
    connector.setAttribute("aria-hidden", "true");

    indicator.append(indicatorText);
    node.append(indicator);

    const block2 = createContentBlock(item.contentBlock2, "dui-step-progress__block--two");
    element.append(block1, node, block2, connector);

    if (item.tooltip) {
      element.title = item.tooltip;
    }

    return element;
  }

  _syncSelection() {
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      const element = this._itemElements.get(index);

      if (!element) {
        continue;
      }

      const state = this._getItemVisualState(item, index);
      const isSelected = index === this.selectedItemIndex;
      const progress = getConnectorProgress(item, index, this.selectedItemIndex);
      const node = element.querySelector(".dui-step-progress__node");

      element.dataset.state = state;
      element.classList.toggle("dui-step-progress__item--active", state === "active");
      element.classList.toggle("dui-step-progress__item--current", isSelected);
      element.classList.toggle("dui-step-progress__item--inactive", state === "inactive");
      element.classList.toggle("dui-step-progress__item--error", state === "error");
      element.classList.toggle("dui-step-progress__item--disabled", !item.enabled);
      element.style.setProperty("--dui-step-connector-progress", `${progress}%`);
      node.disabled = this.disabled || !item.enabled || !this._canInteractWithItem(index);
      node.tabIndex = this._canFocusItem(index) ? 0 : -1;
      node.setAttribute("aria-current", isSelected ? "step" : "false");
      node.setAttribute("aria-disabled", node.disabled ? "true" : "false");
    }

    this._updateConnectorGeometry();
  }

  _connectConnectorObserver() {
    this._disconnectConnectorObserver();

    if (typeof ResizeObserver === "undefined" || !this.element) {
      return;
    }

    this._connectorObserver = new ResizeObserver(() => {
      this._updateConnectorGeometry();
    });
    this._connectorObserver.observe(this.element);

    for (const element of this._itemElements.values()) {
      this._connectorObserver.observe(element);
    }
  }

  _disconnectConnectorObserver() {
    if (this._connectorObserver) {
      this._connectorObserver.disconnect();
      this._connectorObserver = null;
    }
  }

  _updateConnectorGeometry() {
    if (!this.element) {
      return;
    }

    const entries = [...this._itemElements.values()]
      .map(element => ({
        element,
        rect: element.getBoundingClientRect()
      }))
      .sort((a, b) =>
        this.orientation === "horizontal" ? a.rect.left - b.rect.left : a.rect.top - b.rect.top
      );

    for (let position = 0; position < entries.length; position += 1) {
      const { element, rect: itemRect } = entries[position];
      const indicator = element.querySelector(".dui-step-progress__indicator");
      const connector = element.querySelector(".dui-step-progress__connector");

      if (!indicator || !connector) {
        continue;
      }

      const indicatorRect = indicator.getBoundingClientRect();
      const nextElement = entries[position + 1]?.element;
      const nextIndicator = nextElement?.querySelector(".dui-step-progress__indicator");
      const nextIndicatorRect = nextIndicator?.getBoundingClientRect();

      if (this.orientation === "horizontal") {
        const centerY = indicatorRect.top - itemRect.top + indicatorRect.height / 2;
        const centerX = indicatorRect.left - itemRect.left + indicatorRect.width / 2;
        const nextCenterX = nextIndicatorRect
          ? nextIndicatorRect.left - itemRect.left + nextIndicatorRect.width / 2
          : centerX;

        element.style.setProperty("--dui-step-connector-top", `${centerY}px`);
        element.style.setProperty("--dui-step-connector-left", `${centerX}px`);
        element.style.setProperty("--dui-step-connector-size", `${Math.max(0, nextCenterX - centerX)}px`);
      } else {
        const centerX = indicatorRect.left - itemRect.left + indicatorRect.width / 2;
        const centerY = indicatorRect.top - itemRect.top + indicatorRect.height / 2;
        const nextCenterY = nextIndicatorRect
          ? nextIndicatorRect.top - itemRect.top + nextIndicatorRect.height / 2
          : centerY;

        element.style.setProperty("--dui-step-connector-left", `${centerX}px`);
        element.style.setProperty("--dui-step-connector-top", `${centerY}px`);
        element.style.setProperty("--dui-step-connector-size", `${Math.max(0, nextCenterY - centerY)}px`);
      }
    }
  }

  _getItemVisualState(item, index) {
    if (!item.enabled) {
      return "disabled";
    }

    if (item.state === "error") {
      return "error";
    }

    if (item.state === "active" || index <= this.selectedItemIndex) {
      return "active";
    }

    return "inactive";
  }

  _handleItemClick(index, nativeEvent) {
    if (this.destroyed || this.disabled || !this.allowUserInteraction || !this._canSelectItem(index)) {
      return;
    }

    const item = this.items[index];
    const event = {
      source: this,
      item,
      index,
      nativeEvent,
      origin: "user",
      userAction: true,
      cancel: false,
      handled: false
    };

    this.events.emit("itemClick", event);

    if (this.destroyed || this.disabled || event.cancel || event.handled || this.items[index] !== item) {
      return;
    }

    this.setSelectedItemIndex(index, {
      origin: "user",
      userAction: true
    });
  }

  _handleKeyDown(event) {
    if (!this.allowUserInteraction || this.disabled) {
      return;
    }

    const activeIndex = Number(event.target.closest?.(".dui-step-progress__item")?.dataset.duiStepIndex);

    if (!Number.isInteger(activeIndex)) {
      return;
    }

    const nextKeys =
      this.orientation === "vertical" ? ["ArrowDown", "ArrowRight"] : ["ArrowRight", "ArrowDown"];
    const previousKeys =
      this.orientation === "vertical" ? ["ArrowUp", "ArrowLeft"] : ["ArrowLeft", "ArrowUp"];

    if (nextKeys.includes(event.key)) {
      event.preventDefault();
      focusItem(this._itemElements.get(findSelectableIndex(this.items, activeIndex + 1, 1)));
    } else if (previousKeys.includes(event.key)) {
      event.preventDefault();
      focusItem(this._itemElements.get(findSelectableIndex(this.items, activeIndex - 1, -1)));
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(this._itemElements.get(findSelectableIndex(this.items, 0, 1)));
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(this._itemElements.get(findSelectableIndex(this.items, this.items.length - 1, -1)));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this._handleItemClick(activeIndex, event);
    }
  }

  _canSelectItem(index) {
    const item = this.items[index];
    return !!item && item.enabled && item.allowUserInteraction;
  }

  _canFocusItem(index) {
    const item = this.items[index];
    return !!item && item.enabled && item.allowUserInteraction && this.allowUserInteraction;
  }

  _canInteractWithItem(index) {
    const item = this.items[index];
    return !!item && item.allowUserInteraction && this.allowUserInteraction;
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item, index) => normalizeItem(item, index));
}

function normalizeItem(item, index) {
  if (item == null || typeof item !== "object") {
    return {
      id: String(index),
      caption: String(item ?? ""),
      description: "",
      contentBlock1: { caption: String(item ?? ""), description: "" },
      contentBlock2: { caption: "", description: "" },
      enabled: true,
      allowUserInteraction: true,
      progress: 0,
      state: "default",
      icon: "",
      tooltip: ""
    };
  }

  const caption = item.caption ?? item.text ?? item.label ?? "";
  const description = item.description ?? "";
  const contentBlock1 = normalizeContentBlock(item.contentBlock1 ?? item.block1, caption, description);
  const contentBlock2 = normalizeContentBlock(
    item.contentBlock2 ?? item.block2,
    item.caption2 ?? "",
    item.description2 ?? ""
  );

  return {
    ...item,
    id: item.id ?? item.name ?? String(index),
    caption,
    description,
    contentBlock1,
    contentBlock2,
    enabled: item.enabled !== false && item.disabled !== true,
    allowUserInteraction: item.allowUserInteraction !== false,
    progress: clampProgress(item.progress ?? 0),
    state: item.state ?? "default",
    icon: item.icon ?? "",
    tooltip: item.tooltip ?? item.title ?? ""
  };
}

function normalizeContentBlock(block, fallbackCaption, fallbackDescription) {
  if (block == null) {
    return {
      caption: fallbackCaption,
      description: fallbackDescription
    };
  }

  if (typeof block === "string") {
    return {
      caption: block,
      description: ""
    };
  }

  return {
    caption: block.caption ?? block.text ?? fallbackCaption,
    description: block.description ?? block.details ?? fallbackDescription,
    image: block.image ?? ""
  };
}

function createContentBlock(block, extraClass) {
  const element = document.createElement("span");
  element.className = ["dui-step-progress__block", extraClass].filter(Boolean).join(" ");

  const caption = document.createElement("span");
  caption.className = "dui-step-progress__caption";
  caption.textContent = block.caption ?? "";

  const description = document.createElement("span");
  description.className = "dui-step-progress__description";
  description.textContent = block.description ?? "";

  element.append(caption, description);
  return element;
}

function normalizeSelectedIndex(index, length) {
  const parsed = Number(index);

  if (!Number.isInteger(parsed)) {
    return -1;
  }

  return Math.max(-1, Math.min(length - 1, parsed));
}

function normalizeLayoutMode(layoutMode) {
  if (layoutMode === "fixed" || layoutMode === "fullSize") {
    return layoutMode;
  }

  return "compact";
}

function normalizeContentAlignment(contentAlignment) {
  if (contentAlignment === "center" || contentAlignment === "end") {
    return contentAlignment;
  }

  return "start";
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampProgress(progress) {
  const parsed = Number(progress);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
}

function getConnectorProgress(_item, index, selectedItemIndex) {
  if (index < selectedItemIndex) {
    return 100;
  }

  return 0;
}

function findSelectableIndex(items, startIndex, direction) {
  for (let index = startIndex; index >= 0 && index < items.length; index += direction) {
    const item = items[index];

    if (item?.enabled && item.allowUserInteraction) {
      return index;
    }
  }

  return -1;
}

function focusItem(element) {
  element?.querySelector(".dui-step-progress__node")?.focus();
}

function createAriaLabel(item, index) {
  const parts = [`Step ${index + 1}`];

  if (item.contentBlock1.caption) {
    parts.push(item.contentBlock1.caption);
  }

  if (item.contentBlock1.description) {
    parts.push(item.contentBlock1.description);
  }

  return parts.join(": ");
}
