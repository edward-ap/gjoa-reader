import { BaseControl } from "../core/BaseControl.js";
import { renderIcon } from "./Icon.js";

export class Button extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.label = options.label ?? options.text ?? options.value ?? "";
    this.icon = options.icon ?? "";
    this.iconPosition = options.iconPosition === "right" ? "right" : "left";
    this.css = options.css ?? "";
    this.command = options.command ?? null;
    this.commands = options.commands ?? null;
    this._commandSubscription = null;
    this._button = null;
    this._iconElement = null;
    this._textElement = null;

    if (this.command && options.onClick) {
      throw new Error("Button cannot use both command and onClick.");
    }

    this._bindOptionEvent("click", options.onClick);

    if (this.command && this.commands) {
      this.bindCommand(this.commands, this.command);
    }

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = ["dui-control", "dui-button", this.css].filter(Boolean).join(" ");
    button.dataset.duiControlId = this.id;
    button.dataset.duiFocusTarget = "true";
    button.disabled = this.disabled;
    this._button = button;
    this._render();

    if (this.command && this.commands) {
      this._renderCommandState(this.commands.state(this.command));
    }

    this.disposables.addEventListener(button, "click", nativeEvent => {
      if (this.disabled) {
        return;
      }

      if (this.command && this.commands) {
        this.commands.execute(this.command, undefined, {
          origin: "user",
          userAction: true
        });
        return;
      }

      this.events.emit("click", {
        source: this,
        origin: "user",
        userAction: true,
        nativeEvent
      });
    });

    return button;
  }

  setLabel(label) {
    this._assertMutable("setLabel");
    this.label = label ?? "";
    this._render();
  }

  setText(text) {
    this.setLabel(text);
  }

  setIcon(icon) {
    this._assertMutable("setIcon");
    this.icon = icon ?? "";
    this._render();
    return this;
  }

  setIconPosition(position) {
    this._assertMutable("setIconPosition");
    this.iconPosition = position === "right" ? "right" : "left";
    this._render();
    return this;
  }

  bindCommand(commands, commandId = this.command) {
    this._assertMutable("bindCommand");

    if (!commandId) {
      throw new Error("Command id is required.");
    }

    this.commands = commands;
    this.command = commandId;

    if (this._commandSubscription) {
      this._commandSubscription.dispose();
      this._commandSubscription = null;
    }

    this._renderCommandState(commands.state(commandId));

    this._commandSubscription = this.disposables.add(
      commands.events.on("stateChange", event => {
        if (event.commandId === commandId) {
          this._renderCommandState(event.state);
        }
      })
    );

    return this;
  }

  refresh() {
    super.refresh();
    this._render();
  }

  enable() {
    super.enable();

    if (this._button) {
      this._button.disabled = false;
    }
  }

  disable() {
    super.disable();

    if (this._button) {
      this._button.disabled = true;
    }
  }

  destroy() {
    super.destroy();
    this._button = null;
    this._iconElement = null;
    this._textElement = null;
  }

  static createCellAction(text, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = ["dui-button", "dui-grid__cell-action", options.className]
      .filter(Boolean)
      .join(" ");
    button.dataset.duiGridAction = String(options.action ?? "activate");
    button.disabled = options.disabled === true;
    button.setAttribute("aria-label", options.ariaLabel ?? String(text ?? "Action"));

    const icon = document.createElement("span");
    icon.className = "dui-button__icon";
    renderIcon(icon, options.icon ?? "");
    const label = document.createElement("span");
    label.className = "dui-button__text";
    label.textContent = String(text ?? "");
    button.append(icon, label);
    return button;
  }

  _render() {
    if (!this._button) {
      return;
    }

    if (!this._iconElement || !this._textElement) {
      this._iconElement = document.createElement("span");
      this._iconElement.className = "dui-button__icon";
      this._textElement = document.createElement("span");
      this._textElement.className = "dui-button__text";
    }

    const children = this.iconPosition === "right"
      ? [this._textElement, this._iconElement]
      : [this._iconElement, this._textElement];
    if (this._button.firstChild !== children[0]) {
      this._button.replaceChildren(...children);
    }
    renderIcon(this._iconElement, this.icon);
    this._textElement.textContent = this.label;
    this._button.disabled = this.disabled;
  }

  _renderCommandState(state) {
    this.icon = state.icon ?? this.icon;
    this.setText(state.label);

    if (state.enabled) {
      this.enable();
    } else {
      this.disable();
    }

    if (state.visible) {
      this.show({ origin: "command" });
    } else {
      this.hide({ origin: "command" });
    }

    if (this._button) {
      this._button.setAttribute("aria-pressed", state.checked ? "true" : "false");
      this._button.title = state.shortcut ? `${state.label} (${state.shortcut})` : state.label;
    }
  }
}
