import { BaseControl } from "../core/BaseControl.js";
import { GridColumnModel } from "../core/GridColumnModel.js";
import {
  normalizeGridOverscan,
  normalizeGridColumnWidth
} from "./GridPrimitives.js";
import { ContextMenu } from "./Menu.js";
import { GridColumnReorderController } from "./GridColumnReorderController.js";
import { GridColumnResizer } from "./GridColumnResizer.js";
import { GridKeyboardController } from "./GridKeyboardController.js";
import { GridSelectionController } from "./GridSelectionController.js";
import { GridVirtualRenderer } from "./GridVirtualRenderer.js";
import { gridIntrinsicWidth } from "./gridIntrinsicWidth.js";

export class GridCore extends BaseControl {
  constructor(options = {}, coreOptions = {}) {
    super({ ...options, tabIndex:options.tabIndex ?? 0, observeResize:true });
    this.css = options.css ?? "";
    this.className = options.className ?? "";
    this.columns = coreOptions.columns ?? options.columns ?? [];
    this.columnModel = new GridColumnModel(this.columns);
    this.rowHeight = options.rowHeight ?? null;
    this.virtualRows = options.virtualRows !== false;
    this.virtualOverscan = normalizeGridOverscan(options.virtualOverscan);
    this._activeId = null;
    this._activeColumnId = this.columns.find(column => column.hidden !== true)?.id ?? null;
    this._header = null;
    this._body = null;
    this._rowKeysById = new Map();
    this._idsByRowKey = new Map();
    this.indicatorGutterEnabled = options.indicatorGutter !== false;
    this._indicatorHeader = null;
    this.columnMenuEnabled = options.columnMenu !== false;
    this.columnReorderEnabled = options.columnReorder !== false;
    this._columnReorderController = new GridColumnReorderController(this);
    this._columnResizer = new GridColumnResizer(this);
    this._keyboardController = new GridKeyboardController(this);
    this._selectionController = new GridSelectionController(this);
    this._virtualRenderer = new GridVirtualRenderer(this);
    this._columnMenu = this.columnMenuEnabled
      ? new ContextMenu({ name:`${this.name ?? this.id}-columns`, items:[] })
      : null;
    this.gridMenuEnabled = this.indicatorGutterEnabled && (options.gridMenu ?? this.columnMenuEnabled);
    this._gridMenu = this.gridMenuEnabled
      ? new ContextMenu({ name:`${this.name ?? this.id}-settings`, items:[] }) : null;
    this._gridMenuButton = null;
    this._gridMenuOpen = false;
    this._initialColumnLayout = this.columnModel.getState().map(entry => ({
      ...entry, width:entry.width ?? normalizeGridColumnWidth(null)
    }));
    if (this._gridMenu) {
      this.disposables.add(this._gridMenu.events.on("open", () => {
        if (this.destroyed || this._destroyingGrid) return;
        this._gridMenuOpen = true;
        this._syncGridMenuButton();
      }));
      this.disposables.add(this._gridMenu.events.on("close", () => {
        this._gridMenuOpen = false;
        this._syncGridMenuButton();
        this._restoreTableMenuFocus(true);
      }));
    }
    if (this._columnMenu) this.disposables.add(this._columnMenu.events.on("close", () => this._restoreTableMenuFocus(false)));

    this.disposables.add(this.columnModel.events.on("invalidate", event => {
      const revision = this._columnStateRevision = (this._columnStateRevision ?? 0) + 1;
      this.columns = this.columnModel.all();
      const current = () => !this.destroyed && !this._destroyingGrid && this._columnStateRevision === revision;
      this._reconcileColumnState();
      if (!current()) return;
      if (this._editing && (!this.getColumn(this._editing.column.id) || this.getColumn(this._editing.column.id).hidden === true)) {
        this._windowRenderer?.invalidateColumns();
        this._discardActiveEdit?.({silent:event.silent, origin:event.origin, userAction:event.userAction, reason:"column-hidden"});
        if (!current()) return;
      }
      if (this._deferColumnRender) return;
      this._renderHeader?.();
      if (!current()) return;
      const editing = this._editing;
      if (editing && this._windowRenderer && this._body) {
        // A reordered track can move behind a pinned band. Keep the retained
        // editor in the usable viewport, as for a table resize, without making
        // this programmatic scroll look like a user cancellation.
        this._windowRenderer.scrollToColumn(editing.column.id);
        if (!current()) return;
        if (this._editing === editing) {
          editing.scrollLeft = this._body.scrollLeft;
          editing.scrollTop = this._body.scrollTop;
        }
      }
      this._renderRows?.();
    }));
    this.disposables.add(this.columnModel.events.on("change", event => {
      this.events.emit("layoutChange", {
        source:this,
        operation:event.operation,
        layoutState:this.getLayoutState?.() ?? this.getCoreLayoutState(),
        origin:event.origin,
        userAction:event.userAction
      });
    }));
  }

