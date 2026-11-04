import { BaseControl } from "../core/BaseControl.js";
import { renderIcon } from "./Icon.js";

let nextTabId = 1;

export class TabBar extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.css = options.css ?? "";
    this.className = options.className ?? "";
    this.closable = options.closable === true;
    this.allowCloseLast = options.allowCloseLast === true;
    this.bordered = options.bordered === true;
    this.orientation = normalizeOrientation(options.orientation ?? "top");
    this.overflowNavigation = options.overflowNavigation !== false;
    this.scrollStep = Math.max(48, Number(options.scrollStep ?? 160));
    this.tabs = [];
    this.activeId = null;
    this._focusedId = null;
    this._viewport = null;
    this._track = null;
    this._previousButton = null;
    this._nextButton = null;
    this._overflowObserver = null;
    this._overflowFrame = null;

    for (const tab of options.tabs ?? options.items ?? []) {
      this._addTabModel(tab);
    }

    this.activeId = this._normalizeActiveId(options.activeId ?? options.value ?? null);
    this._focusedId = this.activeId;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-tabbar", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.classList.toggle("dui-tabbar--native-overflow", !this.overflowNavigation);
    this._renderBorderedState(root);
    this._renderOrientationState(root);

    const overflow = this._getOverflowPresentation();
    const previous = this._createOverflowButton("previous", overflow.previousIcon, overflow.previousLabel);
    const viewport = document.createElement("div");
    viewport.className = "dui-tabbar__viewport dui-scrollable";

    const track = document.createElement("div");
    track.className = "dui-tabbar__track";
    track.dataset.duiFocusTarget = "true";
    track.setAttribute("role", "tablist");
    track.setAttribute("aria-label", this.name ?? this.id);
    track.setAttribute("aria-orientation", this._isVertical() ? "vertical" : "horizontal");

    const next = this._createOverflowButton("next", overflow.nextIcon, overflow.nextLabel);
    viewport.append(track);
    root.append(previous, viewport, next);

    this._viewport = viewport;
    this._track = track;
    this._previousButton = previous;
    this._nextButton = next;

    this.disposables.addEventListener(root, "click", event => {
      this._handleClick(event);
    });

    this.disposables.addEventListener(root, "keydown", event => {
      this._handleKeyDown(event);
    });

    this.disposables.addEventListener(viewport, "scroll", () => {
      this._updateOverflowState();
    });

    track.replaceChildren(...this.tabs.map(tab => this._createTabElement(tab)));

    if (typeof ResizeObserver === "function") {
      this._overflowObserver = new ResizeObserver(() => this._scheduleOverflowUpdate());
      this._overflowObserver.observe(viewport);
      this.disposables.add(() => this._overflowObserver?.disconnect());
    }

    this._renderDisabledState(root);
    this._scheduleOverflowUpdate();
    return root;
  }

  mount(container) {
    super.mount(container);
    this._syncTabbedFrameOrientation();
    return this;
  }

  refresh() {
    super.refresh();
    this._render();
    return this;
  }

  enable() {
    super.enable();
    this._renderDisabledState();
    return this;
  }

  disable() {
    super.disable();
    this._renderDisabledState();
    return this;
  }

  isBordered() {
    return this.bordered;
  }

  setBordered(bordered, options = {}) {
    this._assertMutable("setBordered");

    const oldValue = this.bordered;
    this.bordered = bordered === true;
    this._renderBorderedState();

    if (!options.silent && oldValue !== this.bordered) {
      this.events.emit("appearanceChange", {
        source: this,
        name: "bordered",
        oldValue,
        value: this.bordered,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  getOrientation() {
    return this.orientation;
  }

  setOrientation(orientation, options = {}) {
    this._assertMutable("setOrientation");

    const next = normalizeOrientation(orientation);
    const oldValue = this.orientation;

    if (next === oldValue) {
      return this;
    }

    this.orientation = next;

    if (this._viewport) {
      this._viewport.scrollLeft = 0;
      this._viewport.scrollTop = 0;
    }

    this._renderOrientationState();
    this._renderOverflowPresentation();
    this._syncTabbedFrameOrientation();
    this._updateOverflowState();
    this._scheduleOverflowUpdate();

    if (!options.silent) {
      this.events.emit("appearanceChange", {
        source: this,
        name: "orientation",
        oldValue,
        value: this.orientation,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  destroy() {
    if (this._overflowFrame != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._overflowFrame);
    }

    this._clearTabbedFrameOrientation();
    super.destroy();
    this._viewport = null;
    this._track = null;
    this._previousButton = null;
    this._nextButton = null;
    this._overflowObserver = null;
    this._overflowFrame = null;
  }

  addTab(tab, options = {}) {
    this._assertMutable("addTab");

    const item = this._addTabModel(tab);

    if (!this.activeId && !item.disabled) {
      this.activeId = item.id;
      this._focusedId = item.id;
    }

    this._render();

    if (!options.silent) {
      this.events.emit("add", {
        source: this,
        tab: item,
        id: item.id,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  updateTab(id, patch, options = {}) {
    this._assertMutable("updateTab");

    const tab = this.getTab(id);

    if (!tab) {
      return false;
    }

    Object.assign(tab, patch);
    tab.id = id;
    this._render();

    if (!options.silent) {
      this.events.emit("update", {
        source: this,
        tab,
        id,
        patch: { ...patch },
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  removeTab(id, options = {}) {
    this._assertMutable("removeTab");

    let index = this.tabs.findIndex(tab => tab.id === id);

    if (index < 0) {
      return false;
    }

    const tab = this.tabs[index];

    if (this._isCloseBlocked(tab, options)) {
      return false;
    }

    const event = {
      source: this,
      tab,
      id,
      cancel: false,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };

    if (!options.silent) {
      this.events.emit("beforeClose", event);
    }

    if (event.cancel === true || this.destroyed || this.getTab(id) !== tab) {
      return false;
    }

    // A beforeClose handler may have removed another tab or changed close policy.
    index = this.tabs.indexOf(tab);
    if (this._isCloseBlocked(tab, options)) return false;

    const nextActiveId = Object.is(this.activeId, id)
      ? this._findReplacementActiveId(index)
      : this.activeId;

    this.tabs.splice(index, 1);
    this.activeId = this._normalizeActiveId(nextActiveId);
    this._focusedId = this.activeId;
    this._render();

    if (!options.silent) {
      const closeEvent = {
        source: this,
        tab,
        id,
        activeId: this.activeId,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      };

      this.events.emit("close", closeEvent);
      if (!this.destroyed) this.events.emit("afterClose", { ...closeEvent });
    }

    return true;
  }

  clear(options = {}) {
    this._assertMutable("clear");
    const oldTabs = this.all();

    this.tabs = [];
    this.activeId = null;
    this._focusedId = null;
    this._render();

    if (!options.silent) {
      this.events.emit("clear", {
        source: this,
        tabs: oldTabs,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  setActive(id, options = {}) {
    this._assertMutable("setActive");

    const tab = this.getTab(id);

    if (!tab || tab.disabled) {
      return false;
    }

    const oldId = this.activeId;

    if (Object.is(oldId, id)) {
      this._focusedId = id;
      this._renderActiveState();
      return false;
    }

    const oldTab = oldId ? this.getTab(oldId) : null;
    const event = {
      source: this,
      oldId,
      id,
      oldTab,
      tab,
      cancel: false,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };

    if (!options.silent) {
      this.events.emit("beforeChange", event);
    }

    if (event.cancel === true || this.destroyed || this.getTab(id) !== tab ||
        tab.disabled || !Object.is(this.activeId, oldId)) {
      return false;
    }

    this.activeId = id;
    this._focusedId = id;
    this._renderActiveState();
    this._ensureTabVisible(id);

    if (!options.silent) {
      const changeEvent = {
        source: this,
        oldId,
        id,
        oldTab,
        tab,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      };

      this.events.emit("change", changeEvent);
      if (!this.destroyed) this.events.emit("afterChange", { ...changeEvent });
    }

    return true;
  }

  getActive() {
    return this.activeId ? this.getTab(this.activeId) : null;
  }

  getTab(id) {
    return this.tabs.find(tab => tab.id === id) ?? null;
  }

  all() {
    return this.tabs.map(tab => ({ ...tab }));
  }

  _addTabModel(tab) {
    const item = normalizeTab(tab, this.closable);

    if (this.getTab(item.id)) {
      throw new Error(`Duplicate tab id: ${item.id}.`);
    }

    this.tabs.push(item);
    return item;
  }

  _normalizeActiveId(id) {
    if (id && this.getTab(id) && !this.getTab(id).disabled) {
      return id;
    }

    return this.tabs.find(tab => !tab.disabled)?.id ?? null;
  }

  _render() {
    if (!this._track) {
      return;
    }

    this._track.replaceChildren(...this.tabs.map(tab => this._createTabElement(tab)));
    this._renderDisabledState();
    this._scheduleOverflowUpdate();
  }

  _createOverflowButton(direction, icon, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dui-tabbar__scroll dui-tabbar__scroll--${direction}`;
    button.dataset.duiTabScroll = direction;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.hidden = true;
    renderIcon(button, icon);
    return button;
  }

  _createTabElement(tab) {
    const item = document.createElement("div");
    item.className = "dui-tabbar__tab";
    item.dataset.duiTabId = tab.id;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-controls", tab.panelId ?? "");
    item.title = tab.title ?? tab.text ?? tab.label ?? "";

    const label = document.createElement("span");
    label.className = "dui-tabbar__label";
    label.textContent = tab.text ?? tab.label ?? tab.id;
    item.appendChild(label);

    if (tab.closeable) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "dui-tabbar__close";
      close.dataset.duiTabClose = tab.id;
      close.setAttribute("aria-label", `Close ${label.textContent}`);
      renderIcon(close, "window.close");
      item.appendChild(close);
    }

    return item;
  }

  _renderActiveState(host = this.element) {
    if (!host) {
      return;
    }

    for (const item of host.querySelectorAll(".dui-tabbar__tab")) {
      const tab = this.getTab(item.dataset.duiTabId);
      const active = Object.is(tab?.id, this.activeId);
      const focused = Object.is(tab?.id, this._focusedId ?? this.activeId);
      const disabled = tab?.disabled === true || this.disabled;

      item.classList.toggle("dui-active", active);
      item.classList.toggle("dui-disabled", disabled);
      item.setAttribute("aria-selected", active ? "true" : "false");
      item.setAttribute("aria-disabled", disabled ? "true" : "false");
      item.tabIndex = !disabled && focused ? 0 : -1;
    }
  }

  _renderDisabledState(host = this.element) {
    if (!host) {
      return;
    }

    host.classList.toggle("dui-disabled", this.disabled);
    this._renderActiveState(host);
    this._updateOverflowState();
  }

  _renderBorderedState(host = this.element) {
    if (!host) {
      return;
    }

    host.classList.toggle("dui-tabbar--bordered", this.bordered);
    host.classList.toggle("dui-tabbar--borderless", !this.bordered);
  }

  _renderOrientationState(host = this.element) {
    if (!host) {
      return;
    }

    for (const orientation of ["top", "bottom", "left", "right"]) {
      host.classList.toggle(`dui-tabbar--${orientation}`, orientation === this.orientation);
    }

    host.classList.toggle("dui-tabbar--vertical", this._isVertical());
    host.classList.toggle("dui-tabbar--horizontal", !this._isVertical());
    this._track?.setAttribute("aria-orientation", this._isVertical() ? "vertical" : "horizontal");
  }

  _renderOverflowPresentation() {
    if (!this._previousButton || !this._nextButton) {
      return;
    }

    const presentation = this._getOverflowPresentation();
    this._setOverflowButtonPresentation(
      this._previousButton,
      presentation.previousIcon,
      presentation.previousLabel
    );
    this._setOverflowButtonPresentation(
      this._nextButton,
      presentation.nextIcon,
      presentation.nextLabel
    );
  }

  _handleClick(event) {
    if (this.disabled) {
      return;
    }

    const scrollButton = event.target.closest?.("[data-dui-tab-scroll]");

    if (scrollButton && this.element.contains(scrollButton)) {
      event.preventDefault();
      this._scrollTabs(scrollButton.dataset.duiTabScroll === "previous" ? -1 : 1);
      return;
    }

    const close = event.target.closest?.("[data-dui-tab-close]");

    if (close && this.element.contains(close)) {
      event.preventDefault();
      event.stopPropagation();
      this.removeTab(close.dataset.duiTabClose, {
        origin: "user",
        userAction: true
      });
      return;
    }

    const item = event.target.closest?.(".dui-tabbar__tab");

    if (!item || !this.element.contains(item)) {
      return;
    }

    const tab = this.getTab(item.dataset.duiTabId);

    if (!tab || tab.disabled) {
      return;
    }

    this.events.emit("tabClick", {
      source: this,
      tab,
      id: tab.id,
      nativeEvent: event,
      origin: "user",
      userAction: true
    });

    if (this.destroyed || this.disabled || this.getTab(tab.id) !== tab) return;
    this.setActive(tab.id, {
      origin: "user",
      userAction: true
    });
  }

  _handleKeyDown(event) {
    if (this.disabled || this.tabs.length === 0) {
      return;
    }

    let handled = true;

    switch (event.key) {
      case "ArrowLeft":
        if (this._isVertical()) {
          handled = false;
        } else {
          this._focusOffset(-1);
        }
        break;

      case "ArrowRight":
        if (this._isVertical()) {
          handled = false;
        } else {
          this._focusOffset(1);
        }
        break;

      case "ArrowUp":
        if (this._isVertical()) {
          this._focusOffset(-1);
        } else {
          handled = false;
        }
        break;

      case "ArrowDown":
        if (this._isVertical()) {
          this._focusOffset(1);
        } else {
          handled = false;
        }
        break;

      case "Home":
        this._focusFirst();
        break;

      case "End":
        this._focusLast();
        break;

      case "Enter":
      case " ":
        if (this._focusedId) {
          this.setActive(this._focusedId, {
            origin: "user",
            userAction: true
          });
        }
        break;

      case "Delete":
        if (this._focusedId) {
          this.removeTab(this._focusedId, {
            origin: "user",
            userAction: true
          });
        }
        break;

      default:
        handled = false;
        break;
    }

    if (!handled) {
      return;
    }

    event.preventDefault();
  }

  _focusOffset(delta) {
    const enabled = this.tabs.filter(tab => !tab.disabled);

    if (enabled.length === 0) {
      return false;
    }

    const currentId = this._focusedId ?? this.activeId;
    const currentIndex = Math.max(
      0,
      enabled.findIndex(tab => tab.id === currentId)
    );
    const nextIndex = (currentIndex + delta + enabled.length) % enabled.length;

    return this._focusTab(enabled[nextIndex].id);
  }

  _focusFirst() {
    const first = this.tabs.find(tab => !tab.disabled);
    return first ? this._focusTab(first.id) : false;
  }

  _focusLast() {
    const enabled = this.tabs.filter(tab => !tab.disabled);
    const last = enabled[enabled.length - 1];
    return last ? this._focusTab(last.id) : false;
  }

  _focusTab(id) {
    const tab = this.getTab(id);

    if (!tab || tab.disabled) {
      return false;
    }

    this._focusedId = id;
    this._renderActiveState();
    this.element
      ?.querySelector(`[data-dui-tab-id="${cssEscape(id)}"]`)
      ?.focus({ preventScroll: true });
    this._ensureTabVisible(id);
    return true;
  }

  _scrollTabs(direction) {
    if (!this._viewport) {
      return false;
    }

    const vertical = this._isVertical();
    const clientSize = vertical ? this._viewport.clientHeight : this._viewport.clientWidth;
    const amount = direction * Math.min(this.scrollStep, Math.max(48, clientSize * 0.75));
    this._viewport.scrollBy(vertical
      ? { top: amount, behavior: "smooth" }
      : { left: amount, behavior: "smooth" });
    return true;
  }

  _ensureTabVisible(id, behavior = "smooth") {
    if (!this._viewport || !this._track) {
      return;
    }

    const item = this._track.querySelector(`[data-dui-tab-id="${cssEscape(id)}"]`);

    if (!item) {
      return;
    }

    const vertical = this._isVertical();
    const viewportStart = vertical ? this._viewport.scrollTop : this._viewport.scrollLeft;
    const viewportSize = vertical ? this._viewport.clientHeight : this._viewport.clientWidth;
    const itemStart = vertical ? item.offsetTop : item.offsetLeft;
    const itemSize = vertical ? item.offsetHeight : item.offsetWidth;
    const itemEnd = itemStart + itemSize;

    if (itemStart < viewportStart) {
      this._viewport.scrollTo(vertical
        ? { top: itemStart, behavior }
        : { left: itemStart, behavior });
    } else if (itemEnd > viewportStart + viewportSize) {
      const target = itemEnd - viewportSize;
      this._viewport.scrollTo(vertical
        ? { top: target, behavior }
        : { left: target, behavior });
    }
  }

  _scheduleOverflowUpdate() {
    if (!this.element) {
      return;
    }

    if (typeof requestAnimationFrame !== "function") {
      this._updateOverflowState();
      return;
    }

    if (this._overflowFrame != null) {
      cancelAnimationFrame(this._overflowFrame);
    }

    this._overflowFrame = requestAnimationFrame(() => {
      this._overflowFrame = null;
      this._updateOverflowState();
      this._ensureTabVisible(this.activeId, "auto");
    });
  }

  _updateOverflowState() {
    if (!this._viewport || !this._previousButton || !this._nextButton) {
      return;
    }

    const vertical = this._isVertical();
    const scrollPosition = vertical ? this._viewport.scrollTop : this._viewport.scrollLeft;
    const scrollSize = vertical ? this._viewport.scrollHeight : this._viewport.scrollWidth;
    const clientSize = vertical ? this._viewport.clientHeight : this._viewport.clientWidth;
    const maxScroll = Math.max(0, scrollSize - clientSize);
    const hasOverflow = this.overflowNavigation && maxScroll > 1;
    this.element?.classList.toggle("dui-tabbar--overflowing", hasOverflow);
    this._previousButton.hidden = !hasOverflow;
    this._nextButton.hidden = !hasOverflow;
    this._previousButton.disabled = this.disabled || !hasOverflow || scrollPosition <= 1;
    this._nextButton.disabled =
      this.disabled || !hasOverflow || scrollPosition >= maxScroll - 1;
  }

  _getOverflowPresentation() {
    return this._isVertical()
      ? {
          previousIcon:"chevron-up",
          previousLabel:"Scroll tabs up",
          nextIcon:"chevron-down",
          nextLabel:"Scroll tabs down"
        }
      : {
          previousIcon:"chevron-left",
          previousLabel:"Scroll tabs left",
          nextIcon:"chevron-right",
          nextLabel:"Scroll tabs right"
        };
  }

  _setOverflowButtonPresentation(button, icon, label) {
    const hidden = button.hidden;
    button.setAttribute("aria-label", label);
    button.title = label;
    renderIcon(button, icon);
    button.hidden = hidden;
  }

  _isVertical() {
    return this.orientation === "left" || this.orientation === "right";
  }

  _syncTabbedFrameOrientation() {
    const frame = this.element?.parentElement;

    if (!frame?.classList.contains("dui-tabbed-frame")) {
      return;
    }

    for (const orientation of ["top", "bottom", "left", "right"]) {
      frame.classList.toggle(`dui-tabbed-frame--${orientation}`, orientation === this.orientation);
    }
  }

  _clearTabbedFrameOrientation() {
    const frame = this.element?.parentElement;

    if (!frame?.classList.contains("dui-tabbed-frame")) {
      return;
    }

    for (const orientation of ["top", "bottom", "left", "right"]) {
      frame.classList.remove(`dui-tabbed-frame--${orientation}`);
    }
  }

  _isCloseBlocked(tab, options) {
    if (options.force === true) {
      return false;
    }

    if (!tab.closeable) {
      return true;
    }

    if (this.allowCloseLast) {
      return false;
    }

    return this.tabs.length <= 1 && options.force !== true;
  }

  _findReplacementActiveId(removedIndex) {
    const candidates = this.tabs
      .map((tab, index) => ({ tab, index }))
      .filter(item => item.tab.id !== this.activeId && !item.tab.disabled);

    if (candidates.length === 0) {
      return null;
    }

    const after = candidates.find(item => item.index > removedIndex);
    return (after ?? candidates[candidates.length - 1]).tab.id;
  }
}

function normalizeTab(tab, defaultCloseable) {
  if (!tab || typeof tab !== "object") {
    throw new TypeError("TabBar tab must be an object.");
  }

  const id = tab.id ?? tab.name ?? `tab-${nextTabId++}`;

  return {
    id,
    text: tab.text ?? tab.label ?? id,
    label: tab.label ?? tab.text ?? id,
    title: tab.title ?? "",
    panelId: tab.panelId ?? null,
    disabled: tab.disabled === true,
    closeable: tab.closeable ?? defaultCloseable,
    data: tab.data ?? null
  };
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(value);
  }

  return String(value).replaceAll('"', '\\"');
}

function normalizeOrientation(orientation) {
  const normalized = String(orientation).toLowerCase();

  if (!["top", "bottom", "left", "right"].includes(normalized)) {
    throw new TypeError('TabBar orientation must be "top", "bottom", "left", or "right".');
  }

  return normalized;
}
