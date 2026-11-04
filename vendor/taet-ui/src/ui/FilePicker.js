import { EditorControl } from "./EditorControl.js";

export class FilePicker extends EditorControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const multiple = options.multiple === true;

    super({
      ...options,
      emptyValue: Object.prototype.hasOwnProperty.call(options, "emptyValue")
        ? options.emptyValue
        : multiple
          ? []
          : null
    });

    this.multiple = multiple;
    this.accept = options.accept ?? "";
    this.directory = options.directory === true || options.webkitdirectory === true;
    this.buttonText = options.buttonText ?? "Browse";
    this.clearable = options.clearable !== false;
    this.placeholder = options.placeholder ?? "";
    this.displayMode = options.displayMode ?? "name";
    this._labelElement = null;
    this._groupElement = null;
    this._displayElement = null;
    this._browseButton = null;
    this._clearButton = null;
    this._fileInput = null;
    this._selectedFiles = [];
    this._emptyValue = this._normalizeValue(
      Object.prototype.hasOwnProperty.call(options, "emptyValue")
        ? options.emptyValue
        : this.multiple
          ? []
          : null
    );
    this._value = this._normalizeValue(
      Object.prototype.hasOwnProperty.call(options, "value") ? options.value : this._emptyValue
    );
    this._cleanValue = this._cloneValue(this._getValue());
    this._filesValue = this._value;
    this._pendingFiles = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-file-picker", this.css].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-text-field__label dui-file-picker__label";
    label.textContent = this.label;

    const group = document.createElement("span");
    group.className = "dui-file-picker__group";

    const display = document.createElement("input");
    display.className = "dui-text-field__input dui-file-picker__display";
    display.type = "text";
    display.placeholder = this.placeholder;
    display.readOnly = true;
    display.disabled = this.disabled;
    display.dataset.duiFocusTarget = "true";

    const browseButton = document.createElement("button");
    browseButton.className = "dui-file-picker__browse";
    browseButton.type = "button";
    browseButton.textContent = this.buttonText;

    const clearButton = document.createElement("button");
    clearButton.className = "dui-file-picker__clear";
    clearButton.type = "button";
    clearButton.setAttribute("aria-label", "Clear file selection");
    clearButton.title = "Clear";

    const fileInput = document.createElement("input");
    fileInput.className = "dui-file-picker__input";
    fileInput.type = "file";
    fileInput.hidden = true;
    fileInput.multiple = this.multiple;

    if (this.accept) {
      fileInput.accept = this.accept;
    }

    if (this.directory) {
      fileInput.setAttribute("webkitdirectory", "");
      fileInput.setAttribute("directory", "");
    }

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    group.append(display, browseButton);

    if (this.clearable) {
      group.append(clearButton);
    }

    group.append(fileInput);
    root.append(label, group, message);

    this._labelElement = label;
    this._groupElement = group;
    this._displayElement = display;
    this._browseButton = browseButton;
    this._clearButton = clearButton;
    this._fileInput = fileInput;
    this._input = display;
    this._message = message;

    this._syncInput(this._value);
    this._syncStateToInput();

    this.disposables.addEventListener(browseButton, "click", event => {
      event.preventDefault();
      this.openPicker({
        origin: "user",
        userAction: true
      });
    });

    this.disposables.addEventListener(display, "dblclick", () => {
      this.openPicker({
        origin: "user",
        userAction: true
      });
    });

    this.disposables.addEventListener(fileInput, "change", () => {
      const files = Array.from(fileInput.files ?? []);
      const nextValue = this.multiple
        ? files.map(fileToMetadata)
        : fileToMetadata(files[0] ?? null);
      this._pendingFiles = files;
      try {
        const changed = this._setValue(nextValue, { origin: "user", userAction: true });
        if (!changed && !this.destroyed) fileInput.value = "";
      } finally {
        this._pendingFiles = null;
      }
    });

    if (clearButton) {
      this.disposables.addEventListener(clearButton, "click", event => {
        event.preventDefault();
        this.clearFiles({
          origin: "user",
          userAction: true
        });
      });
    }

    return root;
  }

  destroy() {
    super.destroy();
    this._labelElement = null;
    this._groupElement = null;
    this._displayElement = null;
    this._browseButton = null;
    this._clearButton = null;
    this._fileInput = null;
    this._selectedFiles = [];
    this._pendingFiles = null;
    this._filesValue = null;
  }

  enable() {
    super.enable();
    this._syncStateToInput();
    return this;
  }

  disable() {
    super.disable();
    this._syncStateToInput();
    return this;
  }

  openPicker(options = {}) {
    this._assertMutable("openPicker");

    if (this.disabled || this.isReadOnly() || !this._fileInput) {
      return false;
    }

    this.events.emit("beforeOpen", {
      source: this,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
    if (this.destroyed || this.disabled || this.isReadOnly() || !this._fileInput) return false;

    this._fileInput.click();
    return true;
  }

  clearFiles(options = {}) {
    this._assertMutable("clearFiles");

    return this._setValue(this._emptyValue, options);
  }

  getFiles() {
    return [...this._selectedFiles];
  }

  isDirty() {
    const current = Array.isArray(this._value) ? this._value : this._value ? [this._value] : [];
    const clean = Array.isArray(this._cleanValue) ? this._cleanValue : this._cleanValue ? [this._cleanValue] : [];
    return current.length !== clean.length || current.some((item, index) =>
      ["name", "size", "type", "lastModified", "relativePath"].some(key => !Object.is(item[key], clean[index]?.[key])));
  }

  _normalizeValue(value) {
    if (this.multiple) {
      if (!Array.isArray(value)) {
        return [];
      }

      return value.map(item => normalizeMetadata(item)).filter(Boolean);
    }

    return normalizeMetadata(value);
  }

  _cloneValue(value) {
    if (Array.isArray(value)) {
      return value.map(item => ({ ...item }));
    }

    return value ? { ...value } : null;
  }

  _syncInput(value) {
    // Only an accepted write changes _value; veto synchronization keeps the old file handles.
    if (value === this._value && value !== this._filesValue) {
      this._selectedFiles = this._pendingFiles ?? [];
      this._pendingFiles = null;
      this._filesValue = value;
      if (this._fileInput && this._selectedFiles.length === 0) this._fileInput.value = "";
    }
    if (this._displayElement) {
      this._displayElement.value = formatDisplayValue(value, this.displayMode);
    }

    if (this._clearButton) {
      this._clearButton.hidden = isEmptyValue(value);
    }
  }

  _syncStateToInput() {
    if (this._displayElement) {
      this._displayElement.disabled = this.disabled;
      this._displayElement.readOnly = true;
      this._displayElement.required = this.isRequired();
    }

    if (this._browseButton) {
      this._browseButton.disabled = this.disabled || this.isReadOnly();
    }

    if (this._clearButton) {
      this._clearButton.disabled = this.disabled || this.isReadOnly();
    }

    if (this._fileInput) {
      this._fileInput.disabled = this.disabled || this.isReadOnly();
    }
  }

  _renderLabel() {
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }
  }
}

function fileToMetadata(file) {
  if (!file) {
    return null;
  }

  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    relativePath: file.webkitRelativePath || ""
  };
}

function normalizeMetadata(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof File !== "undefined" && value instanceof File) {
    return fileToMetadata(value);
  }

  if (typeof value === "string") {
    return {
      name: value,
      size: null,
      type: "",
      lastModified: null,
      relativePath: ""
    };
  }

  if (typeof value === "object") {
    return {
      name: value.name ?? value.path ?? "",
      size: value.size ?? null,
      type: value.type ?? "",
      lastModified: value.lastModified ?? null,
      relativePath: value.relativePath ?? value.webkitRelativePath ?? value.path ?? ""
    };
  }

  return null;
}

function formatDisplayValue(value, displayMode) {
  const items = Array.isArray(value) ? value : value ? [value] : [];

  if (items.length === 0) {
    return "";
  }

  if (displayMode === "count" && items.length > 1) {
    return `${items.length} files`;
  }

  return items.map(item => item.relativePath || item.name).join("; ");
}

function isEmptyValue(value) {
  return Array.isArray(value) ? value.length === 0 : value == null;
}