  _emitDoubleClick(event, item, column, value) {
    const base = {source:this, item, id:this.data.idOf(item), nativeEvent:event, origin:"user", userAction:true};
    const rowEvent = {...base, cancel:false};
    this.events.emit("rowDoubleClick", rowEvent);
    if (this.destroyed || this.disabled) return false;
    const cellEvent = {...base, column, columnId:column.id, value, cancel:false};
    this.events.emit("cellDoubleClick", cellEvent);
    return !this.destroyed && !this.disabled && !rowEvent.cancel && !cellEvent.cancel && !event.defaultPrevented;
  }

  // Compound table operations render after all related state has been applied.
  // The model still notifies external technical subscribers during the update.
  _withDeferredColumnRender(update) {
    const previous = this._deferColumnRender;
    this._deferColumnRender = true;
    try { return update(); }
    finally { this._deferColumnRender = previous; }
  }

  getColumn(id) { return this.columnModel.get(id); }
  getCoreLayoutState() { return { version:1, columns:this.columnModel.getState() }; }
  moveColumn(id, index, options = {}) { return this.columnModel.move(id, index, options); }
  hideColumn(id, options = {}) { return this.columnModel.setHidden(id, true, options); }
  showColumn(id, options = {}) { return this.columnModel.setHidden(id, false, options); }
  freezeColumn(id, side = "left", options = {}) { return this.columnModel.setFrozen(id, side, options); }
  unfreezeColumn(id, options = {}) { return this.columnModel.setFrozen(id, null, options); }
  _visibleColumns() { return this.columnModel.visible(); }

  _mountColumnMenu() {
    if (typeof document === "undefined") return;
    for (const menu of [this._columnMenu, this._gridMenu]) {
      if (menu && !menu.element) menu.mount(document.body);
    }
  }

  _syncGridMenuButton() {
    const button = this._gridMenuButton;
    if (!button) return;
    button.disabled = this.disabled;
    button.setAttribute("aria-expanded", String(this._gridMenuOpen));
  }

  _createGridMenuButton() {
    if (!this._gridMenu) return null;
    if (this._gridMenuButton) { this._syncGridMenuButton(); return this._gridMenuButton; }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dui-grid__grid-menu-button";
    button.textContent = "\u22ee";
    button.title = "\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0442\u0430\u0431\u043b\u0438\u0446\u044b";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const open = event => {
      event.preventDefault(); event.stopPropagation();
      const rect = button.getBoundingClientRect();
      this._openGridMenu(rect.left, rect.bottom + 2);
    };
    button.addEventListener("click", open);
    button.addEventListener("keydown", event => {
      if (!event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && ["Enter", " ", "ArrowDown"].includes(event.key)) open(event);
    });
    this._gridMenuButton = button;
    this._syncGridMenuButton();
    return button;
  }

  _closeGridMenu() {
    if (this._gridMenu && !this._gridMenu.destroyed) this._gridMenu.close({silent:true, origin:"system"});
    this._gridMenuOpen = false;
    this._syncGridMenuButton();
  }

