import { BaseControl } from "../core/BaseControl.js";
import { overlayManager } from "../core/OverlayManager.js";
import { createIcon } from "./Icon.js";

let nextMenuItemId = 1;

export class Menu extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.commands = options.commands ?? null;
    this.css = options.css ?? "";
    this.className = options.className ?? "";
    this.items = normalizeItems(options.items ?? []);
    this.overlayManager = options.overlayManager ?? overlayManager;
    this._itemsById = new Map();
    this._openPopups = [];
    this._focusedRootIndex = 0;
    this._commandSubscription = null;

    if (this.commands) {
      this._commandSubscription = this.disposables.add(
        this.commands.events.on("stateChange", () => {
          this._render();
        })
      );
    }

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("nav");
    root.className = ["dui-control", "dui-menu", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiFocusTarget = "true";
    root.setAttribute("role", "menubar");
    root.setAttribute("aria-label", this.name ?? this.id);

    this.disposables.addEventListener(root, "click", event => {
      this._handleClick(event);
    });

    this.disposables.addEventListener(root, "keydown", event => {
      this._handleKeyDown(event);
    });

    this._renderInto(root);
    return root;
  }

  refresh() {
    super.refresh();
    this._render();
    return this;
  }

  destroy() {
    if (this.destroyed || this._destroying) return;
    this.close({
      silent: true,
      origin: "system"
    });
    super.destroy();
    this._itemsById.clear();
    this._commandSubscription = null;
  }

  setItems(items) {
    this._assertMutable("setItems");
    this.close({
      silent: true,
      origin: "system"
    });
    this.items = normalizeItems(items);
    this._focusedRootIndex = 0;
    this._render();
    return this;
  }

  addItem(item) {
    this._assertMutable("addItem");
    this.items.push(normalizeItem(item));
    this._render();
    return this;
  }

  addCommand(commandId, options = {}) {
    this._assertMutable("addCommand");
    this.addItem({
      ...options,
      command: commandId
    });
    return this;
  }

  addSeparator() {
    this._assertMutable("addSeparator");
    this.addItem({
      type: "separator"
    });
    return this;
  }

  close(options = {}) {
    this._assertMutable("close");

    if (this._openPopups.length === 0) {
      return false;
    }

    const event = {
      source: this,
      cancel: false,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };

    if (!options.silent) {
      this.events.emit("beforeClose", event);
    }

    if (event.cancel === true || this.destroyed) {
      return false;
    }

    this._clearPopups();
    this._renderActiveState();

    if (!options.silent) {
      this.events.emit("close", {
        source: this,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  _render() {
    if (!this.element) {
      return;
    }

    this._clearPopups();
    this._renderInto(this.element);
  }

  _renderInto(root) {
    this._itemsById.clear();
    root.replaceChildren();

    for (const item of this._visibleItems(this.items)) {
      const element = this._createMenuItem(item, {
        root: true
      });
      root.appendChild(element);
    }

    this._renderActiveState(root);
  }

  _createMenuItem(item, options = {}) {
    const state = this._getItemState(item);
    const element = document.createElement(item.type === "separator" ? "div" : "button");
    element.dataset.duiMenuItemId = item.id;

    this._itemsById.set(item.id, item);

    if (item.type === "separator") {
      element.className = "dui-menu__separator";
      element.setAttribute("role", "separator");
      return element;
    }

    element.className = [
      options.root ? "dui-menu__root-item" : "dui-menu__item",
      item.items?.length ? "dui-menu__item--submenu" : "",
      state.checked ? "dui-checked" : "",
      state.enabled ? "" : "dui-disabled"
    ]
      .filter(Boolean)
      .join(" ");

    element.type = "button";
    element.disabled = !state.enabled;
    element.hidden = !state.visible;
    element.setAttribute("role", item.checked != null || state.checked ? "menuitemcheckbox" : "menuitem");
    element.setAttribute("aria-disabled", state.enabled ? "false" : "true");
    element.setAttribute("aria-checked", state.checked ? "true" : "false");
    element.tabIndex = options.root ? 0 : -1;

    const check = document.createElement("span");
    check.className = "dui-menu__check";
    check.setAttribute("aria-hidden", "true");
    const itemIcon = state.checked ? "check" : state.icon;
    if (itemIcon) check.append(createIcon(itemIcon));

    const label = document.createElement("span");
    label.className = "dui-menu__label";
    label.textContent = state.label;

    const shortcut = document.createElement("span");
    shortcut.className = "dui-menu__shortcut";
    shortcut.textContent = state.shortcut ?? "";

    const arrow = document.createElement("span");
    arrow.className = "dui-menu__arrow";
    arrow.setAttribute("aria-hidden", "true");
    if (item.items?.length) arrow.append(createIcon("chevron-right"));

    if (options.root) {
      element.replaceChildren(label);
    } else {
      element.replaceChildren(check, label, shortcut, arrow);
    }

    return element;
  }

  _handleClick(event) {
    if (this.disabled) {
      return;
    }

    const element = event.target.closest?.("[data-dui-menu-item-id]");

    if (!element || !this.element?.contains(element)) {
      return;
    }

    const item = this._itemsById.get(element.dataset.duiMenuItemId);

    if (!item || !this._getItemState(item).enabled) {
      return;
    }

    if (item.items?.length) {
      this._openSubmenu(item, element, 0, {
        origin: "user",
        userAction: true
      });
      return;
    }

    this._executeItem(item, {
      origin: "user",
      userAction: true
    });
  }

  _handleKeyDown(event) {
    if (this.disabled) {
      return;
    }

    const roots = this._getRootElements();

    if (roots.length === 0) {
      return;
    }

    let handled = true;

    switch (event.key) {
      case "ArrowRight":
        this._focusRoot(1);
        break;

      case "ArrowLeft":
        this._focusRoot(-1);
        break;

      case "Home":
        this._focusRootIndex(0);
        break;

      case "End":
        this._focusRootIndex(roots.length - 1);
        break;

      case "ArrowDown":
      case "Enter":
      case " ":
        this._openFocusedRoot({
          origin: "user",
          userAction: true
        });
        break;

      case "Escape":
        this.close({
          origin: "user",
          userAction: true
        });
        break;

      default:
        handled = false;
        break;
    }

    if (handled) {
      event.preventDefault();
    }
  }

  _openFocusedRoot(options = {}) {
    const roots = this._getRootElements();
    const root = roots[this._focusedRootIndex] ?? roots[0];
    const item = root ? this._itemsById.get(root.dataset.duiMenuItemId) : null;

    if (!item) {
      return false;
    }

    if (item.items?.length) {
      this._openSubmenu(item, root, 0, options);
      return true;
    }

    this._executeItem(item, options);
    return true;
  }

  _openSubmenu(item, anchor, depth = 0, options = {}) {
    const visible = this._visibleItems(item.items ?? []);

    if (visible.length === 0) {
      return false;
    }

    this._clearPopups(depth);

    const event = {
      source: this,
      item,
      id: item.id,
      cancel: false,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };

    if (!options.silent) this.events.emit("beforeOpen", event);

    if (event.cancel === true || this.destroyed) {
      return false;
    }

    const popup = document.createElement("div");
    popup.className = "dui-menu-popup";
    popup.setAttribute("role", "menu");
    popup.dataset.duiMenuPopupDepth = String(depth);

    for (const child of visible) {
      popup.appendChild(this._createMenuItem(child));
    }

    this.overlayManager.getRoot().appendChild(popup);
    this._positionPopup(popup, anchor, depth);

    const click = clickEvent => {
      this._handlePopupClick(clickEvent, popup, depth);
    };

    const keydown = keyEvent => {
      this._handlePopupKeyDown(keyEvent, popup, depth);
    };

    const pointerover = pointerEvent => {
      this._handlePopupPointerOver(pointerEvent, popup, depth);
    };

    popup.addEventListener("click", click);
    popup.addEventListener("keydown", keydown);
    popup.addEventListener("pointerover", pointerover);

    this._openPopups.push({
      item,
      element: popup,
      click,
      keydown,
      pointerover
    });

    if (depth === 0) {
      this.overlayManager.open(this, {
        element: popup,
        anchor,
        modal: false,
        closeOnOutsideClick: true,
        closeOnEscape: true,
        restoreFocus: false,
        containsTarget: target => this.element?.contains(target) ||
          this._openPopups.some(entry => entry.element.contains(target)),
        requestClose: request => this.close({
          origin: "user",
          userAction: true,
          reason: request.reason
        })
      });
    } else {
      popup.style.zIndex = String(this.overlayManager.baseZIndex + depth + 1);
    }

    this._renderActiveState();

    const first = this._getEnabledPopupItems(popup)[0];
    first?.focus({ preventScroll: true });

    if (!options.silent && !this.destroyed) this.events.emit("open", {
      source: this,
      item,
      id: item.id,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    return true;
  }

  _handlePopupClick(event, popup, depth) {
    const element = event.target.closest?.("[data-dui-menu-item-id]");

    if (!element || !popup.contains(element)) {
      return;
    }

    const item = this._itemsById.get(element.dataset.duiMenuItemId);

    if (!item || !this._getItemState(item).enabled) {
      return;
    }

    if (item.items?.length) {
      this._openSubmenu(item, element, depth + 1, {
        origin: "user",
        userAction: true
      });
      return;
    }

    this._executeItem(item, {
      origin: "user",
      userAction: true
    });
  }

  _handlePopupPointerOver(event, popup, depth) {
    const element = event.target.closest?.("[data-dui-menu-item-id]");

    if (!element || !popup.contains(element)) {
      return;
    }

    const item = this._itemsById.get(element.dataset.duiMenuItemId);

    if (!item || !this._getItemState(item).enabled) {
      return;
    }

    element.focus({ preventScroll: true });

    if (item.items?.length) {
      this._openSubmenu(item, element, depth + 1, {
        origin: "user",
        userAction: true
      });
    } else {
      this._clearPopups(depth + 1);
    }
  }

  _handlePopupKeyDown(event, popup, depth) {
    const items = this._getEnabledPopupItems(popup);

    if (items.length === 0) {
      return;
    }

    const index = Math.max(0, items.indexOf(document.activeElement));
    let handled = true;

    switch (event.key) {
      case "ArrowDown":
        items[(index + 1) % items.length].focus({ preventScroll: true });
        break;

      case "ArrowUp":
        items[(index - 1 + items.length) % items.length].focus({ preventScroll: true });
        break;

      case "ArrowRight": {
        const item = this._itemsById.get(document.activeElement?.dataset?.duiMenuItemId);

        if (item?.items?.length) {
          this._openSubmenu(item, document.activeElement, depth + 1, {
            origin: "user",
            userAction: true
          });
        }
        break;
      }

      case "ArrowLeft":
        this._clearPopups(depth);
        this._openPopups[depth - 1]?.element.querySelector("[data-dui-menu-item-id]")?.focus({
          preventScroll: true
        });
        break;

      case "Enter":
      case " ": {
        const item = this._itemsById.get(document.activeElement?.dataset?.duiMenuItemId);

        if (item?.items?.length) {
          this._openSubmenu(item, document.activeElement, depth + 1, {
            origin: "user",
            userAction: true
          });
        } else if (item) {
          this._executeItem(item, {
            origin: "user",
            userAction: true
          });
        }
        break;
      }

      case "Escape":
        this.close({
          origin: "user",
          userAction: true
        });
        break;

      default:
        handled = false;
        break;
    }

    if (handled) {
      event.preventDefault();
    }
  }

  _executeItem(item, options = {}) {
    const state = this._getItemState(item);

    if (!state.enabled) {
      return false;
    }

    if (!options.silent) this.events.emit("itemClick", {
      source: this,
      item,
      id: item.id,
      commandId: item.command ?? null,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    if (this.destroyed) return false;

    if (item.command) {
      if (!this.commands) {
        throw new Error("Menu command item requires CommandRegistry.");
      }

      this.commands.execute(item.command, undefined, options);
    } else if (typeof item.onClick === "function") {
      item.onClick({
        source: this,
        item,
        id: item.id,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    if (!this.destroyed) {
      if (item.closeOnClick === false) this._syncOpenItemStates();
      else this.close(options);
    }
    return true;
  }

  _syncOpenItemStates() {
    // Keep popup anchors and keyboard focus intact while checkbox actions update state.
    for (const { element: popup } of this._openPopups) {
      for (const element of popup.querySelectorAll("button[data-dui-menu-item-id]")) {
        const item = this._itemsById.get(element.dataset.duiMenuItemId);
        if (!item) continue;
        const state = this._getItemState(item);
        element.disabled = !state.enabled;
        element.hidden = !state.visible;
        element.classList.toggle("dui-disabled", !state.enabled);
        element.classList.toggle("dui-checked", state.checked);
        element.setAttribute("aria-disabled", String(!state.enabled));
        element.setAttribute("aria-checked", String(state.checked));
        element.setAttribute("role", item.checked != null || state.checked ? "menuitemcheckbox" : "menuitem");
        const check = element.querySelector(".dui-menu__check");
        const icon = state.checked ? "check" : state.icon;
        check?.replaceChildren(...(icon ? [createIcon(icon)] : []));
      }
    }
  }

  _getItemState(item) {
    if (item.type === "separator") {
      return {
        label: "",
        visible: true,
        enabled: false,
        checked: false
      };
    }

    if (item.command && this.commands) {
      return this.commands.state(item.command);
    }

    return {
      id: item.id,
      label: item.text ?? item.label ?? item.id,
      shortcut: item.shortcut,
      enabled: item.disabled !== true && item.enabled !== false,
      visible: item.visible !== false,
      checked: item.checked === true,
      icon: item.icon ?? null
    };
  }

  _visibleItems(items) {
    return items.filter(item => this._getItemState(item).visible);
  }

  _positionPopup(popup, anchor, depth) {
    const rect = anchor.getBoundingClientRect();
    const isRoot = depth === 0;
    const left = isRoot ? rect.left : rect.right - 2;
    const top = isRoot ? rect.bottom : rect.top;

    popup.style.left = `${Math.max(0, left)}px`;
    popup.style.top = `${Math.max(0, top)}px`;

    requestAnimationFrame(() => {
      if (this.destroyed || !popup.isConnected) return;
      const popupRect = popup.getBoundingClientRect();
      const nextLeft = Math.min(left, window.innerWidth - popupRect.width - 4);
      const nextTop = Math.min(top, window.innerHeight - popupRect.height - 4);
      popup.style.left = `${Math.max(4, nextLeft)}px`;
      popup.style.top = `${Math.max(4, nextTop)}px`;
    });
  }

  _focusRoot(delta) {
    const roots = this._getRootElements();

    if (roots.length === 0) {
      return false;
    }

    this._focusedRootIndex = (this._focusedRootIndex + delta + roots.length) % roots.length;
    roots[this._focusedRootIndex].focus({ preventScroll: true });
    return true;
  }

  _focusRootIndex(index) {
    const roots = this._getRootElements();

    if (roots.length === 0) {
      return false;
    }

    this._focusedRootIndex = Math.max(0, Math.min(roots.length - 1, index));
    roots[this._focusedRootIndex].focus({ preventScroll: true });
    return true;
  }

  _getRootElements() {
    return [...(this.element?.querySelectorAll(".dui-menu__root-item:not([hidden])") ?? [])].filter(
      element => !element.disabled
    );
  }

  _getEnabledPopupItems(popup) {
    return [...popup.querySelectorAll(".dui-menu__item:not([hidden])")].filter(
      element => !element.disabled
    );
  }

  _renderActiveState(root = this.element) {
    if (!root) {
      return;
    }

    const openIds = new Set(this._openPopups.map(popup => popup.item.id));

    for (const element of root.querySelectorAll("[data-dui-menu-item-id]")) {
      element.classList.toggle("dui-active", openIds.has(element.dataset.duiMenuItemId));
    }
  }

  _clearPopups(fromDepth = 0) {
    const removed = this._openPopups.splice(fromDepth);

    if (fromDepth === 0 && removed.length) {
      this.overlayManager.close(this, { restoreFocus: false });
    }

    for (const popup of removed.reverse()) {
      popup.element.removeEventListener("click", popup.click);
      popup.element.removeEventListener("keydown", popup.keydown);
      popup.element.removeEventListener("pointerover", popup.pointerover);
      popup.element.remove();
    }
  }
}

export class ContextMenu extends Menu {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const menuOptions = {
      ...options,
      className: ["dui-context-menu-host", options.className].filter(Boolean).join(" ")
    };

    if (hasContainer) {
      super(containerOrOptions, menuOptions);
    } else {
      super(menuOptions);
    }

    this.attachTo = options.attachTo ?? null;

    if (this.attachTo) {
      this.attach(this.attachTo);
    }
  }

  createElement() {
    const root = super.createElement();
    root.classList.add("dui-context-menu-host");
    root.hidden = true;
    return root;
  }

  openAt(x, y, options = {}) {
    this._assertMutable("openAt");

    if (this.disabled) {
      return false;
    }

    const visible = this._visibleItems(this.items);

    if (visible.length === 0) {
      return false;
    }

    this._clearPopups();

    const event = {
      source: this,
      x,
      y,
      cancel: false,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };

    if (!options.silent) this.events.emit("beforeOpen", event);

    if (event.cancel === true || this.destroyed) {
      return false;
    }

    const popup = document.createElement("div");
    popup.className = "dui-menu-popup dui-context-menu";
    popup.setAttribute("role", "menu");

    for (const item of visible) {
      popup.appendChild(this._createMenuItem(item));
    }

    this.overlayManager.getRoot().appendChild(popup);
    popup.style.left = `${Math.max(4, x)}px`;
    popup.style.top = `${Math.max(4, y)}px`;

    requestAnimationFrame(() => {
      if (this.destroyed || !popup.isConnected) return;
      const rect = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
      popup.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    });

    const click = clickEvent => {
      this._handlePopupClick(clickEvent, popup, 0);
    };
    const keydown = keyEvent => {
      this._handlePopupKeyDown(keyEvent, popup, 0);
    };
    const pointerover = pointerEvent => {
      this._handlePopupPointerOver(pointerEvent, popup, 0);
    };

    popup.addEventListener("click", click);
    popup.addEventListener("keydown", keydown);
    popup.addEventListener("pointerover", pointerover);

    this._openPopups.push({
      item: { id: "__context__" },
      element: popup,
      click,
      keydown,
      pointerover
    });

    this.overlayManager.open(this, {
      element: popup,
      modal: false,
      closeOnOutsideClick: true,
      closeOnEscape: true,
      restoreFocus: false,
      containsTarget: target => this._openPopups.some(entry => entry.element.contains(target)),
      requestClose: request => this.close({
        origin: "user",
        userAction: true,
        reason: request.reason
      })
    });

    this._getEnabledPopupItems(popup)[0]?.focus({ preventScroll: true });

    if (!options.silent && !this.destroyed) this.events.emit("open", {
      source: this,
      x,
      y,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    return true;
  }

  openForEvent(event, options = {}) {
    event.preventDefault();
    return this.openAt(event.clientX, event.clientY, {
      ...options,
      origin: options.origin ?? "user",
      userAction: options.userAction ?? true
    });
  }

  attach(target) {
    this._assertMutable("attach");
    const element = typeof target === "string" ? document.querySelector(target) : target;

    if (!element) {
      throw new Error("ContextMenu.attach() target not found.");
    }

    this.disposables.addEventListener(element, "contextmenu", event => {
      this.openForEvent(event);
    });

    return this;
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    throw new TypeError("Menu items must be an array.");
  }

  return items.map(normalizeItem);
}

function normalizeItem(item) {
  if (item === "-") {
    return {
      id: `menu-separator-${nextMenuItemId++}`,
      type: "separator"
    };
  }

  if (!item || typeof item !== "object") {
    throw new TypeError("Menu item must be an object.");
  }

  const id = item.id ?? item.name ?? item.command ?? `menu-item-${nextMenuItemId++}`;

  return {
    ...item,
    id,
    type: item.type ?? (item.separator ? "separator" : "item"),
    items: item.items ? normalizeItems(item.items) : null
  };
}
