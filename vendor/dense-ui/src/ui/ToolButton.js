import { Button } from "./Button.js";
import { renderIcon } from "./Icon.js";

export class ToolButton extends Button {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.showText = options.showText === true;
    this.icon = options.icon ?? this.icon;
    this.tooltip = options.tooltip ?? options.title ?? "";
    this.shape = options.shape === "rounded" ? "rounded" : "square";

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  setShape(shape) {
    this._assertMutable("setShape");
    this.shape = shape === "rounded" ? "rounded" : "square";
    this._render();
    return this;
  }

  createElement() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "dui-control",
      "dui-tool-button",
      this.showText ? "dui-tool-button--text" : "",
      this.css
    ]
      .filter(Boolean)
      .join(" ");
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

  _render() {
    if (!this._button) {
      return;
    }

    this._button.replaceChildren();
    this._button.disabled = this.disabled;
    this._button.setAttribute("aria-label", this.label);
    this._button.classList.toggle("dui-tool-button--text", this.showText);
    this._button.classList.toggle("dui-tool-button--rounded", this.shape === "rounded");

    if (!this.command) {
      this._button.title = this.tooltip || this.label;
    }

    const icon = document.createElement("span");
    icon.className = "dui-tool-button__icon";
    renderIcon(icon, this.icon);

    this._button.appendChild(icon);

    if (this.showText) {
      const text = document.createElement("span");
      text.className = "dui-tool-button__text";
      text.textContent = this.label;
      if (this.iconPosition === "right") {
        this._button.prepend(text);
      } else {
        this._button.appendChild(text);
      }
    }
  }

  _renderCommandState(state) {
    this.icon = state.icon ?? this.icon;
    super._renderCommandState(state);
  }
}
