import { localize } from "./localize.js";
import { Panel } from "./Panel.js";
import { createHeaderAction, setHeaderAction, headerActionLabel } from "./HeaderAction.js";

export class DockPanel extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.title = options.title ?? options.label ?? options.name ?? this.id;
    this.area = options.area ?? "center";
    this.css = options.css ?? "";
    this.closeable = options.closeable !== false;
    this.collapsible = options.collapsible !== false;
    this.movable = options.movable !== false;
    this.pinnable = options.pinnable ?? this.area !== "center";
    this.pinned = options.pinned ?? options.autoHide !== true;
    this.collapsed = options.collapsed === true;
    this._contentElement = null;
    this._actionButtons = {};

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("section");
    root.className = ["dui-control", "dui-dock-panel", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiDockArea = this.area;

    const header = document.createElement("header");
    header.className = "dui-window-header dui-dock-panel__header";

    const title = document.createElement("span");
    title.className = "dui-window-header__title dui-dock-panel__title";
    title.textContent = this.title;

    const actions = document.createElement("span");
    actions.className = "dui-window-header__actions dui-dock-panel__actions";

    if (this.pinnable) {
      const button = createDockActionButton("pin", this.options);
      this._actionButtons.pin = button;
      actions.appendChild(button);
    }

    if (this.collapsible) {
      const button = createDockActionButton("collapse", this.options);
      this._actionButtons.collapse = button;
      actions.appendChild(button);
    }

    if (this.closeable) {
      const button = createDockActionButton("close", this.options);
      this._actionButtons.close = button;
      actions.appendChild(button);
    }

    const content = document.createElement("div");
    content.className = "dui-dock-panel__content";
    this._contentElement = content;

    header.append(title, actions);
    root.append(header, content);
    root.classList.toggle("dui-collapsed", this.collapsed);
    content.hidden = this.collapsed;
    this._applyPinnedState();

    this.disposables.addEventListener(root, "click", event => {
      const action = event.target.closest?.("[data-dui-dock-action]")?.dataset.duiDockAction;

      if (!action) {
        return;
      }

      event.preventDefault();

      if (action === "collapse") {
        this.collapse({
          origin: "user",
          userAction: true
        });
      } else if (action === "close") {
        this.close({
          origin: "user",
          userAction: true
        });
      } else if (action === "pin") {
        this.setPinned(!this.pinned, {
          origin: "user",
          userAction: true
        });
      }
    });

    return root;
  }

  getContentElement() {
    return this._contentElement ?? this.element;
  }

  setTitle(title) {
    this._assertMutable("setTitle");
    const oldValue = this.title;
    this.title = title ?? "";

    const element = this.element?.querySelector(".dui-dock-panel__title");

    if (element) {
      element.textContent = this.title;
    }

    this.events.emit("titleChange", {
      source: this,
      type: "titleChange",
      panel: this,
      panelId: this.id,
      area: this.area,
      oldValue,
      value: this.title,
      origin: "api",
      userAction: false
    });

    return this;
  }

  collapse(options = {}) {
    this._assertMutable("collapse");

    if (this.collapsed) {
      return false;
    }

    const event = this._createDockPanelEvent("beforeCollapse", options, {
      cancel: false
    });

    this.events.emit("beforeCollapse", event);

    if (event.cancel === true) {
      return false;
    }

    this.collapsed = true;
    this._applyCollapsedState();
    this.events.emit("collapse", this._createDockPanelEvent("collapse", options));
    return true;
  }

  expand(options = {}) {
    this._assertMutable("expand");

    if (!this.collapsed) {
      return false;
    }

    const event = this._createDockPanelEvent("beforeExpand", options, {
      cancel: false
    });

    this.events.emit("beforeExpand", event);

    if (event.cancel === true) {
      return false;
    }

    this.collapsed = false;
    this._applyCollapsedState();
    this.events.emit("expand", this._createDockPanelEvent("expand", options));
    return true;
  }

  close(options = {}) {
    this._assertMutable("close");

    const event = this._createDockPanelEvent("beforeClose", options, {
      cancel: false
    });

    this.events.emit("beforeClose", event);

    if (event.cancel === true) {
      return false;
    }

    this.hide(options);
    this.events.emit("close", this._createDockPanelEvent("close", options));
    return true;
  }

  setPinned(pinned, options = {}) {
    this._assertMutable("setPinned");
    const oldValue = this.pinned;

    if (oldValue === pinned) {
      return false;
    }

    const event = this._createDockPanelEvent("beforePinChange", options, {
      oldValue,
      value: pinned,
      cancel: false
    });

    this.events.emit("beforePinChange", event);

    if (event.cancel === true) {
      return false;
    }

    this.pinned = pinned;
    this._applyPinnedState();

    this.events.emit("pinChange", {
      source: this,
      type: "pinChange",
      panel: this,
      panelId: this.id,
      area: this.area,
      oldValue,
      value: pinned,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    return true;
  }

  pin(options = {}) {
    return this.setPinned(true, options);
  }

  unpin(options = {}) {
    return this.setPinned(false, options);
  }

  _applyCollapsedState() {
    this.element?.classList.toggle("dui-collapsed", this.collapsed);

    if (this._contentElement) {
      this._contentElement.hidden = this.collapsed;
    }
  }

  _applyPinnedState() {
    this.element?.classList.toggle("dui-unpinned", !this.pinned);

    const button = this._actionButtons.pin;

    if (!button) {
      return;
    }

    setHeaderAction(button, this.pinned ? "unpin" : "pin", { label: localize(this.options, this.pinned ? "Unpin" : "Pin") });
  }

  _createDockPanelEvent(type, options = {}, extra = {}) {
    return {
      source: this,
      type,
      panel: this,
      panelId: this.id,
      area: this.area,
      origin: options.origin ?? "api",
      userAction: options.userAction === true,
      ...extra
    };
  }
}

function createDockActionButton(action, options) {
  const button = createHeaderAction(action, {
    className:"dui-dock-panel__action", label: localize(options, headerActionLabel(action)),
    command:action
  });
  button.dataset.duiDockAction = action;
  return button;
}
