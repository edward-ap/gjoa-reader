import { Panel } from "./Panel.js";

// Section content consists of live controls owned by this container.
export class Accordion extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer = typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    super({ ...options, bordered: options.bordered !== false });
    this.multiple = options.multiple === true;
    this._sections = new Map();
    this._nextSectionId = 1;
    this._bindOptionEvent("beforeChange", options.onBeforeChange);
    this._bindOptionEvent("change", options.onChange);
    if (hasContainer) this.mount(containerOrOptions);
  }

  createElement() {
    const root = super.createElement();
    root.classList.add("dui-accordion");
    this.disposables.addEventListener(root, "click", event => {
      const section = this._sectionForHeader(event.target);
      if (section) this.toggle(section.name, { origin: "user", userAction: true });
    });
    this.disposables.addEventListener(root, "keydown", event => {
      const section = this._sectionForHeader(event.target);
      if (!section || this.disabled) return;
      const sections = [...this._sections.values()].filter(item => !item.disabled);
      const index = sections.indexOf(section);
      const target = {
        ArrowDown: (index + 1) % sections.length,
        ArrowUp: (index - 1 + sections.length) % sections.length,
        Home: 0,
        End: sections.length - 1
      }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      sections[target]?.button.focus();
    });
    return root;
  }

  addSection(options, content) {
    this._assertMutable("addSection");
    this._assertControl(content);
    if (!this.mounted) throw new Error("Accordion must be mounted before adding sections.");
    const name = options?.name;
    if (typeof name !== "string" || !name) throw new TypeError("Accordion sections require a nonempty name.");
    if (this._sections.has(name)) throw new Error(`Duplicate accordion section: ${name}.`);
    if (content.parent || content.mounted) throw new Error("Accordion section content must be unowned and unmounted.");
    for (const key of [content.id, content.name]) {
      if (key && this.getItem(key)) throw new Error(`Duplicate child control key: ${key}.`);
    }

    const id = `${this.id}-section-${this._nextSectionId++}`;
    const element = document.createElement("section");
    element.className = "dui-accordion__section";
    const heading = document.createElement("h3");
    heading.className = "dui-accordion__heading";
    const button = document.createElement("button");
    button.type = "button";
    button.id = `${id}-header`;
    button.className = "dui-accordion__header";
    button.textContent = options.title ?? name;
    button.setAttribute("aria-controls", `${id}-content`);
    const region = document.createElement("div");
    region.id = `${id}-content`;
    region.className = "dui-accordion__content";
    region.setAttribute("role", "region");
    region.setAttribute("aria-labelledby", button.id);
    heading.append(button);
    element.append(heading, region);
    this.element.append(element);
    const section = { name, content, element, button, region, disabled: options.disabled === true, expanded: false };
    this._sections.set(name, section);
    try {
      if (!this.attach(content, { container: region })) {
        this._sections.delete(name);
        element.remove();
        return null;
      }
    } catch (error) {
      this._sections.delete(name);
      element.remove();
      throw error;
    }
    if (options.expanded === true && !section.disabled) {
      if (!this.multiple) for (const other of this._sections.values()) other.expanded = false;
      section.expanded = true;
    }
    this._syncSections();
    return content;
  }

  getSection(name) {
    return this._sections.get(name)?.content ?? null;
  }

  getExpanded() {
    return [...this._sections.values()].filter(section => section.expanded).map(section => section.name);
  }

  isExpanded(name) {
    return this._sections.get(name)?.expanded ?? false;
  }

  expand(name, options) { return this.setExpanded(name, true, options); }
  collapse(name, options) { return this.setExpanded(name, false, options); }
  toggle(name, options) { return this.setExpanded(name, !this.isExpanded(name), options); }

  setExpanded(name, expanded, options = {}) {
    this._assertMutable("setExpanded");
    const section = this._sections.get(name);
    const next = expanded === true;
    if (!section || section.expanded === next || (next && section.disabled) ||
      (options.userAction && (this.disabled || section.disabled))) return false;
    const oldValue = this.getExpanded();
    const newValue = [...this._sections.values()].filter(item =>
      item === section ? next : item.expanded && (!next || this.multiple)
    ).map(item => item.name);
    const event = { source: this, name, expanded: next, oldValue, newValue,
      origin: options.origin ?? "api", userAction: options.userAction === true };
    if (!options.silent) {
      const before = { ...event, oldValue: [...oldValue], newValue: [...newValue], cancel: false };
      this.events.emit("beforeChange", before);
      if (before.cancel || this.destroyed || !this._sections.has(name)) return false;
    }
    for (const item of this._sections.values()) item.expanded = newValue.includes(item.name);
    this._syncSections();
    if (!options.silent) this.events.emit("change", event);
    return true;
  }

  removeSection(name, options) {
    this._assertMutable("removeSection");
    const content = this.getSection(name);
    return content ? this.remove(content, options) : null;
  }

  remove(controlOrName, options = {}) {
    const content = typeof controlOrName === "string" ? this.getItem(controlOrName) : controlOrName;
    const section = [...this._sections.values()].find(item => item.content === content);
    const removed = super.remove(controlOrName, options);
    if (removed && section) {
      this._sections.delete(section.name);
      section.element.remove();
    }
    return removed;
  }

  _forgetControl(control) {
    super._forgetControl(control);
    for (const section of this._sections.values()) {
      if (section.content !== control) continue;
      this._sections.delete(section.name);
      section.element.remove();
    }
  }

  enable() { super.enable(); this._syncSections(); return this; }
  disable() { super.disable(); this._syncSections(); return this; }

  _sectionForHeader(target) {
    const button = target.closest?.(".dui-accordion__header");
    return [...this._sections.values()].find(section => section.button === button);
  }

  _syncSections() {
    for (const section of this._sections.values()) {
      // Keep focus out of hidden descendants without changing their model values.
      if (!section.expanded && section.region.contains(document.activeElement)) section.button.focus();
      section.button.disabled = this.disabled || section.disabled;
      section.button.setAttribute("aria-expanded", String(section.expanded));
      section.region.hidden = !section.expanded;
    }
  }
}
