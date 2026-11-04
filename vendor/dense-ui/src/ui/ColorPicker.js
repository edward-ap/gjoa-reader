import { localize } from "./localize.js";
import { EditorControl } from "./EditorControl.js";
import { Popup } from "./Popup.js";
import { renderIcon } from "./Icon.js";

/**
 * Dependency-free RGB color editor.
 *
 * The public value is always an empty string or canonical lowercase #rrggbb.
 * HSV is only transient popup state and is never serialized.
 */
export class ColorPicker extends EditorControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({
      ...options,
      emptyValue: "",
      value: options.value ?? ""
    });

    this.allowEmpty = options.allowEmpty !== false;
    this.popupPlacement = options.popupPlacement ?? "bottom-start";
    this._labelElement = null;
    this._button = null;
    this._swatch = null;
    this._valueText = null;
    this._popup = null;
    this._plane = null;
    this._planeMarker = null;
    this._hueInput = null;
    this._hexInput = null;
    this._rgbInputs = null;
    this._preview = null;
    this._hsv = rgbToHsv(hexToRgb(this._value || "#000000"));

    this._bindOptionEvent("open", options.onOpen);
    this._bindOptionEvent("close", options.onClose);

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("label");
    root.className = ["dui-control", "dui-color-picker", this.css]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-color-picker__label";
    label.textContent = this.label;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dui-color-picker__button";
    button.dataset.duiFocusTarget = "true";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", this.label || localize(this.options, "Choose color"));

    const swatch = document.createElement("span");
    swatch.className = "dui-color-picker__swatch";
    const valueText = document.createElement("span");
    valueText.className = "dui-color-picker__value";
    button.append(swatch, valueText);

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    root.append(label, button, message);
    this._labelElement = label;
    this._button = button;
    this._swatch = swatch;
    this._valueText = valueText;
    this._input = button;
    this._message = message;
    this._syncInput(this._value);
    this._syncStateToInput();

    this.disposables.addEventListener(button, "click", () => {
      if (this.disabled || this.isReadOnly()) {
        return;
      }
      this.togglePopup({ origin: "user", userAction: true });
    });

    return root;
  }

  getRgb() {
    return hexToRgb(this._value || "#000000");
  }

  setRgb(red, green, blue, options = {}) {
    return this._setValue(rgbToHex({
      red: clampByte(red),
      green: clampByte(green),
      blue: clampByte(blue)
    }), options);
  }

  openPopup(options = {}) {
    this._assertMutable("openPopup");
    if (this.disabled || this.isReadOnly()) {
      return false;
    }
    this._ensurePopup();
    this._hsv = rgbToHsv(hexToRgb(this._value || "#000000"));
    this._syncPopup();
    const opened = this._popup.open(this._button, options);
    if (opened && !this._acceptKeyBound) {
      this._acceptKeyBound = true;
      this.disposables.addEventListener(this._popup.element, "keydown", event => {
        if (event.key !== "Enter" || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        event.preventDefault(); event.stopPropagation();
        if (this.disabled || this.isReadOnly() || this.destroyed) return;
        if (this._acceptPopup() && !this.destroyed) {
          const closed = this.closePopup({origin:"user", userAction:true, reason:"accept"});
          if (closed && !this.destroyed && !this._popup?.isOpen() && !this.disabled && !this.isReadOnly()) this._button?.focus();
        }
      });
    }
    if (opened) {
      this._button?.setAttribute("aria-expanded", "true");
      this.events.emit("open", {
        source: this,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }
    return opened;
  }

  closePopup(options = {}) {
    if (!this._popup?.isOpen()) {
      return false;
    }
    const closed = this._popup.close(options);
    if (closed) {
      this._button?.setAttribute("aria-expanded", "false");
    }
    return closed;
  }

  togglePopup(options = {}) {
    return this._popup?.isOpen()
      ? this.closePopup(options)
      : this.openPopup(options);
  }

  enable() {
    super.enable();
    this._syncStateToInput();
    return this;
  }

  disable() {
    super.disable();
    this.closePopup({ silent: true });
    this._syncStateToInput();
    return this;
  }

  setReadOnly(readOnly, options = {}) {
    super.setReadOnly(readOnly, options);
    if (readOnly) {
      this.closePopup({ silent: true });
    }
    this._syncStateToInput();
    return this;
  }

  destroy() {
    this._popup?.destroy();
    this._popup = null;
    this._labelElement = null;
    this._button = null;
    this._swatch = null;
    this._valueText = null;
    this._plane = null;
    this._planeMarker = null;
    this._hueInput = null;
    this._hexInput = null;
    this._rgbInputs = null;
    this._preview = null;
    super.destroy();
  }

  _normalizeValue(value) {
    return normalizeHexColor(value);
  }

  _syncInput(value) {
    const color = value || "transparent";
    if (this._swatch) {
      this._swatch.style.setProperty("--dui-color-picker-value", color);
      this._swatch.classList.toggle("dui-color-picker__swatch--empty", !value);
    }
    if (this._valueText) {
      this._valueText.textContent = value || localize(this.options, "No color");
    }
    if (value) {
      this._hsv = rgbToHsv(hexToRgb(value));
    }
    this._syncPopup();
  }

  _syncStateToInput() {
    if (!this._button) {
      return;
    }
    this._button.disabled = this.disabled || this.isReadOnly();
    if (this.isReadOnly()) {
      this._button.setAttribute("aria-readonly", "true");
    } else {
      this._button.removeAttribute("aria-readonly");
    }
  }

  _renderLabel() {
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }
    if (this._button) {
      this._button.setAttribute("aria-label", this.label || localize(this.options, "Choose color"));
    }
  }

  _ensurePopup() {
    if (this._popup) {
      return;
    }
    const content = this._createPopupContent();
    this._popup = new Popup({
      name: `${this.id}-popup`,
      content,
      placement: this.popupPlacement,
      className: "dui-color-picker__popup",
      role: "dialog"
    });
    this._popup.events.on("close", event => {
      this._button?.setAttribute("aria-expanded", "false");
      this.events.emit("close", {
        source: this,
        reason: event.reason,
        origin: event.origin,
        userAction: event.userAction
      });
    });
  }

  _acceptPopup() {
    let color;
    try { color = normalizeHexColor(this._hexInput.value); }
    catch { this._hexInput.setAttribute("aria-invalid", "true"); return false; }
    this._hexInput.removeAttribute("aria-invalid");
    this._setValue(color, {origin:"user", userAction:true});
    return !this.destroyed && this._value === color;
  }

  _createPopupContent() {
    const content = document.createElement("div");
    content.className = "dui-color-picker__panel";

    const plane = document.createElement("div");
    plane.className = "dui-color-picker__plane";
    plane.tabIndex = 0;
    plane.setAttribute("role", "slider");
    plane.setAttribute("aria-label", localize(this.options, "Saturation and brightness"));
    const marker = document.createElement("span");
    marker.className = "dui-color-picker__plane-marker";
    plane.append(marker);

    const tools = document.createElement("div");
    tools.className = "dui-color-picker__tools";
    const eyedropper = document.createElement("button");
    eyedropper.type = "button";
    eyedropper.className = "dui-color-picker__eyedropper";
    eyedropper.title = localize(this.options, "Pick color from screen");
    eyedropper.setAttribute("aria-label", eyedropper.title);
    eyedropper.disabled = typeof globalThis.EyeDropper !== "function";
    renderIcon(eyedropper, "eyedropper");
    const preview = document.createElement("span");
    preview.className = "dui-color-picker__preview";
    const hue = document.createElement("input");
    hue.className = "dui-color-picker__hue";
    hue.type = "range";
    hue.min = "0";
    hue.max = "360";
    hue.step = "1";
    hue.setAttribute("aria-label", localize(this.options, "Hue"));
    tools.append(eyedropper, preview, hue);

    const channels = document.createElement("div");
    channels.className = "dui-color-picker__channels";
    const red = createChannelInput("R");
    const green = createChannelInput("G");
    const blue = createChannelInput("B");
    channels.append(red.host, green.host, blue.host);

    const hexRow = document.createElement("label");
    hexRow.className = "dui-color-picker__hex-row";
    const hexLabel = document.createElement("span");
    hexLabel.textContent = "Hex";
    const hex = document.createElement("input");
    hex.type = "text";
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.setAttribute("aria-label", localize(this.options, "Hex color"));
    hexRow.append(hexLabel, hex);

    if (this.allowEmpty) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "dui-color-picker__clear";
      clear.textContent = localize(this.options, "Clear");
      clear.addEventListener("click", () => {
        this._setValue("", { origin: "user", userAction: true });
      });
      hexRow.append(clear);
    }

    content.append(plane, tools, channels, hexRow);
    this._plane = plane;
    this._planeMarker = marker;
    this._hueInput = hue;
    this._hexInput = hex;
    this._rgbInputs = {
      red: red.input,
      green: green.input,
      blue: blue.input
    };
    this._preview = preview;

    this.disposables.addEventListener(plane, "pointerdown", event => {
      if (event.button !== 0) {
        return;
      }
      plane.setPointerCapture(event.pointerId);
      this._setSaturationValueFromPointer(event);
    });
    this.disposables.addEventListener(plane, "pointermove", event => {
      if (plane.hasPointerCapture(event.pointerId)) {
        this._setSaturationValueFromPointer(event);
      }
    });
    this.disposables.addEventListener(plane, "keydown", event => {
      const step = event.shiftKey ? 0.1 : 0.01;
      if (event.key === "ArrowLeft") this._hsv.saturation -= step;
      else if (event.key === "ArrowRight") this._hsv.saturation += step;
      else if (event.key === "ArrowUp") this._hsv.value += step;
      else if (event.key === "ArrowDown") this._hsv.value -= step;
      else return;
      event.preventDefault();
      this._hsv.saturation = clamp01(this._hsv.saturation);
      this._hsv.value = clamp01(this._hsv.value);
      this._commitHsv();
    });
    this.disposables.addEventListener(hue, "input", () => {
      this._hsv.hue = Number(hue.value);
      this._commitHsv();
    });
    for (const input of Object.values(this._rgbInputs)) {
      this.disposables.addEventListener(input, "input", () => {
        const rgb = {
          red: clampByte(this._rgbInputs.red.value),
          green: clampByte(this._rgbInputs.green.value),
          blue: clampByte(this._rgbInputs.blue.value)
        };
        this._hsv = rgbToHsv(rgb);
        this._setValue(rgbToHex(rgb), { origin: "user", userAction: true });
      });
    }
    this.disposables.addEventListener(hex, "change", () => {
      try {
        this._setValue(hex.value, { origin: "user", userAction: true });
      } catch {
        hex.value = this._value;
      }
    });
    this.disposables.addEventListener(eyedropper, "click", async () => {
      if (typeof globalThis.EyeDropper !== "function") {
        return;
      }
      try {
        const result = await new globalThis.EyeDropper().open();
        if (this.destroyed) return;
        this._setValue(result.sRGBHex, { origin: "user", userAction: true });
      } catch (error) {
        if (this.destroyed) return;
        if (error?.name !== "AbortError") {
          throw error;
        }
      }
    });

    return content;
  }

  _setSaturationValueFromPointer(event) {
    const bounds = this._plane.getBoundingClientRect();
    this._hsv.saturation = clamp01((event.clientX - bounds.left) / bounds.width);
    this._hsv.value = clamp01(1 - (event.clientY - bounds.top) / bounds.height);
    this._commitHsv();
  }

  _commitHsv() {
    this._setValue(rgbToHex(hsvToRgb(this._hsv)), {
      origin: "user",
      userAction: true
    });
  }

  _syncPopup() {
    if (!this._plane || !this._rgbInputs) {
      return;
    }
    const rgb = hexToRgb(this._value || "#000000");
    this._plane.style.setProperty(
      "--dui-color-picker-hue",
      `hsl(${this._hsv.hue} 100% 50%)`
    );
    this._planeMarker.style.left = `${this._hsv.saturation * 100}%`;
    this._planeMarker.style.top = `${(1 - this._hsv.value) * 100}%`;
    this._hueInput.value = String(Math.round(this._hsv.hue));
    this._hexInput.value = this._value || "";
    this._rgbInputs.red.value = String(rgb.red);
    this._rgbInputs.green.value = String(rgb.green);
    this._rgbInputs.blue.value = String(rgb.blue);
    if (this._value) {
      this._preview.style.background = this._value;
    } else {
      this._preview.style.removeProperty("background");
    }
    this._preview.classList.toggle("dui-color-picker__preview--empty", !this._value);
  }
}

