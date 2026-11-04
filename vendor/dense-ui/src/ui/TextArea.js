import { TextField } from "./TextField.js";

export class TextArea extends TextField {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.rows = Math.max(1, Number(options.rows ?? 4));
    this.minRows = Math.max(1, Number(options.minRows ?? this.rows));
    this.maxRows = normalizeOptionalPositiveInteger(options.maxRows ?? options.linesCount);
    this.resize = options.resize ?? (options.resizable === true ? "both" : "vertical");
    this.wordWrap = options.wordWrap !== false && options.wrap !== false;
    this.scrollBars = normalizeScrollBars(options.scrollBars ?? options.scrollbars ?? "auto");
    this.acceptsReturn = options.acceptsReturn !== false;
    this.acceptsTab = options.acceptsTab === true;
    this.autoHeight = options.autoHeight === true;
    this.spellcheck = options.spellcheck;
    this.maxLength = normalizeOptionalPositiveInteger(options.maxLength ?? options.maxlength);
    this._suppressAutoHeight = false;

    this.lines = Object.freeze({
      get: () => this.getLines(),
      set: (lines, options) => this.setLines(lines, options),
      append: (line, options) => this.appendLine(line, options)
    });

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("label");
    root.className = [
      "dui-control",
      "dui-text-field",
      "dui-text-area",
      this.wordWrap ? "" : "dui-text-area--no-wrap",
      this.autoHeight ? "dui-text-area--auto-height" : "",
      this.css
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-text-field__label dui-text-area__label";
    label.textContent = this.label;

    const input = document.createElement("textarea");
    input.className = "dui-text-field__input dui-text-area__input";
    input.placeholder = this.placeholder;
    input.value = this._value;
    input.rows = this.rows;
    input.disabled = this.disabled;
    input.readOnly = this.state.has("readonly");
    input.required = this.state.has("required");
    input.dataset.duiFocusTarget = "true";
    input.style.resize = normalizeResize(this.resize);
    input.style.overflowX = this.scrollBars.overflowX;
    input.style.overflowY = this.scrollBars.overflowY;
    input.wrap = this.wordWrap ? "soft" : "off";

    if (this.spellcheck != null) {
      input.spellcheck = this.spellcheck === true;
    }

    if (this.maxLength != null) {
      input.maxLength = this.maxLength;
    }

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    root.append(label, input, message);
    this._labelElement = label;
    this._input = input;
    this._message = message;

    this.disposables.addEventListener(input, "input", () => {
      this._setValue(input.value, {
        origin: "user",
        userAction: true
      });
    });

    this.disposables.addEventListener(input, "keydown", event => {
      this._handleKeyDown(event);
    });

    this._syncAutoHeight();

    return root;
  }

  getLines() {
    if (this._value === "") {
      return [];
    }

    return this._value.split(/\r\n|\r|\n/);
  }

  setLines(lines = [], options = {}) {
    this._assertMutable("setLines");

    if (!Array.isArray(lines)) {
      throw new TypeError("TextArea lines must be an array.");
    }

    return this._setValue(lines.map(line => String(line ?? "")).join("\n"), options);
  }

  appendLine(line = "", options = {}) {
    this._assertMutable("appendLine");

    const separator = this._value === "" ? "" : "\n";
    return this._setValue(`${this._value}${separator}${String(line ?? "")}`, options);
  }

  getSelection() {
    if (!this._input) {
      return {
        start: 0,
        end: 0,
        text: ""
      };
    }

    return {
      start: this._input.selectionStart ?? 0,
      end: this._input.selectionEnd ?? 0,
      text: this._input.value.slice(this._input.selectionStart ?? 0, this._input.selectionEnd ?? 0)
    };
  }

  setSelection(start, end = start) {
    this._assertMutable("setSelection");

    if (!this._input) {
      return false;
    }

    const nextStart = clampSelectionOffset(start, this._input.value.length);
    const nextEnd = clampSelectionOffset(end, this._input.value.length);
    this._input.setSelectionRange(nextStart, nextEnd);
    return true;
  }