  _restoreTableMenuFocus(global) {
    if (this.destroyed || this._destroyingGrid || this.disabled || !this.element?.isConnected) return;
    const doc = this.element.ownerDocument;
    const active = doc.activeElement;
    // An action may intentionally move focus, for example to the search input.
    if (active?.isConnected && active !== doc.body && active !== doc.documentElement) return;
    const columnButton = global ? null : this._header?.querySelector(
      `[data-dui-grid-column-id="${escapeCss(this._columnMenuColumnId)}"] .dui-grid__column-menu-button`);
    const target = columnButton ?? this._gridMenuButton ?? this.element;
    if (target?.isConnected && !target.disabled) target.focus({preventScroll:true});
  }

  _openGridMenu(x, y) {
    const menu = this._gridMenu;
    if (!menu || this.destroyed || this._destroyingGrid || this.disabled || !this._gridMenuButton?.isConnected) return false;
    const revision = this._columnStateRevision ?? 0;
    const current = () => !this.destroyed && !this._destroyingGrid && !this.disabled &&
      this._gridMenu === menu && !menu.destroyed && this._gridMenuButton?.isConnected &&
      (this._columnStateRevision ?? 0) === revision;
    this._columnMenu?.close({silent:true, origin:"system"});
    if (!current()) return false;
    this._closeGridMenu();
    const items = this._getGridMenuItems();
    if (!current()) return false;
    menu.setItems(items);
    if (!current()) return false;
    const beforeOpen = menu.events.on("beforeOpen", event => { if (!current()) event.cancel = true; });
    try {
      const opened = menu.openAt(x, y, {origin:"user", userAction:true});
      if (!current()) {
        this._closeGridMenu();
        return false;
      }
      this._gridMenuOpen = opened;
      this._syncGridMenuButton();
      return opened;
    } finally { beforeOpen.dispose(); }
  }

  _runGridMenuAction(action) {
    if (this.destroyed || this._destroyingGrid || this.disabled) return false;
    return action();
  }

  _getGridMenuItems() {
    const user = {origin:"user", userAction:true};
    const run = action => () => this._runGridMenuAction(action);
    const view = this.view ?? this.treeView;
    const items = [
      {id:"columns", text:"Columns", items:this._getColumnVisibilityMenuItems()},
      {id:"best-fit-all", text:"Best fit all columns", enabled:this._visibleColumns().length > 0, onClick:run(() => this.autoSizeColumns(user))},
      {id:"reset-column-layout", text:"Reset column layout", onClick:run(() => this.columnModel.restoreState(this._initialColumnLayout, user))}
    ];
    if (typeof this.clearAllFilters === "function") items.push("-", {
      id:"clear-all-filters", text:"Clear all filters", onClick:run(() => this.clearAllFilters({...user, search:true}))
    });
    if (typeof this.clearSort === "function") items.push({
      id:"clear-sort", text:"Clear sorting", enabled:view?.getSort?.() != null, onClick:run(() => this.clearSort(user))
    });
    if (typeof this.showSearchPanel === "function") items.push("-", {
      id:"search-panel", text:"Search panel", checked:this.searchPanelVisible,
      onClick:run(() => this.searchPanelVisible ? this.hideSearchPanel({...user, clear:false}) : this.showSearchPanel(user))
    });
    if (typeof this.setStatusBar === "function") items.push({
      id:"status-bar", text:"Status bar", checked:this.statusBarOptions.visible,
      onClick:run(() => this.setStatusBar({...this.statusBarOptions, visible:!this.statusBarOptions.visible}))
    });
    if (typeof this.expandAll === "function") items.push("-", {
      id:"expand-all", text:"Expand all", onClick:run(() => this.expandAll(user))
    }, {id:"collapse-all", text:"Collapse all", onClick:run(() => this.collapseAll(user))});
    return items;
  }

