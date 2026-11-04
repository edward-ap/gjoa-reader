import { DisposableBag } from "./DisposableBag.js";
import { EventBus } from "./EventBus.js";
import { LifecycleError } from "./LifecycleError.js";

let nextControlId = 1;

export class BaseControl {
  constructor(options = {}) {
    this.name = options.name ?? options.id ?? null;
    this.id = options.id ?? options.name ?? `dui-control-${nextControlId++}`;
    this.options = options;

    this.element = null;
    this.parent = null;
    this.events = new EventBus();
    this.disposables = new DisposableBag();

    this.mounted = false;
    this.disabled = options.disabled === true;
    this.visible = options.visible !== false && options.hidden !== true;
    this.width = options.width ?? null;
    this.height = options.height ?? null;
    this.tabIndex = normalizeTabIndex(options.tabIndex);
    this.observeResize =
      options.observeResize === true || typeof options.onResize === "function";
    this.destroyed = false;
    this._destroying = false;
    this._resizeObserver = null;
    this._lastSize = null;
    this._focused = false;
    this._pendingFocusEventOptions = null;
    this._interactiveEventsAttached = false;
    this._states = new Map();

    this.state = Object.freeze({
      get: name => this._getState(name),
      set: (name, value = true, options) => this._setState(name, value, options),
      clear: (name, options) => this._clearState(name, options),
      has: name => this._states.has(name),
      all: () => Object.fromEntries(this._states)
    });

    this._bindOptionEvent("resize", options.onResize);
    this._bindOptionEvent("parentResize", options.onParentResize);
    this._bindOptionEvent("focus", options.onFocus);
    this._bindOptionEvent("blur", options.onBlur);
    this._bindOptionEvent("keyDown", options.onKeyDown);
    this._bindOptionEvent("keyUp", options.onKeyUp);
  }

  mount(container) {
    this._assertMutable("mount");

    const host = this._resolveContainer(container);

    if (this.mounted) {
      if (this.element?.parentElement === host) {
        return this;
      }

      throw new LifecycleError(
        `Cannot mount already mounted control ${this.id} into another container.`,
        this,
        "mount"
      );
    }

    if (!this.element) {
      const element = this.createElement();
      // A renderer or child mount may synchronously destroy its owner.
      if (this.destroyed) {
        element?.remove();
        return this;
      }
      this.element = element;
    }

    this._applySizeState();
    this._applyTabIndexState();
    this._wireInteractiveEvents();
    host.appendChild(this.element);
    this.mounted = true;
    this._applyVisibilityState();
    this._applyStateClasses();
    this._startResizeObserver();

    if (this.disabled) {
      this._applyDisabledState();
    }

    return this;
  }

  createElement() {
    const element = document.createElement("div");
    element.className = "dui-control";
    element.dataset.duiControlId = this.id;
    return element;
  }

  refresh() {
    this._assertMutable("refresh");
  }

  enable() {
    this._assertMutable("enable");
    this.disabled = false;
    this._applyDisabledState();
  }

  disable() {
    this._assertMutable("disable");
    this.disabled = true;
    this._applyDisabledState();
  }

  show(options = {}) {
    this._assertMutable("show");

    if (this.visible) {
      return this;
    }

    const beforeEvent = this._createVisibilityEvent("beforeShow", options, {
      cancel: false
    });

    this.events.emit("beforeShow", beforeEvent);

    if (beforeEvent.cancel || this.destroyed || this._destroying) {
      return this;
    }

    this.visible = true;
    this._applyVisibilityState();

    const event = this._createVisibilityEvent("show", options);
    this.events.emit("show", event);
    if (this.destroyed || this._destroying) return this;
    this.events.emit("afterShow", this._createVisibilityEvent("afterShow", options));

    return this;
  }

  hide(options = {}) {
    this._assertMutable("hide");

    if (!this.visible) {
      return this;
    }

    const beforeEvent = this._createVisibilityEvent("beforeHide", options, {
      cancel: false
    });

    this.events.emit("beforeHide", beforeEvent);

    if (beforeEvent.cancel || this.destroyed || this._destroying) {
      return this;
    }

    this.visible = false;
    this._applyVisibilityState();

    const event = this._createVisibilityEvent("hide", options);
    this.events.emit("hide", event);
    if (this.destroyed || this._destroying) return this;
    this.events.emit("afterHide", this._createVisibilityEvent("afterHide", options));

    return this;
  }