  selectAll() {
    this._assertMutable("selectAll");

    if (!this._input) {
      return false;
    }

    this._input.select();
    return true;
  }

  insertText(text, options = {}) {
    this._assertMutable("insertText");

    const insertValue = String(text ?? "");

    if (!this._input) {
      return this._setValue(`${this._value}${insertValue}`, options);
    }

    const start = this._input.selectionStart ?? this._input.value.length;
    const end = this._input.selectionEnd ?? start;
    const nextValue = `${this._input.value.slice(0, start)}${insertValue}${this._input.value.slice(end)}`;
    const changed = this._setValue(nextValue, options);

    if (changed && !this.destroyed && this._input) {
      const caret = start + insertValue.length;
      this._input.setSelectionRange(caret, caret);
    }

    return changed;
  }

  calcAutoHeight() {
    if (!this._input) {
      return null;
    }

    const lineHeight = getTextareaLineHeight(this._input);
    const minHeight = this.minRows * lineHeight + getVerticalChrome(this._input);
    const maxHeight = this.maxRows == null ? Infinity : this.maxRows * lineHeight + getVerticalChrome(this._input);

    this._suppressAutoHeight = true;
    const previousHeight = this._input.style.height;
    this._input.style.height = "auto";
    const scrollHeight = this._input.scrollHeight;
    this._input.style.height = previousHeight;
    this._suppressAutoHeight = false;

    return Math.max(minHeight, Math.min(scrollHeight, maxHeight));
  }

  _syncInput(value) {
    super._syncInput(value);
    this._syncAutoHeight();
  }

  _handleKeyDown(event) {
    if (!this.acceptsReturn && event.key === "Enter") {
      event.preventDefault();
      this.events.emit("enterKey", {
        source: this,
        value: this._value,
        origin: "user",
        userAction: true
      });
      return;
    }

    if (this.acceptsTab && event.key === "Tab") {
      event.preventDefault();
      const changed = this.insertText("\t", {
        origin: "user",
        userAction: true
      });
      if (!changed || this.destroyed) return;
      this.events.emit("tabInsert", {
        source: this,
        value: this._value,
        origin: "user",
        userAction: true
      });
    }
  }

  _syncAutoHeight() {
    if (!this.autoHeight || !this._input || this._suppressAutoHeight) {
      return;
    }

    const height = this.calcAutoHeight();

    if (height != null) {
      this._input.style.height = `${height}px`;
      this._input.style.overflowY =
        this.maxRows != null && this._input.scrollHeight > height ? "auto" : this.scrollBars.overflowY;
    }
  }
}

function normalizeResize(resize) {
  if (resize === false || resize === "none") {
    return "none";
  }

  if (resize === "both" || resize === "horizontal") {
    return resize;
  }

  return "vertical";
}

function normalizeScrollBars(scrollBars) {
  switch (scrollBars) {
    case false:
    case "none":
      return { overflowX: "hidden", overflowY: "hidden" };
    case "vertical":
      return { overflowX: "hidden", overflowY: "auto" };
    case "horizontal":
      return { overflowX: "auto", overflowY: "hidden" };
    case "both":
      return { overflowX: "auto", overflowY: "auto" };
    default:
      return { overflowX: "auto", overflowY: "auto" };
  }
}

function normalizeOptionalPositiveInteger(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function clampSelectionOffset(value, length) {
  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    return 0;
  }

  return Math.max(0, Math.min(length, Math.trunc(normalized)));
}

function getTextareaLineHeight(input) {
  const styles = window.getComputedStyle(input);
  const parsed = Number.parseFloat(styles.lineHeight);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const fontSize = Number.parseFloat(styles.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 16;
}

function getVerticalChrome(input) {
  const styles = window.getComputedStyle(input);
  const values = [
    styles.paddingTop,
    styles.paddingBottom,
    styles.borderTopWidth,
    styles.borderBottomWidth
  ].map(value => Number.parseFloat(value));

  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}