function createChannelInput(label) {
  const host = document.createElement("label");
  host.className = "dui-color-picker__channel";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "255";
  input.step = "1";
  input.setAttribute("aria-label", `${label} channel`);
  const caption = document.createElement("span");
  caption.textContent = label;
  host.append(input, caption);
  return { host, input };
}

export function normalizeHexColor(value) {
  if (value == null || value === "") {
    return "";
  }
  const text = String(value).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(text)) {
    return text;
  }
  const rgb = text.match(
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/
  );
  if (rgb && rgb.slice(1).every(channel => Number(channel) <= 255)) {
    return rgbToHex({
      red: Number(rgb[1]),
      green: Number(rgb[2]),
      blue: Number(rgb[3])
    });
  }
  throw new TypeError(`Invalid RGB color: ${String(value)}.`);
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex) || "#000000";
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16)
  };
}

function rgbToHex({ red, green, blue }) {
  return `#${[red, green, blue]
    .map(channel => clampByte(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbToHsv({ red, green, blue }) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;

  if (delta !== 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum
  };
}

function hsvToRgb({ hue, saturation, value }) {
  const chroma = value * saturation;
  const section = ((hue % 360) + 360) % 360 / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  let channels;

  if (section < 1) channels = [chroma, secondary, 0];
  else if (section < 2) channels = [secondary, chroma, 0];
  else if (section < 3) channels = [0, chroma, secondary];
  else if (section < 4) channels = [0, secondary, chroma];
  else if (section < 5) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];

  const match = value - chroma;
  return {
    red: Math.round((channels[0] + match) * 255),
    green: Math.round((channels[1] + match) * 255),
    blue: Math.round((channels[2] + match) * 255)
  };
}

function clampByte(value) {
  const number = Number(value);
  return Math.round(Math.min(255, Math.max(0, Number.isFinite(number) ? number : 0)));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