  isVisible() {
    return this.visible;
  }

  getParent() {
    return this.parent;
  }

  isChildOf(parent) {
    let current = this.parent;

    while (current) {
      if (current === parent) {
        return true;
      }

      current = current.parent;
    }

    return false;
  }

  getSize() {
    if (!this.element) {
      return {
        width: this.width,
        height: this.height
      };
    }

    return {
      width: this.element.offsetWidth,
      height: this.element.offsetHeight
    };
  }

  setSize(widthOrSize, heightOrOptions, maybeOptions = {}) {
    this._assertMutable("setSize");

    const oldSize = this.getSize();
    const size = normalizeSizeArguments(widthOrSize, heightOrOptions);
    const options =
      heightOrOptions !== null && typeof heightOrOptions === "object" && !Array.isArray(heightOrOptions)
        ? heightOrOptions
        : maybeOptions;

    if (Object.prototype.hasOwnProperty.call(size, "width")) {
      this.width = size.width;
    }

    if (Object.prototype.hasOwnProperty.call(size, "height")) {
      this.height = size.height;
    }

    this._applySizeState();
    this._emitResizeIfChanged(oldSize, this.getSize(), {
      origin: options.origin ?? "api",
      userAction: options.userAction === true,
      silent: options.silent === true
    });

    return this;
  }

  _getState(name) {
    return this._states.get(name);
  }

