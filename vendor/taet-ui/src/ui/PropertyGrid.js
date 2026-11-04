import { BaseControl } from "../core/BaseControl.js";
import { DataStore } from "../core/DataStore.js";
import { SelectionModel } from "../core/SelectionModel.js";
import { gridEditors, isGridEditorFactory } from "./GridEditors.js";
import { Switch } from "./Switch.js";

export class PropertyGrid extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);
    this.css = options.css ?? "";
    this.className = options.className ?? "";
    this.labelWidth = normalizeLabelWidth(options.labelWidth ?? 120);
    this.minLabelWidth = options.minLabelWidth ?? 72;
    this.minValueWidth = options.minValueWidth ?? 96;
    this.showCategories = options.showCategories !== false;
    this.sortMode = normalizePropertySortMode(options.sortMode ?? "categorized");
    this.defaultEditors = createDefaultEditors(options.defaultEditors);
    this.data = new DataStore({ idField: "__duiPropertyId" });
    this.selection = new SelectionModel({ multiple: false });
    this.propertyControls = {};
    this._source = null;
    this._groups = [];
    this._selectedPropertyRow = null;
    this._collapsedCategories = new Set(options.collapsedCategories ?? []);
    this._expandedProperties = new Set(options.expandedProperties ?? []);
    this._editing = null;
    this._inlineEditors = [];
    this._resizeCleanup = null;

    this._columns = {
      name: { id: "name", title: "Property", readOnly: true },
      value: {
        id: "value",
        title: "Value",
        readOnly: row => !isPropertyEditable(row),
        editor: row => this._getPropertyEditor(row),
        render: (value, row) => renderPropertyValue(value, row)
      }
    };

    this.disposables.add(this.data.events.on("change", () => this._renderRows()));
    this.disposables.add(this.selection.events.on("change", event => this._handleSelectionChange(event)));

    if (options.source) this.bind(options.source, { silent: true, origin: "system" });
    if (hasContainer) this.mount(containerOrOptions);
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-property-grid", this.css, this.className]
      .filter(Boolean).join(" ");
    root.dataset.duiControlId = this.id;
    root.setAttribute("role", "treegrid");
    root.setAttribute("aria-colcount", "2");
    root.style.setProperty("--dui-property-name-width", `${this.labelWidth}px`);

    const body = document.createElement("div");
    body.className = "dui-property-grid__body";
    body.setAttribute("role", "rowgroup");
    root.append(body);
    this._body = body;

    this.disposables.addEventListener(body, "click", event => this._handleClick(event));
    this.disposables.addEventListener(body, "dblclick", event => this._handleDoubleClick(event));
    this.disposables.addEventListener(body, "keydown", event => this._handleKeyDown(event));
    this.disposables.addEventListener(body, "pointerdown", event => this._handlePointerDown(event));
    return root;
  }

  mount(container) {
    super.mount(container);
    this._renderRows();
    return this;
  }

  bind(source, options = {}) {
    this._assertMutable("bind");
    if (!source) return this.clear(options);
    const model = normalizePropertyModel(source);
    this._source = model.source ?? source;
    this._groups = model.groups;
    this._selectedPropertyRow = null;
    this.propertyControls = {};

    const visibleRows = this._visibleRows();
    const allRows = flattenPropertyRows(this._groups, {
      showCategories: false,
      sortMode: this.sortMode,
      includeCollapsedProperties: true
    });
    for (const row of allRows) this._indexPropertyRow(row);
    for (const row of visibleRows.filter(isPropertyRow)) this._replaceIndexedPropertyRow(row);
    this.data.parse(visibleRows, { ...options, origin: options.origin ?? "api" });
    this.selection.clear({ silent: true, origin: "system" });
    this._renderRows();

    if (!options.silent) {
      this.events.emit("bind", {
        source: this, target: this._source, groups: this._groups,
        origin: options.origin ?? "api", userAction: options.userAction === true
      });
    }
    return this;
  }

  refresh(options = {}) {
    this._assertMutable("refresh");
    if (this._source) this.bind(this._source, { ...options, origin: options.origin ?? "api" });
    return this;
  }

  clear(options = {}) {
    this._assertMutable("clear");
    const oldSource = this._source;
    this.cancelEdit({ silent: true, origin: "system" });
    this._source = null;
    this._groups = [];
    this._selectedPropertyRow = null;
    this.propertyControls = {};
    this.selection.clear({ silent: true, origin: "system" });
    this.data.clear({ ...options, origin: options.origin ?? "api" });
    this._renderRows();
    if (!options.silent) {
      this.events.emit("clear", {
        source: this, target: oldSource,
        origin: options.origin ?? "api", userAction: options.userAction === true
      });
    }
    return this;
  }

  getColumn(id) { return this._columns[id] ?? null; }
  getPropertyControl(name) { return this.propertyControls[name] ?? null; }
  getSelectedProperty() { return this._selectedPropertyRow?.property ?? null; }
  getSelectedPropertyDescription() {
    const property = this.getSelectedProperty();
    return property ? property.description ?? property.help ?? "" : "";
  }

  selectProperty(pathOrName, options = {}) {
    this._assertMutable("selectProperty");
    let row = this.getPropertyControl(pathOrName);
    if (!row) return false;
    if (this.isCategoryCollapsed(row.categoryId)) {
      this.expandCategory(row.categoryId, { ...options, silent: true, reason: "property-selection" });
      if (this.destroyed) return false;
      row = this.getPropertyControl(pathOrName);
      if (!row) return false;
    }
    const changed = this.selection.set([row], { ...options, origin: options.origin ?? "api" });
    if (this.destroyed || this.selection.destroyed || this.selection.get()[0] !== row) return changed;
    this._syncSelectionState();
    this._rowElement(row)?.scrollIntoView({ block: "nearest" });
    return changed;
  }

  clearPropertySelection(options = {}) {
    this._assertMutable("clearPropertySelection");
    const changed = this.selection.clear({ ...options, origin: options.origin ?? "api" });
    if (this.destroyed || this.selection.destroyed) return changed;
    this._syncSelectionState();
    return changed;
  }

  isCategoryCollapsed(id) { return this._collapsedCategories.has(id); }
  getCollapsedCategories() { return [...this._collapsedCategories]; }
  collapseCategory(id, options = {}) { return this._setCategoryCollapsed(id, true, options); }
  expandCategory(id, options = {}) { return this._setCategoryCollapsed(id, false, options); }
  toggleCategory(id, options = {}) {
    return this._setCategoryCollapsed(id, !this.isCategoryCollapsed(id), options);
  }

  isPropertyExpanded(pathOrName) {
    const row = this.getPropertyControl(pathOrName);
    return row ? this._expandedProperties.has(row.propertyKey) : false;
  }
  getExpandedProperties() { return [...this._expandedProperties]; }
  expandProperty(pathOrName, options = {}) { return this._setPropertyExpanded(pathOrName, true, options); }
  collapseProperty(pathOrName, options = {}) { return this._setPropertyExpanded(pathOrName, false, options); }
  toggleProperty(pathOrName, options = {}) {
    return this._setPropertyExpanded(pathOrName, !this.isPropertyExpanded(pathOrName), options);
  }

  setSortMode(sortMode, options = {}) {
    const next = normalizePropertySortMode(sortMode);
    if (next === this.sortMode) return false;
    this.sortMode = next;
    this.refresh({ ...options, reason: options.reason ?? "sort-mode" });
    return true;
  }

  setShowCategories(show, options = {}) {
    const next = show !== false;
    if (next === this.showCategories) return false;
    this.showCategories = next;
    this.refresh({ ...options, reason: options.reason ?? "show-categories" });
    return true;
  }

  setLabelWidth(width, options = {}) {
    this._assertMutable("setLabelWidth");
    const next = Math.max(this.minLabelWidth, Number(width));
    if (!Number.isFinite(next) || next === this.labelWidth) return false;
    const oldValue = this.labelWidth;
    this.labelWidth = next;
    this.element?.style.setProperty("--dui-property-name-width", `${next}px`);
    if (!options.silent) {
      this.events.emit("labelWidthChange", {
        source: this, oldValue, value: next,
        origin: options.origin ?? "api", userAction: options.userAction === true
      });
    }
    return true;
  }

  setDefaultEditor(type, editor) {
    assertPropertyTypeName(type);
    this.defaultEditors.set(type, normalizePropertyEditor(editor));
    this._renderRows();
    return this;
  }

  removeDefaultEditor(type) {
    assertPropertyTypeName(type);
    const deleted = this.defaultEditors.delete(type);
    this._renderRows();
    return deleted;
  }

  startEdit(itemOrId, _columnId = "value", options = {}) {
    this._assertMutable("startEdit");
    if (this.disabled) return false;
    const row = typeof itemOrId === "object"
      ? itemOrId
      : this.data.get(itemOrId) ?? this.getPropertyControl(itemOrId);
    if (!isPropertyEditable(row) || this._editing?.row === row) return false;
    if (isInlinePropertyEditor(row.property.type)) {
      const inline = this._inlineEditors.find(entry => entry.row === row);
      if (!inline) return false;
      inline.editor.focus();
      return true;
    }
    if (this._editing && !this.commitEdit(options)) return false;
    if (this.destroyed || this.getPropertyControl(row.propertyKey) !== row) return false;
    const factory = this._getPropertyEditor(row);
    if (!isGridEditorFactory(factory)) return false;
    const cell = this._rowElement(row)?.querySelector(".dui-property-grid__value");
    if (!cell) return false;
    const editor = factory.createCellEditor({
      source: this, grid: this, item: row, row, property: row.property,
      value: row.property.value, columnId: "value"
    });
    cell.textContent = "";
    cell.classList.add("dui-property-grid__value--editing");
    editor.mount(cell);
    this._editing = { row, cell, editor, oldValue: row.property.value };
    queueMicrotask(() => {
      if (!this.destroyed && this._editing?.editor === editor) editor.focus();
    });
    if (!options.silent) this.events.emit("editStart", {
      source: this, property: row.property, group: row.group,
      origin: options.origin ?? "api", userAction: options.userAction === true
    });
    return true;
  }

  commitEdit(options = {}) {
    if (!this._editing) return false;
    const editing = this._editing;
    const validation = editing.editor.validate?.() ?? { ok: true };
    if (this.destroyed || this._editing !== editing) return false;
    if (validation.ok === false) return false;
    const newValue = editing.editor.getValue();
    if (this.destroyed || this._editing !== editing) return false;
    const change = this._createPropertyChange(editing.row, editing.oldValue, newValue, options, true);
    if (!options.silent) this.events.emit("beforePropertyChange", change);
    if (change.cancel || this.destroyed || this._editing !== editing ||
        this.getPropertyControl(editing.row.propertyKey) !== editing.row) return false;
    this._commitPropertyValue(editing.row.property, newValue, change);
    if (this.destroyed || this._editing !== editing) return true;
    editing.row.value = newValue;
    this._finishEdit();
    if (!options.silent && !this.destroyed && !Object.is(editing.oldValue, newValue)) {
      delete change.cancel;
      this.events.emit("propertyChange", change);
      if (!this.destroyed) this.events.emit("afterPropertyChange", { ...change });
    }
    return true;
  }

  cancelEdit(options = {}) {
    if (!this._editing) return false;
    const row = this._editing.row;
    this._finishEdit();
    if (!options.silent) {
      this.events.emit("editCancel", {
        source: this, property: row.property,
        origin: options.origin ?? "api", userAction: options.userAction === true
      });
    }
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this._stopResize();
    this.cancelEdit({ silent: true });
    this._disposeInlineEditors();
    this.data.destroy();
    this.selection.destroy();
    super.destroy();
  }

  _visibleRows() {
    return flattenPropertyRows(this._groups, {
      showCategories: this.showCategories,
      sortMode: this.sortMode,
      collapsedCategories: this._collapsedCategories,
      expandedProperties: this._expandedProperties
    });
  }

  _indexPropertyRow(row) {
    const key = row.propertyKey;
    if (this.propertyControls[key]) throw new Error(`Duplicate property key: ${key}.`);
    this.propertyControls[key] = row;
    if (!this.propertyControls[row.property.name]) this.propertyControls[row.property.name] = row;
  }

  _replaceIndexedPropertyRow(row) {
    const key = row.propertyKey;
    this.propertyControls[key] = row;
    if (this.propertyControls[row.property.name]?.property === row.property) {
      this.propertyControls[row.property.name] = row;
    }
  }

  _renderRows() {
    if (!this._body) return;
    this.cancelEdit({ silent: true, origin: "system" });
    this._disposeInlineEditors();
    const fragment = document.createDocumentFragment();
    for (const row of this.data.all()) {
      fragment.append(row.kind === "category" ? this._createCategoryRow(row) : this._createPropertyRow(row));
    }
    this._body.replaceChildren(fragment);
    this._syncSelectionState();
  }

  _createCategoryRow(row) {
    const element = document.createElement("div");
    element.className = ["dui-property-grid__row", "dui-property-grid__category-row",
      row.collapsed ? "dui-property-grid__category-row--collapsed" : ""].filter(Boolean).join(" ");
    element.dataset.duiPropertyRowId = row.__duiPropertyId;
    element.dataset.duiCategoryId = row.categoryId;
    element.setAttribute("role", "row");
    element.setAttribute("aria-expanded", row.collapsed ? "false" : "true");
    const title = document.createElement("div");
    title.className = "dui-property-grid__category";
    title.textContent = row.title;
    title.setAttribute("role", "rowheader");
    element.append(title);
    return element;
  }

  _createPropertyRow(row) {
    const element = document.createElement("div");
    element.className = "dui-property-grid__row dui-property-grid__property-row";
    element.dataset.duiPropertyRowId = row.__duiPropertyId;
    element.dataset.duiPropertyName = row.propertyKey;
    element.style.setProperty("--dui-property-level", String(row.level));
    element.tabIndex = -1;
    element.setAttribute("role", "row");
    element.setAttribute("aria-selected", "false");
    element.setAttribute("aria-level", String(row.level + 1));
    if (row.expandable) element.setAttribute("aria-expanded", row.expanded ? "true" : "false");
    const gutter = document.createElement("div");
    gutter.className = "dui-property-grid__gutter";
    if (row.expandable) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "dui-property-grid__property-toggle";
      toggle.dataset.duiPropertyToggle = row.propertyKey;
      toggle.setAttribute("aria-label", `${row.expanded ? "Collapse" : "Expand"} ${row.label}`);
      toggle.setAttribute("aria-expanded", row.expanded ? "true" : "false");
      gutter.append(toggle);
    }
    const name = document.createElement("div");
    name.className = "dui-property-grid__name";
    name.textContent = row.label;
    name.setAttribute("role", "rowheader");
    const splitter = document.createElement("div");
    splitter.className = "dui-property-grid__splitter";
    splitter.dataset.duiPropertySplitter = "true";
    splitter.setAttribute("role", "separator");
    splitter.setAttribute("aria-orientation", "vertical");
    const value = document.createElement("div");
    value.className = "dui-property-grid__value";
    this._renderValueCell(value, row);
    value.setAttribute("role", "gridcell");
    element.append(gutter, name, splitter, value);
    return element;
  }

  _handleClick(event) {
    if (this.disabled) return;
    const propertyToggle = event.target.closest("[data-dui-property-toggle]");
    if (propertyToggle) {
      this.toggleProperty(propertyToggle.dataset.duiPropertyToggle, {
        origin: "user",
        userAction: true
      });
      return;
    }
    const rowElement = event.target.closest(".dui-property-grid__row");
    if (!rowElement) return;
    const row = this.data.get(rowElement.dataset.duiPropertyRowId);
    if (row?.kind === "category") {
      this.toggleCategory(row.categoryId, { origin: "user", userAction: true });
      return;
    }
    if (!isPropertyRow(row)) return;
    if (this._editing && this._editing.row !== row && !this.commitEdit({ origin: "user", userAction: true })) return;
    this.selection.set([row], { origin: "user", userAction: true });
    this._syncSelectionState();
    if (
      event.target.closest(".dui-property-grid__value") &&
      this._getPropertyEditor(row)?.activation === "toggle"
    ) this._toggleProperty(row);
  }

  _handleDoubleClick(event) {
    const row = this._rowFromTarget(event.target);
    if (row) this.startEdit(row, "value", { origin: "user", userAction: true });
  }

  _handleKeyDown(event) {
    const row = this._rowFromTarget(event.target);
    if (event.target.closest?.(".dui-grid__control-editor") && !this._editing) return;
    if (event.key === "Enter" && this._editing) { event.preventDefault(); this.commitEdit({ origin: "user", userAction: true }); }
    else if (event.key === "Escape" && this._editing) { event.preventDefault(); this.cancelEdit({ origin: "user", userAction: true }); }
    else if (event.key === "Enter" && row) { event.preventDefault(); this.startEdit(row, "value", { origin: "user", userAction: true }); }
  }

  _handlePointerDown(event) {
    if (!event.target.closest("[data-dui-property-splitter]")) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.labelWidth;
    const move = moveEvent => {
      const max = Math.max(this.minLabelWidth, this.element.clientWidth - this.minValueWidth);
      this.setLabelWidth(Math.min(max, startWidth + moveEvent.clientX - startX), {
        silent: true, origin: "user", userAction: true
      });
    };
    const up = () => {
      this._stopResize();
      this.events.emit("labelWidthChange", {
        source: this, value: this.labelWidth,
        origin: "user", userAction: true
      });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
    this._resizeCleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
  }

  _stopResize() { this._resizeCleanup?.(); this._resizeCleanup = null; }
  _rowFromTarget(target) {
    const element = target.closest?.(".dui-property-grid__property-row");
    return element ? this.data.get(element.dataset.duiPropertyRowId) : null;
  }
  _rowElement(row) {
    return this._body?.querySelector(`[data-dui-property-row-id="${CSS.escape(row.__duiPropertyId)}"]`) ?? null;
  }
  _syncSelectionState() {
    if (!this._body) return;
    const selected = this.selection.get()[0] ?? null;
    for (const element of this._body.querySelectorAll(".dui-property-grid__property-row")) {
      const row = this.data.get(element.dataset.duiPropertyRowId);
      const active = row === selected;
      element.classList.toggle("dui-selected", active);
      element.setAttribute("aria-selected", active ? "true" : "false");
      element.tabIndex = active ? 0 : -1;
    }
  }

  _handleSelectionChange(event) {
    const row = event.items.find(isPropertyRow) ?? null;
    const oldRow = this._selectedPropertyRow;
    if (oldRow === row) return;
    this._selectedPropertyRow = row;
    this.events.emit("propertyFocusChange", {
      source: this, target: this._source,
      property: row?.property ?? null, group: row?.group ?? null,
      oldProperty: oldRow?.property ?? null,
      description: row?.property?.description ?? row?.property?.help ?? "",
      origin: event.origin, userAction: event.userAction === true
    });
  }

  _setCategoryCollapsed(categoryId, collapsed, options = {}) {
    this._assertMutable("toggleCategory");
    const group = this._groups.find(current => current.id === categoryId || current.name === categoryId);
    if (!group || this.isCategoryCollapsed(group.id) === collapsed) return false;
    const event = {
      source: this, target: this._source, categoryId: group.id, group, collapsed,
      origin: options.origin ?? "api", userAction: options.userAction === true, cancel: false
    };
    if (!options.silent) this.events.emit("beforeCategoryToggle", event);
    if (event.cancel || this.destroyed || !this._groups.includes(group) ||
        this.isCategoryCollapsed(group.id) === collapsed) return false;
    collapsed ? this._collapsedCategories.add(group.id) : this._collapsedCategories.delete(group.id);
    const rows = this._visibleRows();
    this.data.parse(rows, { silent: true, origin: options.origin ?? "api" });
    if (this.destroyed) return true;
    for (const row of rows.filter(isPropertyRow)) this._replaceIndexedPropertyRow(row);
    this._renderRows();
    if (!options.silent && !this.destroyed) {
      this.events.emit("categoryToggle", event);
      if (!this.destroyed) this.events.emit(collapsed ? "categoryCollapse" : "categoryExpand", event);
    }
    return true;
  }

  _setPropertyExpanded(pathOrName, expanded, options = {}) {
    this._assertMutable("toggleProperty");
    const row = this.getPropertyControl(pathOrName);
    if (!row || !row.expandable || this._expandedProperties.has(row.propertyKey) === expanded) return false;
    const event = {
      source: this, target: this._source, property: row.property, group: row.group,
      path: row.propertyKey, expanded,
      origin: options.origin ?? "api", userAction: options.userAction === true, cancel: false
    };
    if (!options.silent) this.events.emit("beforePropertyToggle", event);
    if (event.cancel || this.destroyed || this.getPropertyControl(pathOrName) !== row ||
        this._expandedProperties.has(row.propertyKey) === expanded) return false;
    expanded ? this._expandedProperties.add(row.propertyKey) : this._expandedProperties.delete(row.propertyKey);
    const rows = this._visibleRows();
    this.data.parse(rows, { silent: true, origin: options.origin ?? "api" });
    if (this.destroyed) return true;
    for (const visibleRow of rows.filter(isPropertyRow)) this._replaceIndexedPropertyRow(visibleRow);
    this._renderRows();
    if (!options.silent && !this.destroyed) {
      this.events.emit("propertyToggle", event);
      if (!this.destroyed) this.events.emit(expanded ? "propertyExpand" : "propertyCollapse", event);
    }
    return true;
  }

  _toggleProperty(row) {
    const oldValue = row.property.value;
    const newValue = !oldValue;
    const change = this._createPropertyChange(row, oldValue, newValue, { origin: "user", userAction: true }, true);
    this.events.emit("beforePropertyChange", change);
    if (change.cancel || this.destroyed || this.getPropertyControl(row.propertyKey) !== row) return false;
    this._commitPropertyValue(row.property, newValue, change);
    if (this.destroyed || this.getPropertyControl(row.propertyKey) !== row) return true;
    row.value = newValue;
    this._renderRows();
    delete change.cancel;
    this.events.emit("propertyChange", change);
    if (!this.destroyed) this.events.emit("afterPropertyChange", { ...change });
    return true;
  }

  _createPropertyChange(row, oldValue, newValue, options, cancellable = false) {
    return {
      source: this, target: this._source, property: row.property, group: row.group,
      name: row.property.name, oldValue, newValue,
      origin: options.origin ?? "api", userAction: options.userAction === true,
      ...(options.silent ? { silent: true } : {}),
      ...(cancellable ? { cancel: false } : {})
    };
  }

  _finishEdit() {
    const editing = this._editing;
    if (!editing) return;
    this._editing = null;
    editing.editor.destroy();
    editing.cell.classList.remove("dui-property-grid__value--editing");
    this._renderValueCell(editing.cell, editing.row);
  }

  _renderValueCell(cell, row) {
    cell.replaceChildren();
    if (row.property.type === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "dui-property-grid__checkbox";
      input.checked = Boolean(row.property.value);
      input.tabIndex = -1;
      input.setAttribute("aria-label", row.label);
      cell.append(input);
      return;
    }
    if (row.property.type === "switch") {
      const indicator = Switch.createIndicator(Boolean(row.property.value));
      indicator.classList.add("dui-property-grid__switch");
      indicator.removeAttribute("role");
      indicator.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = row.property.value
        ? row.property.onText ?? "On"
        : row.property.offText ?? "Off";
      cell.append(indicator, text);
      return;
    }
    if (isInlinePropertyEditor(row.property.type)) {
      const factory = this._getPropertyEditor(row);
      if (isGridEditorFactory(factory)) {
        const editor = factory.createCellEditor({
          source: this,
          grid: this,
          item: row,
          row,
          property: row.property,
          value: row.property.value,
          columnId: "value"
        });
        editor.mount(cell);
        const subscription = editor.control?.events?.on("change", event => {
          this._handleInlineEditorChange(row, editor, event);
        }) ?? null;
        this._inlineEditors.push({ row, editor, subscription });
        cell.classList.add("dui-property-grid__value--inline-editor");
        return;
      }
    }
    cell.textContent = renderPropertyValue(row.property.value, row);
  }

  _handleInlineEditorChange(row, editor, event) {
    const oldValue = row.property.value;
    const newValue = editor.getValue();
    if (Object.is(oldValue, newValue)) return;
    const validation = editor.validate?.() ?? { ok: true };
    if (this.destroyed || this.getPropertyControl(row.propertyKey) !== row || editor.destroyed === true || validation.ok === false) return;
    const change = this._createPropertyChange(row, oldValue, newValue, {
      origin: event.origin ?? "user",
      userAction: event.userAction === true
    }, true);
    this.events.emit("beforePropertyChange", change);
    if (this.destroyed || this.getPropertyControl(row.propertyKey) !== row) return;
    if (change.cancel) {
      editor.control?.value?.set(oldValue, { silent: true, origin: "system" });
      return;
    }
    this._commitPropertyValue(row.property, newValue, change);
    if (this.destroyed || this.getPropertyControl(row.propertyKey) !== row) return;
    row.value = newValue;
    delete change.cancel;
    this.events.emit("propertyChange", change);
    if (!this.destroyed) this.events.emit("afterPropertyChange", { ...change });
  }

  _disposeInlineEditors() {
    for (const entry of this._inlineEditors) {
      entry.subscription?.dispose?.();
      entry.editor.destroy();
    }
    this._inlineEditors = [];
  }

  _commitPropertyValue(property, value, event) {
    property.value = value;
    if (typeof property.set === "function") property.set(value, event);
    else if (this._source && typeof this._source.setProperty === "function") {
      this._source.setProperty(property.name, value, event);
    }
  }

  _getPropertyEditor(row) {
    if (!isPropertyEditable(row)) return null;
    const property = row.property;
    if (property.editor != null) {
      return normalizePropertyEditor(typeof property.editor === "function"
        ? property.editor(property, row, this) : property.editor);
    }
    const editor = this.defaultEditors.get(property.type);
    return normalizePropertyEditor(typeof editor === "function" ? editor(property, row, this) : editor);
  }
}

