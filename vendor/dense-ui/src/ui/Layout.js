import { listenUntilPointerUp } from "../core/pointerTracking.js";
import { Panel } from "./Panel.js";

export class Layout extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.direction = options.rows ? "rows" : options.direction ?? "cols";
    this.css = options.css ?? "";
    this.title = options.title ?? options.headerText ?? "";
    this.headerVisible = options.header !== false && (options.header === true || options.showHeader === true || this.title !== "");
    this._cellConfigs = options.rows ?? options.cols ?? options.cells ?? [];
    this.cells = {};
    this.resizable = options.resizable !== false;
    this._splitters = [];
    this._resizeState = null;
    this._resizeTracking = null;
    this._headerElement = null;
    this._titleElement = null;
    this._bodyElement = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = [
      "dui-control",
      "dui-layout",
      `dui-layout--${this.direction}`,
      this.css,
      this.className
    ]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const header = document.createElement("div");
    header.className = "dui-window-header dui-layout__header";

    const title = document.createElement("span");
    title.className = "dui-window-header__title dui-layout__title";
    header.append(title);

    const body = document.createElement("div");
    body.className = `dui-layout__body dui-layout__body--${this.direction}`;
    root.append(header, body);

    this._headerElement = header;
    this._titleElement = title;
    this._bodyElement = body;
    this._renderLayoutAppearance(root);
    return root;
  }

  getContentElement() {
    return this._bodyElement ?? this.element;
  }

  mount(container) {
    super.mount(container);

    if (this.items.length === 0 && this._cellConfigs.length > 0) {
      this._buildCells();
    }

    return this;
  }

  destroy() {
    this._resizeTracking?.dispose();
    this._resizeTracking = null;
    super.destroy();
    this._headerElement = null;
    this._titleElement = null;
    this._bodyElement = null;
  }

  getTitle() {
    return this.title;
  }

  setTitle(title, options = {}) {
    this._assertMutable("setTitle");
    const oldValue = this.title;
    this.title = title ?? "";
    this._renderLayoutAppearance();
    this._emitAppearanceChange("title", oldValue, this.title, options);
    return this;
  }

  isHeaderVisible() {
    return this.headerVisible;
  }

  setHeaderVisible(visible, options = {}) {
    this._assertMutable("setHeaderVisible");
    const oldValue = this.headerVisible;
    this.headerVisible = visible === true;
    this._renderLayoutAppearance();
    this._emitAppearanceChange("headerVisible", oldValue, this.headerVisible, options);
    return this;
  }

  setBordered(bordered, options = {}) {
    this._assertMutable("setBordered");
    const oldValue = this.bordered;
    this.bordered = bordered === true;
    this._renderLayoutAppearance();
    this._emitAppearanceChange("bordered", oldValue, this.bordered, options);
    return this;
  }

  addCell(config = {}) {
    this._assertMutable("addCell");

    if (!this.element) {
      throw new Error("Layout must be mounted before adding cells.");
    }

    const beforeEvent = {
      source: this,
      config,
      origin: "api",
      userAction: false,
      cancel: false
    };

    this.events.emit("beforeCellAdd", beforeEvent);

    if (beforeEvent.cancel === true || this.destroyed) {
      return null;
    }

    const cell = new LayoutCell(config);
    if (!this.attach(cell)) {
      cell.destroy();
      return null;
    }
    if (this.destroyed || cell.destroyed) return null;
    this.cells[cell.id] = cell;

    if (cell.name) {
      this.cells[cell.name] = cell;
    }

    this.events.emit("cellAdd", {
      source: this,
      cell,
      cellId: cell.id,
      origin: "api",
      userAction: false
    });

    this._renderSplitters();
    return cell;
  }

  removeCell(idOrCell, options = {}) {
    this._assertMutable("removeCell");

    const cell = typeof idOrCell === "string" ? this.getCell(idOrCell) : idOrCell;

    if (!cell || !this.items.includes(cell)) {
      return null;
    }

    const beforeEvent = {
      source: this,
      cell,
      cellId: cell.id,
      origin: options.origin ?? "api",
      userAction: options.userAction === true,
      cancel: false
    };

    this.events.emit("beforeCellRemove", beforeEvent);

    if (beforeEvent.cancel === true || this.destroyed) {
      return null;
    }

    if (!super.remove(cell, options)) return null;
    if (this.destroyed) return cell;

    for (const [key, value] of Object.entries(this.cells)) {
      if (value === cell) {
        delete this.cells[key];
      }
    }

    this._renderSplitters();

    this.events.emit("cellRemove", {
      source: this,
      cell,
      cellId: cell.id,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    return cell;
  }

  getCell(id) {
    return this.cells[id] ?? null;
  }

  cell(id) {
    const cell = this.getCell(id);

    if (!cell) {
      throw new Error(`Layout cell not found: ${id}.`);
    }

    return cell;
  }

  cellItems() {
    return this.items.filter(item => item instanceof LayoutCell);
  }

  forEachCell(callback) {
    this.cellItems().forEach((cell, index) => {
      callback(cell, index, this);
    });
    return this;
  }

  getCellId(index) {
    return this.cellItems()[index]?.id ?? null;
  }

  isResizable() {
    return this.resizable;
  }

  isResizeable() {
    return this.isResizable();
  }

  setResizable(resizable, options = {}) {
    this._assertMutable("setResizable");

    const oldValue = this.resizable;
    this.resizable = resizable !== false;

    if (oldValue === this.resizable) {
      return this;
    }

    this._renderSplitters();

    if (!options.silent) {
      this.events.emit("resizableChange", {
        source: this,
        oldValue,
        newValue: this.resizable,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  setCellSize(id, size, options = {}) {
    this._assertMutable("setCellSize");

    const cell = this.cell(id);
    const oldSize = cell.getLayoutSize();

    cell.setLayoutSize(size, {
      direction: this.direction
    });

    this.events.emit("cellResize", {
      source: this,
      cell,
      cellId: cell.id,
      oldSize,
      size: cell.getLayoutSize(),
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    return this;
  }

  collapseCell(id, options = {}) {
    this._assertMutable("collapseCell");

    const cell = this.cell(id);

    if (cell.collapsed) {
      return false;
    }

    const event = this._createCellVisibilityEvent("beforeCellCollapse", cell, options, {
      cancel: false
    });

    this.events.emit("beforeCellCollapse", event);

    if (event.cancel === true) {
      return false;
    }

    cell.setCollapsed(true, {
      direction: this.direction
    });
    this._renderSplitters();
    this.events.emit("cellCollapse", this._createCellVisibilityEvent("cellCollapse", cell, options));
    return true;
  }

  expandCell(id, options = {}) {
    this._assertMutable("expandCell");

    const cell = this.cell(id);

    if (!cell.collapsed) {
      return false;
    }

    const event = this._createCellVisibilityEvent("beforeCellExpand", cell, options, {
      cancel: false
    });

    this.events.emit("beforeCellExpand", event);

    if (event.cancel === true) {
      return false;
    }

    cell.setCollapsed(false, {
      direction: this.direction
    });
    this._renderSplitters();
    this.events.emit("cellExpand", this._createCellVisibilityEvent("cellExpand", cell, options));
    return true;
  }

  toggleCell(id, options = {}) {
    const cell = this.cell(id);
    return cell.collapsed ? this.expandCell(id, options) : this.collapseCell(id, options);
  }

  serializeState() {
    return {
      direction: this.direction,
      title: this.title,
      headerVisible: this.headerVisible,
      bordered: this.bordered,
      cells: this.items
        .filter(item => item instanceof LayoutCell)
        .map(cell => ({
          id: cell.name ?? cell.id,
          width: cell.width,
          height: cell.height,
          flex: cell.flex,
          collapsed: cell.collapsed
        }))
    };
  }

  restoreState(state, options = {}) {
    this._assertMutable("restoreState");

    if (!state || !Array.isArray(state.cells)) {
      return this;
    }

    if (Object.prototype.hasOwnProperty.call(state, "title")) {
      this.title = state.title ?? "";
    }

    if (Object.prototype.hasOwnProperty.call(state, "headerVisible")) {
      this.headerVisible = state.headerVisible === true;
    }

    if (Object.prototype.hasOwnProperty.call(state, "bordered")) {
      this.bordered = state.bordered === true;
    }

    this._renderLayoutAppearance();

    for (const cellState of state.cells) {
      const cell = this.getCell(cellState.id);

      if (!cell) {
        continue;
      }

      // Expansion restores the previous dimensions. Do it before assigning the
      // imported dimensions, then collapse again if requested so that a later
      // expansion also uses the newly restored size.
      cell.setCollapsed(false, { direction: this.direction });

      if (Object.prototype.hasOwnProperty.call(cellState, "width")) {
        cell.width = cellState.width;
      }

      if (Object.prototype.hasOwnProperty.call(cellState, "height")) {
        cell.height = cellState.height;
      }

      if (Object.prototype.hasOwnProperty.call(cellState, "flex")) {
        cell.flex = cellState.flex;
      }

      cell.setCollapsed(cellState.collapsed === true, {
        direction: this.direction
      });
      cell._applyCellSize(cell.element, this.direction);
    }

    this._renderSplitters();

    if (!options.silent) {
      this.events.emit("stateRestore", {
        source: this,
        state,
        origin: options.origin ?? "restore",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  _buildCells() {
    for (const config of this._cellConfigs) {
      this.addCell(config);
    }
  }

  _renderSplitters() {
    if (!this.element) {
      return;
    }

    for (const splitter of this._splitters) {
      splitter.remove();
    }

    this._splitters = [];

    if (!this.resizable) {
      return;
    }

    const cells = this.cellItems();

    cells.forEach((cell, index) => {
      if (index >= cells.length - 1) {
        return;
      }

      const nextCell = cells[index + 1];

      if (cell.collapsed || nextCell.collapsed || cell.resizable === false || nextCell.resizable === false) {
        return;
      }

      const splitter = document.createElement("div");
      splitter.className = "dui-layout-splitter";
      splitter.dataset.duiLayoutBefore = cell.id;
      splitter.dataset.duiLayoutAfter = nextCell.id;
      splitter.setAttribute("role", "separator");
      splitter.setAttribute("aria-orientation", this.direction === "rows" ? "horizontal" : "vertical");

      splitter.addEventListener("pointerdown", event => {
        this._startResize(event, cell, nextCell);
      });

      cell.element?.after(splitter);
      this._splitters.push(splitter);
    });
  }

  _startResize(event, beforeCell, afterCell) {
    if (event.button !== 0 || this.disabled || !this.resizable) {
      return;
    }

    const beforeEvent = {
      source: this,
      beforeCell,
      afterCell,
      beforeCellId: beforeCell.id,
      afterCellId: afterCell.id,
      origin: "user",
      userAction: true,
      nativeEvent: event,
      cancel: false
    };

    this.events.emit("beforeResizeStart", beforeEvent);

    if (beforeEvent.cancel === true) {
      return;
    }

    event.preventDefault();

    const beforeRect = beforeCell.element.getBoundingClientRect();
    const afterRect = afterCell.element.getBoundingClientRect();
    const horizontal = this.direction === "cols";
    const startBefore = horizontal ? beforeRect.width : beforeRect.height;
    const startAfter = horizontal ? afterRect.width : afterRect.height;

    this._resizeState = {
      beforeCell,
      afterCell,
      horizontal,
      startPointer: horizontal ? event.clientX : event.clientY,
      startBefore,
      startAfter
    };

    this.element.classList.add("dui-layout--resizing");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    this._resizeTracking?.dispose();

    this._resizeTracking = this.disposables.add(
      listenUntilPointerUp({
        target: window,
        move: moveEvent => {
          this._updateResize(moveEvent);
        },
        up: upEvent => {
          this._resizeTracking = null;
          this._finishResize(upEvent);
        }
      })
    );

    this.events.emit("resizeStart", {
      source: this,
      beforeCell,
      afterCell,
      beforeCellId: beforeCell.id,
      afterCellId: afterCell.id,
      origin: "user",
      userAction: true
    });
  }

  _updateResize(event) {
    const state = this._resizeState;

    if (!state) {
      return;
    }

    const pointer = state.horizontal ? event.clientX : event.clientY;
    const delta = pointer - state.startPointer;
    const beforeSize = clampSize(state.startBefore + delta, state.beforeCell);
    const afterSize = clampSize(state.startAfter - delta, state.afterCell);
    const beforeFixed = hasExplicitSize(state.beforeCell, this.direction);
    const afterFixed = hasExplicitSize(state.afterCell, this.direction);

    if (beforeFixed || !afterFixed) {
      state.beforeCell.setLayoutSize(beforeSize, {
        direction: this.direction
      });
    }

    if (afterFixed) {
      state.afterCell.setLayoutSize(afterSize, {
        direction: this.direction
      });
    }

    this.events.emit("resize", {
      source: this,
      ...this.getSize(),
      oldSize: this.getSize(),
      newSize: this.getSize(),
      reason: "splitter",
      beforeCell: state.beforeCell,
      afterCell: state.afterCell,
      beforeCellId: state.beforeCell.id,
      afterCellId: state.afterCell.id,
      beforeSize: state.beforeCell.getLayoutSize(),
      afterSize: state.afterCell.getLayoutSize(),
      origin: "user",
      userAction: true
    });
  }

  _finishResize() {
    const state = this._resizeState;

    if (!state) {
      return;
    }

    this._resizeState = null;
    this.element?.classList.remove("dui-layout--resizing");

    this.events.emit("resizeEnd", {
      source: this,
      beforeCell: state.beforeCell,
      afterCell: state.afterCell,
      beforeCellId: state.beforeCell.id,
      afterCellId: state.afterCell.id,
      beforeSize: state.beforeCell.getLayoutSize(),
      afterSize: state.afterCell.getLayoutSize(),
      origin: "user",
      userAction: true
    });
  }

  _createCellVisibilityEvent(type, cell, options = {}, extra = {}) {
    return {
      source: this,
      type,
      cell,
      cellId: cell.id,
      origin: options.origin ?? "api",
      userAction: options.userAction === true,
      ...extra
    };
  }

  _renderLayoutAppearance(host = this.element) {
    if (!host) {
      return;
    }

    host.classList.toggle("dui-layout--with-header", this.headerVisible);
    host.classList.toggle("dui-layout--bordered", this.bordered);
    host.classList.toggle("dui-layout--borderless", !this.bordered);

    if (this._headerElement) {
      this._headerElement.hidden = !this.headerVisible;
    }

    if (this._titleElement) {
      this._titleElement.textContent = this.title;
      this._titleElement.title = this.title;
    }
  }
}

export class LayoutCell extends Panel {
  constructor(options = {}) {
    super(options);

    this.css = options.css ?? "";
    this.width = options.width ?? null;
    this.height = options.height ?? null;
    this.flex = options.flex ?? options.gravity ?? 1;
    this.minSize = options.minSize ?? options.minWidth ?? options.minHeight ?? 48;
    this.maxSize = options.maxSize ?? null;
    this.resizable = options.resizable !== false;
    this.collapsible = options.collapsible === true;
    this.collapsed = options.collapsed === true;
    this._restoreSize = null;
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-layout-cell", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiLayoutCellId = this.id;
    this._applyCellSize(root);
    this._applyCollapsedState(root);
    return root;
  }

  mount(container) {
    super.mount(container);
    this._applyCellSize(this.element);
    this._applyCollapsedState(this.element);
    return this;
  }

  attach(control, options = {}) {
    if (this.items.includes(control)) {
      return control;
    }

    if (options.replace !== false && this.items.length > 0) {
      this.clear();
    }

    return super.attach(control, options);
  }

  setLayoutSize(size, options = {}) {
    this._assertMutable("setLayoutSize");

    const normalized = clampSize(size, this);

    if ((options.direction ?? "cols") === "rows") {
      this.height = normalized;
      this.width = null;
    } else {
      this.width = normalized;
      this.height = null;
    }

    this._applyCellSize(this.element, options.direction);
    return this;
  }

  getLayoutSize() {
    if (!this.element) {
      return this.width ?? this.height ?? null;
    }

    return this.height != null ? this.element.offsetHeight : this.element.offsetWidth;
  }

  isResizable() {
    return this.resizable;
  }

  isResizeable() {
    return this.isResizable();
  }

  setResizable(resizable, options = {}) {
    this._assertMutable("setResizable");

    const oldValue = this.resizable;
    this.resizable = resizable !== false;

    if (oldValue === this.resizable) {
      return this;
    }

    this.parent?._renderSplitters?.();

    if (!options.silent) {
      this.events.emit("resizableChange", {
        source: this,
        oldValue,
        newValue: this.resizable,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  isCollapsed() {
    return this.collapsed;
  }

  setCollapsed(collapsed, options = {}) {
    this._assertMutable("setCollapsed");

    if (this.collapsed === collapsed) {
      return this;
    }

    if (collapsed) {
      this._restoreSize = {
        width: this.width,
        height: this.height,
        flex: this.flex
      };
    } else if (this._restoreSize) {
      this.width = this._restoreSize.width;
      this.height = this._restoreSize.height;
      this.flex = this._restoreSize.flex;
      this._restoreSize = null;
    }

    this.collapsed = collapsed;
    this._applyCollapsedState(this.element, options.direction);
    return this;
  }

  _applyCellSize(element, direction = null) {
    if (!element) {
      return;
    }

    if (this.collapsed) {
      this._applyCollapsedState(element, direction);
      return;
    }

    if (this.width != null) {
      element.style.width = normalizeCssSize(this.width);
      element.style.flex = `0 0 ${normalizeCssSize(this.width)}`;
    } else if (this.height != null) {
      element.style.height = normalizeCssSize(this.height);
      element.style.flex = `0 0 ${normalizeCssSize(this.height)}`;
    } else {
      element.style.flex = String(this.flex);
    }
  }

  _applyCollapsedState(element, direction = null) {
    if (!element) {
      return;
    }

    element.classList.toggle("dui-collapsed", this.collapsed);

    if (!this.collapsed) {
      this._applyCellSize(element, direction);
      return;
    }

    if ((direction ?? "cols") === "rows") {
      element.style.height = "0px";
      element.style.width = "";
    } else {
      element.style.width = "0px";
      element.style.height = "";
    }

    element.style.flex = "0 0 0px";
  }
}

function normalizeCssSize(value) {
  return typeof value === "number" ? `${value}px` : String(value);
}

function clampSize(size, cell) {
  const value = Number(size);
  const min = cell.minSize == null ? 0 : Number(cell.minSize);
  const max = cell.maxSize == null ? Infinity : Number(cell.maxSize);
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}

function hasExplicitSize(cell, direction) {
  return direction === "rows" ? cell.height != null : cell.width != null;
}