  _setState(name, value = true, options = {}) {
    this._assertMutable("state.set");
    assertStateName(name);

    const oldValue = this._states.get(name);
    this._states.set(name, value);
    this._applyStateClasses();
    this._afterStateChange(name, value, oldValue, options);

    if (!options.silent && oldValue !== value) {
      this.events.emit("stateChange", {
        source: this,
        name,
        oldValue,
        value,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  _clearState(name, options = {}) {
    this._assertMutable("state.clear");
    assertStateName(name);

    if (!this._states.has(name)) {
      return this;
    }

    const oldValue = this._states.get(name);
    this._states.delete(name);
    this._applyStateClasses();
    this._afterStateChange(name, undefined, oldValue, options);

    if (!options.silent) {
      this.events.emit("stateChange", {
        source: this,
        name,
        oldValue,
        value: undefined,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  getFocusElement() {
    if (!this.element) {
      return null;
    }

    if (this.element.hasAttribute("data-dui-focus-target")) {
      return this.element;
    }

    const candidates = this.element.querySelectorAll("[data-dui-focus-target]");
    for (const candidate of candidates) {
      if (candidate.closest("[data-dui-control-id]") === this.element) {
        return candidate;
      }
    }

    return this.element;
  }

  canFocus() {
    if (this.destroyed || this.disabled || !this.visible || !this.mounted || !this.element) {
      return false;
    }

    const focusTarget = this.getFocusElement();

    return isFocusableElement(focusTarget);
  }

  focus(options = {}) {
    if (!this.canFocus()) {
      return false;
    }

    const focusTarget = this.getFocusElement();

    this._pendingFocusEventOptions = {
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };

    focusTarget.focus({
      preventScroll: options.preventScroll === true
    });
    this._pendingFocusEventOptions = null;

    return document.activeElement === focusTarget;
  }

  blur(options = {}) {
    if (this.destroyed || !this.element) {
      return false;
    }

    const focusTarget = this.getFocusElement();

    if (!this.isFocused() || !focusTarget || typeof focusTarget.blur !== "function") {
      return false;
    }

    this._pendingFocusEventOptions = {
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };

    focusTarget.blur();
    this._pendingFocusEventOptions = null;

    return !this.isFocused();
  }

  isFocused() {
    if (!this.element || typeof document === "undefined") {
      return false;
    }

    return this.element.contains(document.activeElement);
  }

  setTabIndex(tabIndex) {
    this._assertMutable("setTabIndex");
    this.tabIndex = normalizeTabIndex(tabIndex);
    this._applyTabIndexState();
    return this;
  }

  getTabIndex() {
    return this.tabIndex;
  }

  destroy() {
    if (this.destroyed || this._destroying) {
      return;
    }

    this._destroying = true;
    this._stopResizeObserver();
    this.disposables.dispose();

    if (this.parent && typeof this.parent._forgetControl === "function") {
      this.parent._forgetControl(this);
    }

    if (this.element) {
      this.element.remove();
      this.element = null;
    }

    this.mounted = false;
    this.parent = null;
    this.destroyed = true;
    this._destroying = false;
    this.events.destroy();
  }

  _applyDisabledState() {
    if (!this.element) {
      return;
    }

    this.element.classList.toggle("dui-disabled", this.disabled);

    if (this.disabled) {
      this.element.setAttribute("aria-disabled", "true");
    } else {
      this.element.removeAttribute("aria-disabled");
    }
  }

  _applyVisibilityState() {
    if (!this.element) {
      return;
    }

    this.element.hidden = !this.visible;
    this.element.classList.toggle("dui-hidden", !this.visible);

    if (this.visible) {
      this.element.removeAttribute("aria-hidden");
    } else {
      this.element.setAttribute("aria-hidden", "true");
    }
  }

  _applySizeState() {
    if (!this.element) {
      return;
    }

    applyOptionalCssSize(this.element, "width", this.width);
    applyOptionalCssSize(this.element, "height", this.height);
  }

  _applyTabIndexState() {
    if (!this.element) {
      return;
    }

    const focusTarget = this.getFocusElement();

    if (!focusTarget) {
      return;
    }

    if (this.tabIndex == null) {
      focusTarget.removeAttribute("tabindex");
    } else {
      focusTarget.tabIndex = this.tabIndex;
    }
  }

  _applyStateClasses() {
    if (!this.element) {
      return;
    }

    for (const stateName of ["invalid", "warning", "readonly", "required", "focused", "dirty"]) {
      this.element.classList.toggle(`dui-${stateName}`, this._states.has(stateName));
    }
  }

  _afterStateChange(_name, _value, _oldValue, _options) {}

  _createVisibilityEvent(type, options = {}, extra = {}) {
    return {
      source: this,
      origin: options.origin ?? "api",
      userAction: options.userAction === true,
      type,
      ...extra
    };
  }

  _wireInteractiveEvents() {
    if (!this.element || this._interactiveEventsAttached) {
      return;
    }

    this._interactiveEventsAttached = true;

    this.disposables.addEventListener(
      this.element,
      "focusin",
      event => {
        if (this.destroyed || this._destroying) return;
        if (this._focused) {
          return;
        }

        const eventOptions = this._pendingFocusEventOptions ?? {
          origin: "user",
          userAction: true
        };

        this._focused = true;
        this.state.set("focused", true, { silent: true, origin: "user" });
        this._emitFocusEvent("focus", {
          origin: eventOptions.origin,
          userAction: eventOptions.userAction,
          nativeEvent: event,
          relatedTarget: event.relatedTarget ?? null
        });
      },
      true
    );

    this.disposables.addEventListener(
      this.element,
      "focusout",
      event => {
        if (this.destroyed || this._destroying) return;
        if (event.relatedTarget && this.element?.contains(event.relatedTarget)) {
          return;
        }

        const eventOptions = this._pendingFocusEventOptions ?? {
          origin: "user",
          userAction: true
        };

        this._focused = false;
        this.state.clear("focused", { silent: true, origin: "user" });
        this._emitFocusEvent("blur", {
          origin: eventOptions.origin,
          userAction: eventOptions.userAction,
          nativeEvent: event,
          relatedTarget: event.relatedTarget ?? null
        });
      },
      true
    );

    this.disposables.addEventListener(
      this.element,
      "keydown",
      event => {
        const keyEvent = this._emitKeyEvent("keyDown", event);

        if (keyEvent.cancel) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );

    this.disposables.addEventListener(
      this.element,
      "keyup",
      event => {
        const keyEvent = this._emitKeyEvent("keyUp", event);

        if (keyEvent.cancel) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
  }

  _emitFocusEvent(type, options = {}) {
    this.events.emit(type, {
      source: this,
      type,
      origin: options.origin ?? "api",
      userAction: options.userAction === true,
      nativeEvent: options.nativeEvent,
      relatedTarget: options.relatedTarget ?? null
    });
  }

  _emitKeyEvent(type, nativeEvent) {
    return this.events.emit(type, {
      source: this,
      type,
      key: nativeEvent.key,
      code: nativeEvent.code,
      altKey: nativeEvent.altKey,
      ctrlKey: nativeEvent.ctrlKey,
      shiftKey: nativeEvent.shiftKey,
      metaKey: nativeEvent.metaKey,
      repeat: nativeEvent.repeat,
      origin: "user",
      userAction: true,
      nativeEvent,
      cancel: false
    });
  }

  _setParent(parent) {
    this.parent = parent;
  }

  _startResizeObserver() {
    if (
      !this.observeResize ||
      !this.element ||
      this._resizeObserver ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    this._lastSize = this.getSize();

    this._resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      const newSize = {
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height)
      };

      this._emitResizeIfChanged(this._lastSize, newSize, {
        origin: "system",
        reason: "observer",
        userAction: false
      });
    });

    this._resizeObserver.observe(this.element);
  }

  _stopResizeObserver() {
    if (!this._resizeObserver) {
      return;
    }

    this._resizeObserver.disconnect();
    this._resizeObserver = null;
  }

  _emitResizeIfChanged(oldSize, newSize, options = {}) {
    if (!newSize || sizesEqual(oldSize, newSize)) {
      return null;
    }

    this._lastSize = newSize;

    if (options.silent) {
      return null;
    }

    const event = {
      source: this,
      oldSize,
      newSize,
      width: newSize.width,
      height: newSize.height,
      origin: options.origin ?? "api",
      reason: options.reason,
      userAction: options.userAction === true
    };

    this.events.emit("resize", event);
    if (!this.destroyed && !this._destroying) this._afterResize(event);
    return event;
  }

  _afterResize(_event) {}

  _handleParentResize(parentEvent) {
    const event = {
      source: this,
      parent: parentEvent.source,
      parentEvent,
      size: this.getSize(),
      origin: parentEvent.origin,
      userAction: parentEvent.userAction === true
    };

    this.events.emit("parentResize", event);
    if (!this.destroyed && !this._destroying) this._afterParentResize(event);
  }

  _afterParentResize(_event) {}

  _resolveContainer(container) {
    if (typeof container === "string") {
      const found = document.querySelector(container);

      if (!found) {
        throw new Error(`Container not found: ${container}`);
      }

      return found;
    }

    if (container instanceof HTMLElement) {
      return container;
    }

    throw new TypeError("Container must be an HTMLElement or selector string.");
  }

  _assertMutable(operation) {
    if (this.destroyed || this._destroying) {
      throw new LifecycleError(
        `Cannot call ${operation}() on destroyed control ${this.id}.`,
        this,
        operation
      );
    }
  }

  _bindOptionEvent(eventName, handler) {
    if (handler == null) {
      return null;
    }

    if (typeof handler !== "function") {
      throw new TypeError(`${eventName} option handler must be a function.`);
    }

    return this.disposables.add(this.events.on(eventName, handler));
  }
}

function normalizeSizeArguments(widthOrSize, heightOrOptions) {
  if (widthOrSize && typeof widthOrSize === "object" && !Array.isArray(widthOrSize)) {
    return widthOrSize;
  }

  const size = {};

  if (widthOrSize !== undefined) {
    size.width = widthOrSize;
  }

  if (heightOrOptions === null || (heightOrOptions !== undefined && typeof heightOrOptions !== "object")) {
    size.height = heightOrOptions;
  }

  return size;
}

function applyOptionalCssSize(element, property, value) {
  if (value == null) {
    element.style[property] = "";
    return;
  }

  element.style[property] = typeof value === "number" ? `${value}px` : String(value);
}

function normalizeTabIndex(value) {
  if (value == null) {
    return null;
  }

  const tabIndex = Number(value);

  if (!Number.isInteger(tabIndex)) {
    throw new TypeError("tabIndex must be an integer or null.");
  }

  return tabIndex;
}

function isFocusableElement(element) {
  if (!element || typeof element.focus !== "function") {
    return false;
  }

  if (element.hidden || element.closest?.("[hidden]")) {
    return false;
  }

  if (element.disabled === true) {
    return false;
  }

  const tagName = element.tagName;

  if (element.isContentEditable) {
    return true;
  }

  if (element.hasAttribute("tabindex")) {
    return element.tabIndex >= -1;
  }

  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tagName)) {
    return true;
  }

  if (tagName === "A" && element.hasAttribute("href")) {
    return true;
  }

  return false;
}

function sizesEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  return a.width === b.width && a.height === b.height;
}

function assertStateName(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("State name must be a non-empty string.");
  }
}
