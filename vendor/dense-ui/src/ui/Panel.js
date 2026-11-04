import { BaseControl } from "../core/BaseControl.js";

export class Panel extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.controls = Object.create(null);
    this.items = [];
    this.css = options.css ?? "";
    this.className = options.className ?? "";
    this.bordered = options.bordered === true || options.border === true;
    this.scroll = normalizeScrollMode(
      options.scroll ?? (options.autoScroll === true ? "auto" : "visible")
    );
    this.padding = options.padding ?? null;
    this.observeResize = options.observeResize !== false;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-panel", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    this._applyPanelAppearance(root);
    return root;
  }

  getContentElement() {
    return this.element;
  }

  add(...controls) {
    this._assertMutable("add");

    for (const control of controls.flat()) {
      if (this.destroyed || this._destroying) break;
      this.attach(control);
    }

    return this;
  }

  attach(control, options = {}) {
    this._assertMutable("attach");
    this._assertControl(control);

    this._preflightControl(control);
    const host = options.container ?? this.getContentElement();
    if (this.items.includes(control) && control.mounted) {
      if (control.element?.parentElement !== host) throw new Error("Control is already mounted into another container.");
      return control;
    }

    const beforeEvent = this._createChildEvent("beforeChildAdd", control, options, {
      cancel: false
    });

    this.events.emit("beforeChildAdd", beforeEvent);

    if (beforeEvent.cancel === true || this.destroyed || control.destroyed) {
      return null;
    }

    if (!host) throw new Error("Container control must be mounted before attaching child controls.");

    // Before callbacks may have changed ownership or claimed a registry key.
    this._preflightControl(control);
    const wasMounted = control.mounted;

    try {
      if (!control.mounted) {
        control.mount(host);
      } else if (control.element?.parentElement !== host) {
        throw new Error(`Control ${control.id} is already mounted into another container.`);
      }

      if (this.destroyed || this._destroying || control.destroyed) {
        if (!wasMounted && !control.destroyed && !control.parent) control.destroy();
        return null;
      }
      this.addControl(control);
    } catch (error) {
      // A mount callback can claim a key reentrantly. Discard only the
      // transient child mounted by this attempt; borrowed/foreign owners stay intact.
      if (!wasMounted && !control.destroyed && !control.parent && control.mounted) {
        try { control.destroy(); } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Attach failed and transient child cleanup failed.");
        }
      }
      throw error;
    }
    this.events.emit("childAdd", this._createChildEvent("childAdd", control, options));
    return this.destroyed || this._destroying || control.destroyed || control.parent !== this ? null : control;
  }

  addControl(control) {
    this._assertMutable("addControl");
    this._assertControl(control);

    this._preflightControl(control);

    if (!this.items.includes(control)) {
      this.items.push(control);
    }

    control._setParent?.(this);
    this._registerControlKey(control.id, control);

    if (control.name) {
      this._registerControlKey(control.name, control);
    }

    return control;
  }

  getItem(name) {
    return this.controls[name] ?? null;
  }

  getItems() {
    return [...this.items];
  }

  getItemAt(index) {
    return this.items[index] ?? null;
  }

  hasItem(controlOrName) {
    return this.indexOf(controlOrName) !== -1;
  }

  indexOf(controlOrName) {
    const control =
      typeof controlOrName === "string" ? this.getItem(controlOrName) : controlOrName;

    return control ? this.items.indexOf(control) : -1;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  isBordered() {
    return this.bordered;
  }

  setBordered(bordered, options = {}) {
    this._assertMutable("setBordered");

    const oldValue = this.bordered;
    this.bordered = bordered === true;
    this._applyPanelAppearance();
    this._emitAppearanceChange("bordered", oldValue, this.bordered, options);
    return this;
  }

  getScrollMode() {
    return this.scroll;
  }

  setScrollMode(scroll, options = {}) {
    this._assertMutable("setScrollMode");

    const oldValue = this.scroll;
    this.scroll = normalizeScrollMode(scroll);
    this._applyPanelAppearance();
    this._emitAppearanceChange("scroll", oldValue, this.scroll, options);
    return this;
  }

  getPadding() {
    return this.padding;
  }

  setPadding(padding, options = {}) {
    this._assertMutable("setPadding");

    const oldValue = this.padding;
    this.padding = padding ?? null;
    this._applyPanelAppearance();
    this._emitAppearanceChange("padding", oldValue, this.padding, options);
    return this;
  }

  remove(controlOrName, options = {}) {
    this._assertMutable("remove");

    const control =
      typeof controlOrName === "string" ? this.getItem(controlOrName) : controlOrName;

    if (!control || !this.items.includes(control)) {
      return null;
    }

    const index = this.items.indexOf(control);
    const beforeEvent = this._createChildEvent("beforeChildRemove", control, options, {
      index,
      cancel: false
    });

    if (!this._destroying) {
      this.events.emit("beforeChildRemove", beforeEvent);
    }

    if (beforeEvent.cancel === true || this.destroyed) {
      return null;
    }

    this._forgetControl(control);
    control.destroy();

    if (!this._destroying && !this.destroyed) {
      this.events.emit("childRemove", this._createChildEvent("childRemove", control, options, {
        index
      }));
    }
    return control;
  }

  clear() {
    this._assertMutable("clear");

    for (const child of [...this.items].reverse()) {
      if (this.destroyed || this._destroying) break;
      this.remove(child);
    }

    return this;
  }

  destroy() {
    if (this.destroyed || this._destroying) return;

    // Terminal ownership cleanup cannot be vetoed as a user-facing removal.
    // Keep the guard active while child disposables run; they may reenter us.
    this._destroying = true;
    try {
      this._destroyChildren();
    } finally {
      this._destroying = false;
      super.destroy();
    }
  }

  _destroyChildren() {
    let firstError;
    for (const child of [...this.items].reverse()) {
      this._forgetControl(child);
      try { child.destroy(); } catch (error) { firstError ??= error; }
    }
    if (firstError) throw firstError;
  }

  _preflightControl(control) {
    if (control.destroyed || control._destroying) throw new Error("Cannot attach destroyed control " + control.id + ".");
    if (control === this || this.isChildOf(control)) throw new Error("A control cannot own itself or an ancestor.");
    if (control.parent && control.parent !== this) throw new Error("Control " + control.id + " already belongs to another parent.");
    for (const key of [control.id, control.name]) {
      if (key && this.controls[key] && this.controls[key] !== control) throw new Error("Duplicate child control key: " + key + ".");
    }
  }

  _afterResize(event) {
    for (const child of [...this.items]) {
      if (this.destroyed || this._destroying) break;
      if (child.destroyed || child._destroying || !this.items.includes(child)) continue;
      child._handleParentResize?.(event);
    }
  }

  _assertControl(control) {
    if (!control || typeof control.mount !== "function" || typeof control.destroy !== "function") {
      throw new TypeError("Container controls accept Control instances.");
    }
  }

  _createChildEvent(type, control, options = {}, extra = {}) {
    return {
      source: this,
      type,
      control,
      controlId: control.id,
      controlName: control.name ?? null,
      index: this.items.indexOf(control),
      origin: options.origin ?? "api",
      userAction: options.userAction === true,
      ...extra
    };
  }

  _applyPanelAppearance(element = this.element) {
    if (!element) {
      return;
    }

    element.classList.toggle("dui-panel--bordered", this.bordered);
    element.classList.toggle("dui-panel--borderless", !this.bordered);

    for (const mode of ["visible", "hidden", "auto", "x", "y"]) {
      element.classList.toggle(`dui-panel--scroll-${mode}`, this.scroll === mode);
    }

    if (this.padding == null) {
      element.style.padding = "";
    } else {
      element.style.padding = typeof this.padding === "number" ? `${this.padding}px` : String(this.padding);
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

  _registerControlKey(key, control) {
    if (!key) {
      return;
    }

    const existing = this.controls[key];

    if (existing && existing !== control) {
      throw new Error(`Duplicate child control key: ${key}.`);
    }

    this.controls[key] = control;
  }

  _forgetControl(control) {
    this.items = this.items.filter(item => item !== control);

    for (const [key, value] of Object.entries(this.controls)) {
      if (value === control) {
        delete this.controls[key];
      }
    }

    control._setParent?.(null);
  }
}

function normalizeScrollMode(value) {
  const mode = value ?? "visible";
  const normalized = String(mode);

  if (!["visible", "hidden", "auto", "x", "y"].includes(normalized)) {
    throw new TypeError("Panel scroll mode must be visible, hidden, auto, x, or y.");
  }

  return normalized;
}
