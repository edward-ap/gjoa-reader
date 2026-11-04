import { BaseControl } from "../core/BaseControl.js";
import { renderIcon } from "./Icon.js";

const TONES = new Set(["neutral", "info", "success", "warning", "danger"]);
const SPACING = new Set(["compact", "normal", "comfortable"]);
const BLOCK_TYPES = new Set(["heading", "paragraph", "list", "keyValue", "definitionList"]);

export class TextLayout extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.css = options.css ?? options.className ?? "";
    this.title = String(options.title ?? "");
    this.tone = normalizeTone(options.tone ?? options.appearance ?? "neutral");
    this.background = normalizeBackground(
      Object.prototype.hasOwnProperty.call(options, "background")
        ? options.background
        : this.tone !== "neutral"
    );
    this.bordered = options.bordered === true || options.border === true;
    this.spacing = normalizeSpacing(options.spacing ?? "normal");
    this.icon = normalizeIcon(options.icon, this.tone);
    this._content = normalizeContent(options.content ?? options.blocks ?? options.text ?? "");
    this._iconElement = null;
    this._titleElement = null;
    this._contentElement = null;

    this._bindOptionEvent("contentChange", options.onContentChange);
    this._bindOptionEvent("appearanceChange", options.onAppearanceChange);

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("section");
    root.className = ["dui-control", "dui-text-layout", this.css].filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;

    const icon = document.createElement("span");
    icon.className = "dui-text-layout__icon";

    const body = document.createElement("div");
    body.className = "dui-text-layout__body";

    const title = document.createElement("div");
    title.className = "dui-text-layout__title";

    const content = document.createElement("div");
    content.className = "dui-text-layout__content";

    body.append(title, content);
    root.append(icon, body);
    this._iconElement = icon;
    this._titleElement = title;
    this._contentElement = content;
    this._render(root);
    return root;
  }

  destroy() {
    super.destroy();
    this._iconElement = null;
    this._titleElement = null;
    this._contentElement = null;
  }

  getTitle() {
    return this.title;
  }

  setTitle(title, options = {}) {
    this._assertMutable("setTitle");
    const oldValue = this.title;
    this.title = String(title ?? "");
    this._render();
    this._emitAppearanceChange("title", oldValue, this.title, options);
    return this;
  }

  getContent() {
    return cloneContent(this._content);
  }

  setContent(content, options = {}) {
    this._assertMutable("setContent");
    const oldValue = this.getContent();
    const next = normalizeContent(content);
    this._content = next;
    this._renderContent();

    if (!options.silent && JSON.stringify(oldValue) !== JSON.stringify(next)) {
      this.events.emit("contentChange", {
        source: this,
        oldValue,
        newValue: this.getContent(),
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }
    return this;
  }

  setText(text, options = {}) {
    return this.setContent(String(text ?? ""), options);
  }

  getTone() {
    return this.tone;
  }

  setTone(tone, options = {}) {
    this._assertMutable("setTone");
    const oldValue = this.tone;
    this.tone = normalizeTone(tone);
    if (options.keepIcon !== true) {
      this.icon = normalizeIcon(undefined, this.tone);
    }
    this._render();
    this._emitAppearanceChange("tone", oldValue, this.tone, options);
    return this;
  }

  hasBackground() {
    return this.background;
  }

  setBackground(background, options = {}) {
    this._assertMutable("setBackground");
    const oldValue = this.background;
    this.background = normalizeBackground(background);
    this._renderAppearance();
    this._emitAppearanceChange("background", oldValue, this.background, options);
    return this;
  }

  isBordered() {
    return this.bordered;
  }

  setBordered(bordered, options = {}) {
    this._assertMutable("setBordered");
    const oldValue = this.bordered;
    this.bordered = bordered === true;
    this._renderAppearance();
    this._emitAppearanceChange("bordered", oldValue, this.bordered, options);
    return this;
  }

  setSpacing(spacing, options = {}) {
    this._assertMutable("setSpacing");
    const oldValue = this.spacing;
    this.spacing = normalizeSpacing(spacing);
    this._renderAppearance();
    this._emitAppearanceChange("spacing", oldValue, this.spacing, options);
    return this;
  }

  setIcon(icon, options = {}) {
    this._assertMutable("setIcon");
    const oldValue = this.icon;
    this.icon = icon === false || icon == null ? "" : String(icon);
    this._renderIcon();
    this._emitAppearanceChange("icon", oldValue, this.icon, options);
    return this;
  }

  _render(root = this.element) {
    this._renderAppearance(root);
    this._renderIcon(root);
    if (this._titleElement) {
      this._titleElement.textContent = this.title;
      this._titleElement.hidden = this.title.length === 0;
    }
    if (root) {
      if (this.title) {
        root.setAttribute("aria-label", this.title);
      } else {
        root.removeAttribute("aria-label");
      }
    }
    this._renderContent();
  }

  _renderAppearance(root = this.element) {
    if (!root) return;
    for (const tone of TONES) {
      root.classList.toggle(`dui-text-layout--${tone}`, this.tone === tone);
    }
    for (const spacing of SPACING) {
      root.classList.toggle(`dui-text-layout--${spacing}`, this.spacing === spacing);
    }
    root.classList.toggle("dui-text-layout--background", this.background);
    root.classList.toggle("dui-text-layout--bordered", this.bordered);
    root.classList.toggle("dui-text-layout--with-icon", Boolean(this.icon));
  }

  _renderIcon(root = this.element) {
    if (this._iconElement) {
      renderIcon(this._iconElement, this.icon);
    }
    root?.classList.toggle("dui-text-layout--with-icon", Boolean(this.icon));
  }

  _renderContent() {
    if (!this._contentElement) return;
    this._contentElement.replaceChildren(
      ...this._content.map(block => renderBlock(block))
    );
  }

  _emitAppearanceChange(name, oldValue, value, options = {}) {
    if (options.silent || oldValue === value) return;
    this.events.emit("appearanceChange", {
      source: this,
      name,
      oldValue,
      value,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
  }
}

function normalizeContent(content) {
  if (typeof content === "string" || content == null) {
    const text = String(content ?? "").trim();
    if (!text) return [];
    return text.split(/\n\s*\n/).map(value => ({ type: "paragraph", text: value.trim() }));
  }
  if (!Array.isArray(content)) {
    throw new TypeError("TextLayout content must be a string or an array of text blocks.");
  }
  return content.map((block, index) => normalizeBlock(block, index));
}

function normalizeBlock(block, index) {
  if (typeof block === "string") {
    return { type: "paragraph", text: block };
  }
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    throw new TypeError(`TextLayout block ${index} must be a string or object.`);
  }
  const type = block.type ?? "paragraph";
  if (!BLOCK_TYPES.has(type)) {
    throw new TypeError(`Unsupported TextLayout block type "${String(type)}".`);
  }
  if (type === "list") {
    if (!Array.isArray(block.items)) {
      throw new TypeError(`TextLayout list block ${index} requires an items array.`);
    }
    return {
      type,
      ordered: block.ordered === true,
      items: block.items.map(item => String(item ?? ""))
    };
  }
  if (type === "keyValue") {
    return {
      type,
      label: String(block.label ?? ""),
      value: String(block.value ?? "")
    };
  }
  if (type === "definitionList") {
    if (!Array.isArray(block.items)) {
      throw new TypeError(`TextLayout definitionList block ${index} requires an items array.`);
    }
    return {
      type,
      items: block.items.map(item => ({
        term: String(item?.term ?? item?.label ?? ""),
        definition: String(item?.definition ?? item?.value ?? "")
      }))
    };
  }
  return {
    type,
    text: String(block.text ?? ""),
    ...(type === "heading" ? { level: normalizeHeadingLevel(block.level) } : {})
  };
}

function renderBlock(block) {
  if (block.type === "heading") {
    const heading = document.createElement(`h${block.level}`);
    heading.className = "dui-text-layout__heading";
    heading.textContent = block.text;
    return heading;
  }
  if (block.type === "list") {
    const list = document.createElement(block.ordered ? "ol" : "ul");
    list.className = "dui-text-layout__list";
    for (const item of block.items) {
      const row = document.createElement("li");
      row.textContent = item;
      list.append(row);
    }
    return list;
  }
  if (block.type === "keyValue") {
    const row = document.createElement("div");
    row.className = "dui-text-layout__key-value";
    const label = document.createElement("span");
    label.className = "dui-text-layout__key";
    label.textContent = block.label;
    const value = document.createElement("span");
    value.className = "dui-text-layout__value";
    value.textContent = block.value;
    row.append(label, value);
    return row;
  }
  if (block.type === "definitionList") {
    const list = document.createElement("dl");
    list.className = "dui-text-layout__definition-list";
    for (const item of block.items) {
      const term = document.createElement("dt");
      term.className = "dui-text-layout__definition-term";
      term.textContent = item.term;
      const definition = document.createElement("dd");
      definition.className = "dui-text-layout__definition-value";
      definition.textContent = item.definition;
      list.append(term, definition);
    }
    return list;
  }
  const paragraph = document.createElement("p");
  paragraph.className = "dui-text-layout__paragraph";
  paragraph.textContent = block.text;
  return paragraph;
}

function normalizeTone(value) {
  const tone = String(value ?? "neutral");
  if (!TONES.has(tone)) {
    throw new TypeError("TextLayout tone must be neutral, info, success, warning, or danger.");
  }
  return tone;
}

function normalizeSpacing(value) {
  const spacing = String(value ?? "normal");
  if (!SPACING.has(spacing)) {
    throw new TypeError("TextLayout spacing must be compact, normal, or comfortable.");
  }
  return spacing;
}

function normalizeBackground(value) {
  if (value === "none" || value === false || value == null) return false;
  if (value === "subtle" || value === true) return true;
  throw new TypeError("TextLayout background must be true, false, subtle, or none.");
}

function normalizeIcon(value, tone) {
  if (value === false || value === "") return "";
  if (value != null) return String(value);
  return { info: "info", success: "check", warning: "warning", danger: "warning" }[tone] ?? "";
}

function normalizeHeadingLevel(value) {
  const level = Number(value ?? 3);
  return Number.isInteger(level) && level >= 2 && level <= 4 ? level : 3;
}

function cloneContent(content) {
  return content.map(block => ({
    ...block,
    ...(Array.isArray(block.items)
      ? { items: block.items.map(item => item && typeof item === "object" ? { ...item } : item) }
      : {})
  }));
}
