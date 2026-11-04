import { CheckBox } from "./CheckBox.js";
import { DateInput, DateTimeInput, TimeInput } from "./DateTimeInput.js";
import { NumberInput } from "./NumberInput.js";
import { RadioGroup } from "./RadioGroup.js";
import { SelectInput } from "./SelectInput.js";
import { Switch } from "./Switch.js";
import { TextInput } from "./TextInput.js";

import { GRID_EDITOR_FACTORY, isGridEditorFactory } from "./gridEditorFactory.js";
export { isGridEditorFactory };

export const gridEditors = /* @__PURE__ */ Object.freeze({
  text: options => controlEditor(TextInput, options, { filterType: "text" }),
  number: options => controlEditor(NumberInput, options, { filterType: "number" }),
  select: options => selectEditor(options),
  checkbox: options => controlEditor(CheckBox, options, { activation: "toggle", filterType: "boolean" }),
  switch: options => controlEditor(Switch, options, { activation: "toggle", filterType: "boolean" }),
  date: options => controlEditor(DateInput, options, { filterType: "date" }),
  time: options => controlEditor(TimeInput, options, { filterType: "text" }),
  dateTime: options => controlEditor(DateTimeInput, options, { filterType: "date" }),
  radio: options => controlEditor(RadioGroup, options, { filterType: "values" }),
  custom: createControl => createGridEditorFactory(createControl)
});

export class ControlCellEditor {
  constructor(control, context) {
    assertValueControl(control);
    this.control = control;
    this.context = context;
    this.element = null;
    this.destroyed = false;
    this._positionPopup = () => this._syncPopupPosition();
    this._queuePopupPosition = () => queueMicrotask(this._positionPopup);
    this._controlClick = event => {
      this._queuePopupPosition();
      // WebKit does not focus checkboxes on pointer activation. A mounted cell
      // editor still owns Enter/Tab after its native toggle has been clicked.
      const active = document.activeElement;
      if ((active === document.body || active === this.context?.grid?.element || active === this.element?.closest(".dui-grid__body")) &&
          this._gridKeyHandler && !this.destroyed && (this.control instanceof CheckBox || this.control instanceof Switch) &&
          !this.control.disabled && !this.control.isReadOnly() && this.element?.contains(event.target) &&
          !this.element.contains(document.activeElement)) this.control.focus({ preventScroll: true });
    };
    this._gridKeyHandler = null;
    this._rootKeyDown = event => {
      // A closed searchable Select owns Enter in standalone use. In a cell it
      // commits; ArrowDown/Alt+ArrowDown still opens its choice popup.
      if (["Enter", "Escape"].includes(event.key) && this.control instanceof SelectInput &&
          this.element?.querySelector('[aria-haspopup="listbox"]')?.getAttribute("aria-expanded") === "false") {
        this._forwardGridKey(event);
      }
    };
    this._popupKeyDown = event => {
      // Portaled picker/search content is not a descendant of the cell host.
      // Preserve each popup's Enter/Escape policy; forward unconsumed Tab only.
      const popup = this.control instanceof SelectInput ? this.control._popupElement
        : this.control instanceof DateInput || this.control instanceof TimeInput || this.control instanceof DateTimeInput
          ? this.control._picker : null;
      if (event.key === "Tab" && popup && !popup.hidden && popup.contains(event.target)) this._forwardGridKey(event);
    };
  }

  mount(container) {
    this._assertUsable("mount");
    try { this.control.mount(container); }
    catch (error) {
      this.destroy();
      throw error;
    }
    if (this.destroyed) return this;
    if (this.control.destroyed === true) { this.destroy(); return this; }
    this.element = this.control.element;
    this.element?.classList.add("dui-grid__control-editor");
    this.element?.addEventListener("click", this._controlClick);
    this.element?.addEventListener("keydown", this._queuePopupPosition);
    this.element?.addEventListener("keydown", this._rootKeyDown, true);
    document.addEventListener("keydown", this._popupKeyDown);
    document.addEventListener("scroll", this._positionPopup, true);
    window.addEventListener("resize", this._positionPopup);
    if (typeof this.control.events?.on === "function") {
      this._resizeSubscription?.dispose();
      const subscription = this.control.events.on("resize", this._positionPopup);
      if (this.destroyed) subscription?.dispose();
      else this._resizeSubscription = subscription;
    }
    return this;
  }

  _bindGridKeys(handler) {
    this._gridKeyHandler = handler;
  }

  _forwardGridKey(event) {
    if (!this.destroyed && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229) {
      this._gridKeyHandler?.(event);
    }
  }

  getValue() {
    this._assertUsable("getValue");
    return this.control.value.get();
  }