function normalizePropertyModel(source) {
  const rawModel = Array.isArray(source) ? source : source.getProperties?.() ?? source;
  const groups = Array.isArray(rawModel) ? rawModel : rawModel?.groups;
  if (!Array.isArray(groups)) throw new TypeError("PropertyGrid source must be an array, PropertyModel, or expose getProperties().");
  return { source: rawModel?.source ?? source, groups: groups.map((group, index) => ({
    title: group.title ?? "", name: group.name ?? group.id ?? group.title ?? `group${index}`,
    id: group.id ?? group.name ?? group.title ?? `group${index}`,
    properties: Array.isArray(group.properties) ? group.properties : []
  })) };
}

function flattenPropertyRows(groups, options = {}) {
  const rows = [];
  const showCategories = options.showCategories !== false;
  const collapsed = options.collapsedCategories ?? new Set();
  const expandedProperties = options.expandedProperties ?? new Set();
  const includeCollapsedProperties = options.includeCollapsedProperties === true;
  sortPropertyGroups(groups, normalizePropertySortMode(options.sortMode)).forEach(group => {
    if (showCategories) rows.push({
      __duiPropertyId: `group:${group.id}`, kind: "category", group,
      categoryId: group.id, collapsed: collapsed.has(group.id), title: group.title ?? group.name ?? ""
    });
    if (showCategories && collapsed.has(group.id)) return;
    appendPropertyRows(rows, group.properties, group, {
      expandedProperties,
      includeCollapsedProperties
    });
  });
  return rows;
}