  _clearColumnSort(columnId, options) {
    if (this.destroyed || this._destroyingGrid || this.disabled) return false;
    const rules = this.getSortModel();
    if (this.destroyed || !rules.some(rule => rule.columnId === columnId)) return false;
    return typeof this.setSortModel === "function"
      ? this.setSortModel(rules.filter(rule => rule.columnId !== columnId), options)
      : this.clearSort(options);
  }

  _isColumnMenuCurrent(column) {
    return !this.destroyed && !this._destroyingGrid && !this.disabled && this.getColumn(column.id) === column;
  }

  _guardColumnMenuItems(column, items) {
    return items.map(item => {
      if (item === "-") return item;
      const onClick = item.onClick;
      return {...item,
        ...(item.items ? {items:this._guardColumnMenuItems(column, item.items)} : {}),
        ...(onClick ? {onClick:event => this._isColumnMenuCurrent(column) ? onClick(event) : false} : {})};
    });
  }

  _showColumnMenu(column, x, y, createItems) {
    if (!this._columnMenu || !this._isColumnMenuCurrent(column)) return false;
    this._closeGridMenu();
    this._columnMenuColumnId = column.id;
    let changed = false;
    const subscriptions = [this.data, this.view ?? this.treeView, this.columnModel].filter(Boolean)
      .map(model => model.events.on("invalidate", () => { changed = true; }));
    let beforeOpen;
    try {
      const items = createItems();
      if (changed || !this._isColumnMenuCurrent(column)) return false;
      this._columnMenu.setItems(this._guardColumnMenuItems(column, items));
      if (changed || !this._isColumnMenuCurrent(column)) return false;
      beforeOpen = this._columnMenu.events.on("beforeOpen", event => {
        if (changed || !this._isColumnMenuCurrent(column)) event.cancel = true;
      });
      const opened = this._columnMenu.openAt(x, y, {origin:"user", userAction:true});
      if (changed || !this._isColumnMenuCurrent(column)) {
        if (!this._columnMenu?.destroyed) this._columnMenu?.close({silent:true, origin:"system"});
        return false;
      }
      return opened;
    } finally { beforeOpen?.dispose(); subscriptions.forEach(subscription => subscription.dispose()); }
  }

  _applyDisabledState() {
    super._applyDisabledState();
    this._syncGridMenuButton();
    if (this.disabled) {
      // A disabled table must not leave a live, keyboard-inaccessible editor or
      // portaled picker behind. This is technical cancellation, not a user edit.
      this.cancelEdit?.({ silent: true, origin: "system", userAction: false, reason: "disabled" });
      if (this.destroyed || !this.disabled) return;
      this._closeGridMenu();
      if (this._columnMenu && !this._columnMenu.destroyed) this._columnMenu.close({silent:true, origin:"system"});
    }
  }

