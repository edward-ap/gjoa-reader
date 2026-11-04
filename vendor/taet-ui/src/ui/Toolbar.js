import { BaseControl } from "../core/BaseControl.js";
import { Button } from "./Button.js";
import { Panel } from "./Panel.js";
import { ToolButton } from "./ToolButton.js";

export class Toolbar extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.commands = options.commands ?? null;
    this.css = options.css ?? "";

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("nav");
    root.className = ["dui-control", "dui-toolbar", this.css].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", this.name ?? this.id);
    return root;
  }

  mount(container) {
    super.mount(container);
    this._mountPendingItems();
    return this;
  }

  addCommand(commandId, options = {}) {
    this._assertMutable("addCommand");

    if (!this.commands) {
      throw new Error("Toolbar requires a CommandRegistry.");
    }

    const button = new ToolButton({
      name: options.name ?? options.id ?? commandId,
      ...options,
      command: commandId,
      commands: this.commands
    });

    this.add(button);
    return this;
  }

  addButton(options = {}) {
    this._assertMutable("addButton");
    this.add(new Button(options));
    return this;
  }

  addToolButton(options = {}) {
    this._assertMutable("addToolButton");
    this.add(new ToolButton(options));
    return this;
  }

  addSeparator(options = {}) {
    this._assertMutable("addSeparator");
    this.add(new ToolbarSeparator(options));
    return this;
  }

  addSpacer(options = {}) {
    this._assertMutable("addSpacer");
    this.add(new ToolbarSpacer(options));
    return this;
  }

  add(...controls) {
    this._assertMutable("add");

    for (const control of controls.flat()) {
      this._assertControl(control);
      this.addControl(control);

      if (this.element) {
        this._mountToolbarControl(control);
      }
    }

    return this;
  }

  refresh() {
    super.refresh();

    for (const control of this.items) {
      control.refresh?.();
    }
  }

  _mountPendingItems() {
    for (const control of this.items) {
      this._mountToolbarControl(control);
    }
  }

  _mountToolbarControl(control) {
    const host = this.getContentElement();

    if (!host) {
      return;
    }

    if (!control.mounted) {
      control.mount(host);
      return;
    }

    if (control.element?.parentElement !== host) {
      throw new Error(`Control ${control.id} is already mounted into another container.`);
    }
  }
}

export class ToolbarSeparator extends BaseControl {
  createElement() {
    const element = document.createElement("span");
    element.className = "dui-control dui-toolbar-separator";
    element.dataset.duiControlId = this.id;
    element.setAttribute("role", "separator");
    return element;
  }
}

export class ToolbarSpacer extends BaseControl {
  constructor(options = {}) {
    super(options);
    this.css = options.css ?? options.className ?? "";
  }

  createElement() {
    const element = document.createElement("span");
    element.className = ["dui-control", "dui-toolbar-spacer", this.css]
      .filter(Boolean)
      .join(" ");
    element.dataset.duiControlId = this.id;
    element.setAttribute("aria-hidden", "true");
    return element;
  }
}
