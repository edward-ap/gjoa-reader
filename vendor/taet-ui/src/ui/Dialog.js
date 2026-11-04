import { localize } from "./localize.js";
import { Button } from "./Button.js";
import { createHeaderAction } from "./HeaderAction.js";
import { Popup } from "./Popup.js";
import { listenUntilPointerUp } from "../core/pointerTracking.js";
import { overlayScale } from "./overlayGeometry.js";

export class Dialog extends Popup {
  constructor(options = {}) {
    super({
      ...options,
      anchor:null,
      content:null,
      modal:true,
      closeOnOutsideClick:options.closeOnOutsideClick === true,
      role:"dialog"
    });
    this.title = options.title ?? "";
    this.content = options.content ?? null;
    this.buttons = normalizeDialogButtons(options.buttons ?? []);
    this.closeable = options.closeable !== false;
    this.draggable = options.draggable !== false;
    this.defaultResult = options.defaultResult ?? null;
    this.cancelResult = options.cancelResult ?? "cancel";
    this.ariaLabel = options.ariaLabel ?? this.title;
    this._ownedButtons = [];
    this._resultPromise = null;
    this._resolveResult = null;
    this._dragTracking = null;
    this._dragPosition = null;
  }

  createElement() {
    const root = document.createElement("section");
    root.className = ["dui-control", "dui-popup", "dui-dialog", this.className].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiOverlay = "dialog";
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    if (this.ariaLabel) root.setAttribute("aria-label", this.ariaLabel);
    root.hidden = true;

    const header = document.createElement("header");
    header.className = "dui-window-header dui-dialog__header";
    header.classList.toggle("dui-dialog__header--draggable", this.draggable);
    header.dataset.duiDialogDragHandle = String(this.draggable);
    const title = document.createElement("span");
    title.className = "dui-window-header__title dui-dialog__title";
    title.textContent = this.title;
    header.appendChild(title);
    if (this.closeable) {
      const close = createHeaderAction("close", {
        className:"dui-dialog__close", label: localize(this.options, "Close"),
        command:"close"
      });
      close.addEventListener("click", () => this.close(this.cancelResult, { origin:"user", userAction:true, reason:"close-button" }));
      header.appendChild(close);
    }
    if (this.draggable) {
      this.disposables.addEventListener(header, "pointerdown", event =>
        this._startDrag(event)
      );
    }

    const body = document.createElement("div");
    body.className = "dui-dialog__body";
    this._mountContent(body);
    if (this.destroyed) return root;
    const footer = document.createElement("footer");
    footer.className = "dui-dialog__footer";
    for (const definition of this.buttons) {
      const button = definition.control ?? new Button({
        text:definition.text,
        disabled:definition.disabled,
        onClick:() => this.close(definition.result, { origin:"user", userAction:true, reason:"button" })
      });
      if (!definition.control) this._ownedButtons.push(button);
      button.mount(footer);
      if (this.destroyed) return root;
      button.element?.classList.toggle("dui-dialog__button--primary", definition.primary === true);
      button.element?.setAttribute("data-dui-dialog-result", String(definition.result ?? ""));
    }
    root.append(header, body, footer);
    this._footer = footer;
    this.disposables.addEventListener(root, "keydown", event => {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing ||
          event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
          this.disabled || !this.opened || this.manager.top() !== this) return;
      // Preserve native activation, multiline editing and composite-control keys.
      if (event.target.closest?.('button, a, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="grid"], [role="tree"], [role="listbox"]')) return;
      const primary = this._footer?.querySelector('.dui-dialog__button--primary:not([disabled])');
      if (!primary || primary.closest('[hidden], [inert]') || !primary.getClientRects().length) return;
      event.preventDefault();
      primary.click();
    });
    return root;
  }

  open(options = {}) {
    if (!this.opened) {
      this._dragPosition = null;
    }
    const opened = super.open(null, options);
    const revision = this._popupRevision;
    if (opened) queueMicrotask(() => {
      if (!this.destroyed && this.opened && revision === this._popupRevision) this._focusInitialButton();
    });
    return opened;
  }

  reposition() {
    if (!this.opened || !this.element || !this._dragPosition) {
      return super.reposition();
    }
    this._applyDragPosition(
      this._dragPosition.left,
      this._dragPosition.top
    );
    return true;
  }

  showModal(options = {}) {
    if (this._resultPromise) return this._resultPromise;
    this._resultPromise = new Promise(resolve => { this._resolveResult = resolve; });
    const promise = this._resultPromise;
    try {
      if (!this.open(options)) this._settleResult(null, promise);
    } catch (error) {
      this._settleResult(null, promise);
      throw error;
    }
    return promise;
  }

  close(resultOrOptions = this.defaultResult, maybeOptions = {}) {
    const options = isOptions(resultOrOptions)
      ? resultOrOptions
      : { ...maybeOptions, result:resultOrOptions };
    const cancelled = ["escape", "outside-click", "close-button"].includes(options.reason);
    const result = Object.prototype.hasOwnProperty.call(options, "result")
      ? options.result
      : cancelled ? this.cancelResult : this.defaultResult;
    return super.close({ ...options, result });
  }

  _onCloseCommitted(options) {
    this._stopDrag();
    this._settleResult(options.result);
  }

  destroy() {
    if (this.destroyed) return;
    this._stopDrag();
    this._settleResult(null);
    for (const button of this._ownedButtons) button.destroy();
    this._ownedButtons = [];
    super.destroy();
  }

  _focusInitialButton() {
    const primary = this._footer?.querySelector(".dui-dialog__button--primary:not([disabled])");
    const fallback = this._footer?.querySelector("button:not([disabled])");
    (primary ?? fallback ?? this.element)?.focus({ preventScroll:true });
  }

  _startDrag(event) {
    if (
      !this.draggable ||
      event.button !== 0 ||
      event.target.closest?.(
        "button, input, select, textarea, a, [contenteditable='true']"
      )
    ) {
      return;
    }

    const bounds = this.element.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = bounds.left;
    const startTop = bounds.top;

    event.preventDefault();
    this._stopDrag();
    this.element.classList.add("dui-dialog--dragging");

    this._dragTracking = listenUntilPointerUp({
      target: window,
      move: moveEvent => {
        this._applyDragPosition(
          startLeft + moveEvent.clientX - startX,
          startTop + moveEvent.clientY - startY
        );
      },
      up: () => this._stopDrag()
    });
  }

  _applyDragPosition(left, top) {
    const bounds = this.element.getBoundingClientRect();
    const viewportGap = 4;
    const clampedLeft = Math.max(
      viewportGap,
      Math.min(left, window.innerWidth - bounds.width - viewportGap)
    );
    const clampedTop = Math.max(
      viewportGap,
      Math.min(top, window.innerHeight - bounds.height - viewportGap)
    );

    this._dragPosition = {
      left: Math.round(clampedLeft),
      top: Math.round(clampedTop)
    };
    const scale = overlayScale(this.element);
    this.element.style.left = `${this._dragPosition.left / scale}px`;
    this.element.style.top = `${this._dragPosition.top / scale}px`;
  }

  _stopDrag() {
    this._dragTracking?.dispose();
    this._dragTracking = null;
    this.element?.classList.remove("dui-dialog--dragging");
  }

  _settleResult(result, promise = this._resultPromise) {
    if (promise !== this._resultPromise) return;
    const resolve = this._resolveResult;
    this._resolveResult = null;
    this._resultPromise = null;
    resolve?.(result);
  }
}

function normalizeDialogButtons(buttons) {
  if (!Array.isArray(buttons)) throw new TypeError("Dialog buttons must be an array.");
  return buttons.map((button, index) => {
    if (button && typeof button.mount === "function") {
      return { control:button, result:button.result ?? button.options?.result ?? null };
    }
    if (!button || typeof button !== "object") throw new TypeError("Dialog button must be a Button or definition object.");
    return { text:button.text ?? button.label ?? `Button ${index + 1}`, result:button.result ?? null,
      primary:button.primary === true, disabled:button.disabled === true };
  });
}

function isOptions(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