  _createColumnMenuButton(column, options = {}) {
    if (!this._columnMenu) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dui-grid__column-menu-button";
    button.title = "Column menu";
    button.classList.toggle("dui-grid__column-menu-button--filtered", options.filtered === true);
    button.setAttribute("aria-label", `Column menu for ${column.title ?? column.label ?? column.id}`);
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-pressed", options.filtered === true ? "true" : "false");
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const rect = button.getBoundingClientRect();
      this._openColumnMenu(column, rect.right, rect.bottom + 2);
    });
    return button;
  }

  _openColumnMenu(column, x, y) {
    return this._showColumnMenu(column, x, y, () => this._getColumnMenuItems(column));
  }

  _getColumnMenuItems(column) {
    return this._getColumnLayoutMenuItems(column);
  }

  _getColumnLayoutMenuItems(column) {
    const visible = this._visibleColumns();
    const user = { origin:"user", userAction:true };
    return [
      { id:"best-fit", text:"Best fit", onClick:() => this.autoSizeColumn(column.id, user) },
      "-",
      { id:"freeze-left", text:"Freeze left", checked:column.frozen === "left", onClick:() => this.freezeColumn(column.id, "left", user) },
      { id:"freeze-right", text:"Freeze right", checked:column.frozen === "right", onClick:() => this.freezeColumn(column.id, "right", user) },
      { id:"unfreeze", text:"Unfreeze", enabled:column.frozen != null, onClick:() => this.unfreezeColumn(column.id, user) },
      "-",
      { id:"hide-column", text:"Hide column", enabled:visible.length > 1, onClick:() => this.hideColumn(column.id, user) }
    ];
  }

  _getColumnVisibilityMenuItems() {
    return this.columns.map(column => ({
      id: `column-${column.id}`,
      text: column.title ?? column.label ?? column.id,
      checked: column.hidden !== true,
      enabled: column.hidden === true || this._visibleColumns().length > 1,
      closeOnClick: false,
      onClick: ({ source }) => {
        if (this.destroyed || this._destroyingGrid || this.disabled) return;
        const current = this.getColumn(column.id);
        if (!current) return;
        const user = { origin: "user", userAction: true };
        if (current.hidden === true) this.showColumn(current.id, user);
        else if (this._visibleColumns().length > 1) this.hideColumn(current.id, user);
        if (this.destroyed || source.destroyed) return;
        const entries = source.items.find(item => item.id === "columns")?.items ?? [];
        const visible = this._visibleColumns().length;
        for (const entry of entries) {
          const target = this.columns.find(item => `column-${item.id}` === entry.id);
          entry.checked = target != null && target.hidden !== true;
          entry.disabled = !target || (target.hidden !== true && visible <= 1);
          entry.enabled = !entry.disabled;
        }
      }
    }));
  }

  autoSizeColumn(id, options = {}) {
    const column = this.getColumn(id);
    if (!column) throw new Error(`Unknown Grid column: ${String(id)}.`);
    const selector = `[data-dui-grid-column-id="${escapeCss(id)}"]`;
    const elements = [this._header?.querySelector(selector), ...this._body?.querySelectorAll(selector) ?? [], this._footer?.querySelector(selector)].filter(Boolean);
    const width = Math.max(Number(column.minWidth) || 48, ...elements.map(gridIntrinsicWidth));
    return this.columnModel.setWidth(id, Math.min(Number(column.maxWidth) || Infinity, width), options);
  }

  autoSizeColumns(options = {}) {
    this._assertMutable("autoSizeColumns");
    let changed = false;
    for (const column of this._visibleColumns()) {
      if (this.destroyed || this._destroyingGrid || this.getColumn(column.id) !== column || column.hidden === true) break;
      const revision = this._columnStateRevision ?? 0;
      const resized = this.autoSizeColumn(column.id, options);
      changed = resized || changed;
      if (this.destroyed || this._destroyingGrid || (this._columnStateRevision ?? 0) !== revision + (resized ? 1 : 0)) break;
    }
    return changed;
  }

  _attachColumnDragHandlers(cell, column) {
    this._columnReorderController.attach(cell, column);
  }

  _reconcileColumnState() {
    if (this.getColumn(this._activeColumnId)?.hidden === true || !this.getColumn(this._activeColumnId)) {
      this._activeColumnId = this._visibleColumns()[0]?.id ?? null;
    }
  }

  _getGridTemplateColumns() {
    const columns = this._visibleColumns();
    const data = columns.length
      ? columns.map(column => normalizeGridColumnWidth(column.width)).join(" ")
      : "minmax(0, 1fr)";
    return this.indicatorGutterEnabled ? `var(--dui-grid-indicator-width, 10px) ${data}` : data;
  }

  _getIndicatorWidth() {
    if (!this.indicatorGutterEnabled) return 0;
    const width = this._indicatorHeader?.getBoundingClientRect().width;
    if (width > 0) return width;
    const token = this.element && typeof getComputedStyle === "function"
      ? Number.parseFloat(getComputedStyle(this.element).getPropertyValue("--dui-grid-indicator-width")) : NaN;
    return Number.isFinite(token) && token > 0 ? token : 10;
  }

  _createIndicatorCell(kind = "row") {
    if (!this.indicatorGutterEnabled) return null;
    const cell = document.createElement("div");
    cell.className = `dui-grid__indicator dui-grid__indicator-${kind === "row" ? "body" : kind}`;
    cell.dataset.duiGridIndicator = kind;
    cell.setAttribute("role", "presentation");
    if (kind !== "header") cell.setAttribute("aria-hidden", "true");
    return cell;
  }

  _appendIndicatorHeader(header) {
    if (!this.indicatorGutterEnabled) return;
    const cell = this._indicatorHeader ??= this._createIndicatorCell("header");
    const button = this._createGridMenuButton?.();
    if (button ? cell.firstChild !== button || cell.childNodes.length !== 1 : cell.childNodes.length) {
      cell.replaceChildren(...(button ? [button] : []));
    }
    if (cell.parentNode !== header) header.prepend(cell);
  }

  _clearHeaderData() {
    // Keep the global-menu trigger connected while rebuilding data headers.
    // Native focus/returnFocus must not point at a detached replacement node.
    for (const child of [...this._header.childNodes]) {
      if (child !== this._indicatorHeader) child.remove();
    }
  }

  _applyColumnTemplate() {
    const template = this._getGridTemplateColumns();
    if (this._header) this._header.style.gridTemplateColumns = template;
    if (this._footer) this._footer.style.gridTemplateColumns = template;
    this._body?.querySelectorAll(".dui-grid__row").forEach(row => {
      row.style.gridTemplateColumns = template;
    });
  }

  _syncScrollbarGutter() {
    if (!this.element || !this._body) return;
    const gutter = Math.max(0, this._body.offsetWidth - this._body.clientWidth);
    this.element.style.setProperty("--dui-grid-scrollbar-gutter", `${gutter}px`);
  }

  _afterResize() {
    this._renderRows?.();
    this._syncScrollbarGutter();
  }

  _getRenderRange(rowCount, virtualRows = this.virtualRows) {
    return this._virtualRenderer.getRange(rowCount, virtualRows);
  }

  _getVirtualRowHeight() { return this._virtualRenderer.getRowHeight(); }

  _createRowSpacer(height, position) {
    return this._virtualRenderer.createSpacer(height, position);
  }

  _applyFrozenColumnCell(cell, column, columns, columnIndex) {
    if (column.frozen !== "left" && column.frozen !== "right") return;
    cell.classList.add("dui-grid__cell--frozen", `dui-grid__cell--frozen-${column.frozen}`);
    const candidates = column.frozen === "left"
      ? columns.slice(0, columnIndex).filter(item => item.frozen === "left")
      : columns.slice(columnIndex + 1).filter(item => item.frozen === "right");
    const offset = candidates.reduce((sum, item) => sum + this._getColumnPixelWidth(item), 0);
    cell.style[column.frozen] = column.frozen === "left" && this.indicatorGutterEnabled
      ? `calc(var(--dui-grid-indicator-width, 10px) + ${offset}px)` : `${offset}px`;
  }

  _getColumnPixelWidth(column) {
    const rendered = this._header?.querySelector(`[data-dui-grid-column-id="${escapeCss(column.id)}"]`)
      ?.getBoundingClientRect().width;
    if (rendered > 0) return rendered;
    const parsed = Number.parseFloat(column.width);
    return Number.isFinite(parsed) ? parsed : Number(column.minWidth) || 48;
  }

  _idOf(item) {
    return this.view?.idOf?.(item) ?? this.treeView?.idOf?.(item) ?? this.data.idOf(item);
  }

  _itemById(id) {
    return this.view?.get?.(id) ?? this.treeView?.get?.(id) ?? this.data.get(id);
  }

  _activeItems() {
    if (typeof this._visibleItems === "function") return this._visibleItems();
    if (typeof this._getVisibleEntries === "function") return this._getVisibleEntries().map(entry => entry.item);
    return [];
  }

  _setActiveItem(item, options = {}) {
    const oldId = this._activeId;
    const id = this._idOf(item);
    if (Object.is(oldId, id)) return false;
    this._activeId = id;
    this._syncSelectionState?.();
    this._scrollActiveIntoView();
    if (this.destroyed || !Object.is(this._activeId, id)) return true;
    this._renderStatusBar?.();
    if (this.destroyed || !Object.is(this._activeId, id)) return true;
    if (!options.silent) this.events.emit("activeChange", { source:this, oldId, id, item,
      origin:options.origin??"api", userAction:options.userAction===true });
    return true;
  }

  _setActiveCell(item, columnId, options = {}) {
    const oldId = this._activeId;
    const oldColumnId = this._activeColumnId;
    const id = this._idOf(item);
    const column = this.getColumn(columnId) ?? this._visibleColumns()[0] ?? null;
    if (!column) return false;
    this._activeId = id;
    this._activeColumnId = column.id;
    this._syncSelectionState?.();
    this._scrollActiveCellIntoView();
    if (this.destroyed || !Object.is(this._activeId, id) || this._activeColumnId !== column.id) return true;
    this._renderStatusBar?.();
    if (this.destroyed || !Object.is(this._activeId, id) || this._activeColumnId !== column.id) return true;
    if (Object.is(oldId, id) && oldColumnId === column.id) return false;
    if (!options.silent) this.events.emit("activeCellChange", { source:this, oldId, oldColumnId, id,
      columnId:column.id, item, column, origin:options.origin??"api",
      userAction:options.userAction===true });
    return true;
  }

  _moveActiveColumn(delta, options = {}) {
    const columns = this._visibleColumns();
    if (!columns.length) return false;
    const current = this._getActiveColumnIndex();
    const next = Math.max(0, Math.min(columns.length - 1, current + delta));
    const item = this._itemById(this._activeId) ?? this._activeItems()[0];
    return item ? this._setActiveCell(item, columns[next].id, options) : false;
  }

  _getActiveColumnIndex() {
    const index = this._visibleColumns().findIndex(column => column.id === this._activeColumnId);
    return index >= 0 ? index : 0;
  }

  _scrollActiveIntoView() {
    if (!this._body || this._activeId == null) return;
    const rowKey = this._rowKeysById.get(this._activeId);
    const row = rowKey
      ? this._body.querySelector(`[data-dui-grid-row-id="${escapeCss(rowKey)}"]`)
      : null;
    if (row) {
      row.scrollIntoView({ block:"nearest" });
      return;
    }
    if (!this.virtualRows) return;
    const items = this._activeItems();
    const rowIndex = items.findIndex(item => Object.is(this._idOf(item), this._activeId));
    if (rowIndex < 0) return;
    this._virtualRenderer.scrollIndexIntoView(rowIndex);
    this._renderRows?.();
  }

  _scrollActiveCellIntoView() {
    this._scrollActiveIntoView();
    this._getCellElement(this._activeId, this._activeColumnId)
      ?.scrollIntoView({ block:"nearest", inline:"nearest" });
  }

  _getCellElement(id, columnId) {
    if (!this._body || id == null || columnId == null) return null;
    const rowKey = this._rowKeysById.get(id);
    const row = rowKey
      ? this._body.querySelector(`[data-dui-grid-row-id="${escapeCss(rowKey)}"]`)
      : null;
    return row?.querySelector(`[data-dui-grid-column-id="${escapeCss(columnId)}"]`) ?? null;
  }

  destroy() {
    if (this.destroyed) return;
    this._gridMenu?.destroy();
    this._gridMenu = null;
    this._gridMenuButton = null;
    this._gridMenuOpen = false;
    this._initialColumnLayout = null;
    this._columnMenu?.destroy();
    this._columnMenu = null;
    this._columnReorderController.destroy();
    this._columnResizer.destroy();
    this._keyboardController.destroy();
    this._selectionController.destroy();
    this._virtualRenderer.destroy();
    super.destroy();
    this._indicatorHeader = null;
    this._rowKeysById.clear();
    this._idsByRowKey.clear();
  }
}

function escapeCss(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replaceAll('"', '\\"');
}