function appendPropertyRows(rows, properties, group, options, parentKey = "", level = 0) {
  properties.forEach((property, index) => {
    assertPropertyDef(property);
    const propertyKey = property.path ?? [parentKey, property.name].filter(Boolean).join(".");
    const children = Array.isArray(property.children) ? property.children : [];
    const expandable = children.length > 0;
    const expanded = expandable && options.expandedProperties.has(propertyKey);
    rows.push({
      __duiPropertyId: `property:${group.name}:${propertyKey}:${index}`,
      kind: "property", group, categoryId: group.id, property, propertyKey,
      name: property.name, label: property.label ?? property.name, value: property.value,
      level, expandable, expanded
    });
    if (expandable && (expanded || options.includeCollapsedProperties)) {
      appendPropertyRows(rows, children, group, options, propertyKey, level + 1);
    }
  });
}

function sortPropertyGroups(groups, mode) {
  if (mode === "none") return groups.map(group => ({ ...group, properties: [...group.properties] }));
  if (mode === "alphabetical") return [{
    id: "properties", name: "properties", title: "Properties",
    properties: groups.flatMap(group => group.properties).sort(comparePropertyLabels)
  }];
  return groups.map(group => ({ ...group, properties: [...group.properties].sort(comparePropertyLabels) }));
}
function comparePropertyLabels(a, b) {
  return String(a.label ?? a.name).localeCompare(String(b.label ?? b.name), undefined, { numeric: true, sensitivity: "base" });
}
function normalizePropertySortMode(mode) {
  if (mode == null || mode === "categorized") return "categorized";
  if (mode === "alphabetical" || mode === "none") return mode;
  throw new TypeError("PropertyGrid sortMode must be 'categorized', 'alphabetical', or 'none'.");
}
function createDefaultEditors(overrides) {
  const editors = new Map([
    ["text", gridEditors.text()],
    ["number", property => gridEditors.number({ min: property.min, max: property.max, step: property.step })],
    ["integer", property => gridEditors.number({ min: property.min, max: property.max, step: property.step ?? 1 })],
    ["boolean", gridEditors.checkbox()],
    ["switch", property => gridEditors.switch({ onText: property.onText ?? "On", offText: property.offText ?? "Off" })],
    ["select", property => gridEditors.select({ options: property.options ?? [] })],
    ["radio", property => gridEditors.radio({ options: property.options ?? [], layout: property.layout ?? "column" })],
    ["date", property => gridEditors.date({ min: property.min, max: property.max })],
    ["time", property => gridEditors.time({ min: property.min, max: property.max, step: property.step })],
    ["dateTime", property => gridEditors.dateTime({ min: property.min, max: property.max, step: property.step })],
    ["readonly", null]
  ]);
  if (overrides) for (const [type, editor] of overrides instanceof Map ? overrides : Object.entries(overrides)) {
    assertPropertyTypeName(type); editors.set(type, normalizePropertyEditor(editor));
  }
  return editors;
}
function normalizePropertyEditor(editor) {
  if (editor == null || typeof editor === "function" || isGridEditorFactory(editor)) return editor;
  throw new TypeError("PropertyGrid editor must be a Grid editor factory, function, or null.");
}
function assertPropertyTypeName(type) {
  if (!type || typeof type !== "string") throw new TypeError("Property editor type must be a non-empty string.");
}
function assertPropertyDef(property) {
  if (!property || typeof property !== "object") throw new TypeError("Property definition must be an object.");
  if (!property.name) throw new TypeError("Property definition requires name.");
  if (!property.type) throw new TypeError(`Property ${property.name} requires type.`);
}
function isPropertyRow(row) { return row?.kind === "property"; }
function isPropertyEditable(row) {
  return isPropertyRow(row) && row.property.readOnly !== true && row.property.type !== "readonly";
}
function isInlinePropertyEditor(type) {
  return ["text", "number", "integer", "select", "date", "time", "dateTime"].includes(type);
}
function renderPropertyValue(value, row) {
  const property = row.property;
  if (property.type === "boolean" || property.type === "switch") return value ? "On" : "Off";
  if (property.type === "select" || property.type === "radio") return getOptionText(property.options ?? [], value);
  return value == null ? "" : String(value);
}
function getOptionText(options, value) {
  const option = options.find(item => Object.is(item && typeof item === "object" ? item.id ?? item.value : item, value));
  if (option && typeof option === "object") return option.text ?? option.label ?? String(option.id ?? option.value ?? "");
  return option == null ? String(value ?? "") : String(option);
}
function normalizeLabelWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) throw new TypeError("PropertyGrid labelWidth must be a positive number.");
  return width;
}