  validate(context = {}) {
    this._assertUsable("validate");

    if (typeof this.control.validate !== "function") {
      return {
        source: this.control,
        ok: true,
        errors: [],
        value: this.getValue()
      };
    }

    return this.control.validate({
      ...this.context,
      ...context
    });
  }

  focus() {
    this._assertUsable("focus");
    return this.control.focus({ preventScroll: true });
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.element?.removeEventListener("click", this._controlClick);
    this.element?.removeEventListener("keydown", this._queuePopupPosition);
    this.element?.removeEventListener("keydown", this._rootKeyDown, true);
    this._gridKeyHandler = null;
    this._resizeSubscription?.dispose();
    this._resizeSubscription = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("scroll", this._positionPopup, true);
      document.removeEventListener("keydown", this._popupKeyDown);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this._positionPopup);
    }
    this.element = null;
    this.context = null;
    if (this.control.destroyed !== true) this.control.destroy();
  }

  _syncPopupPosition() {
    if (this.destroyed || !this.element) {
      return;
    }

    // The built-in controls own their portal geometry, including scale handling.
    if (this.control instanceof SelectInput) return this.control._positionPopup();
    if (this.control instanceof DateInput || this.control instanceof TimeInput || this.control instanceof DateTimeInput) {
      return this.control._positionPickerOverlay();
    }
    const popup = this.element.querySelector(
      ".dui-time-picker:not([hidden]), .dui-date-time-picker:not([hidden])"
    );

    if (!popup) {
      return;
    }

    popup.style.position = "fixed";
    popup.style.right = "auto";
    const anchor = this.element.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const viewportGap = 4;
    const left = Math.max(
      viewportGap,
      Math.min(anchor.right - popupRect.width, window.innerWidth - popupRect.width - viewportGap)
    );
    const below = anchor.bottom + 2;
    const above = anchor.top - popupRect.height - 2;
    const top = below + popupRect.height <= window.innerHeight - viewportGap
      ? below
      : Math.max(viewportGap, above);

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  _assertUsable(operation) {
    if (this.destroyed) {
      throw new Error(`Cannot call ${operation}() on destroyed ControlCellEditor.`);
    }
  }
}

export function createGridEditorFactory(createControl, options = {}) {
  if (typeof createControl !== "function") {
    throw new TypeError("Grid editor factory requires a control creator function.");
  }

  return Object.freeze({
    [GRID_EDITOR_FACTORY]: true,
    activation: options.activation ?? "edit",
    filterType: options.filterType ?? "values",
    createCellEditor(context) {
      const result = createControl(context);
      try {
        if (isCellEditor(result)) {
          if (typeof result.validate !== "function") throw new TypeError("Grid cell editor must implement validate().");
          return result;
        }
        return new ControlCellEditor(result, context);
      } catch (error) {
        if (result?.destroyed !== true) result?.destroy?.();
        throw error;
      }
    }
  });
}


function controlEditor(ControlClass, options, factoryOptions = {}) {
  return createGridEditorFactory(context => {
    const controlOptions = resolveControlOptions(options, context);
    return new ControlClass({
      ...controlOptions,
      label: "",
      value: context.value
    });
  }, factoryOptions);
}

function selectEditor(options = {}) {
  return createGridEditorFactory(context => {
    const controlOptions = resolveControlOptions(options, context);
    const items = controlOptions.items ?? controlOptions.options ?? [];
    const control = new SelectInput({
      ...controlOptions,
      label: "",
      value: context.value
    });

    if (!controlOptions.data) {
      control.data.parse(normalizeSelectItems(items), {
        silent: true,
        origin: "system"
      });
    }

    return control;
  }, { filterType: "values" });
}

function resolveControlOptions(options, context) {
  const resolved = typeof options === "function" ? options(context) : options;

  if (resolved == null) {
    return {};
  }

  if (typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new TypeError("Grid editor options must resolve to an object.");
  }

  return resolved;
}

function normalizeSelectItems(items) {
  if (!Array.isArray(items)) {
    throw new TypeError("Grid select editor options must be an array.");
  }

  return items.map(item => {
    if (item && typeof item === "object") {
      return item;
    }

    return {
      id: item,
      text: String(item ?? "")
    };
  });
}

function assertValueControl(control) {
  if (
    !control ||
    typeof control.mount !== "function" ||
    typeof control.focus !== "function" ||
    typeof control.destroy !== "function" ||
    typeof control.value?.get !== "function" ||
    typeof control.value?.set !== "function"
  ) {
    throw new TypeError("Grid control editor must implement the ValueControl contract.");
  }
}

function isCellEditor(editor) {
  return Boolean(
    editor &&
    typeof editor.mount === "function" &&
    typeof editor.getValue === "function" &&
    typeof editor.focus === "function" &&
    typeof editor.destroy === "function"
  );
}
