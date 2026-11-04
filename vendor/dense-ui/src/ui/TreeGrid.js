import { createTreeGridNodeDragController } from "./TreeNodeDragController.js";
import { moveTreeGridNodes } from "./GridTreeMove.js";

import { changeTreeExpansion } from "./treeExpansion.js";

import { compareGridStrings } from "./gridStringCompare.js";

import { assertProjectionCurrent } from "../core/projectionBuild.js";

import { mountGridEditor, releaseGridEditor, handleGridEditorKeyDown, startAdjacentGridEdit, gridEditActivation } from "./gridEditorLifecycle.js";

import { normalizeMutationOptions } from "../core/mutationOptions.js";

import { bindViewSort } from "../core/viewSortBinding.js";

import { DataStore } from "../core/DataStore.js";

import { SelectionModel } from "../core/SelectionModel.js";

import { TreeDataView } from "../core/TreeDataView.js";

import { GridCore } from "./GridCore.js";

import { isGridEditorFactory } from "./gridEditorFactory.js";

import { normalizeColumnFilter, matchesColumnFilter } from "../core/GridFilterModel.js";

import { createIcon } from "./Icon.js";

import { GridWindowRenderer } from "./GridWindowRenderer.js";

import { reconcileChildren } from "./gridWindowGeometry.js";

import { assertFilterViewAvailable, bindViewFilter } from "../core/viewFilterBinding.js";

import { bindGridSelection, setGridSelectedIds } from "./gridSelectionState.js";



const DEFAULT_GRID_ROW_HEIGHT = 24;

const DEFAULT_GRID_OVERSCAN = 6;

const DEFAULT_GRID_FALLBACK_VISIBLE_ROWS = 40;



export class TreeGrid extends GridCore {

  constructor(containerOrOptions = {}, maybeOptions) {

    const hasContainer =

      typeof containerOrOptions === "string" ||

      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);



    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};



    assertFilterViewAvailable(options.treeView);

    super(options, { columns: normalizeColumns(options.columns ?? []) });

    this.virtualColumns = options.virtualColumns !== false;

    this._windowRenderer = new GridWindowRenderer(this);

    this._committingEdit = false;

    this.parentField = options.parentField ?? "parentId";

    this.rootParentId = options.rootParentId ?? null;

    this.textField = options.textField ?? "text";

    this.iconField = options.iconField ?? "icon";

    this.nodeIcon = options.nodeIcon ?? null;

    this.treeColumnId = options.treeColumnId ?? this.columns[0]?.id ?? null;

    this.expandOnClick = options.expandOnClick === true;

    this.nodeReorderEnabled = options.nodeReorder === true;

    this.multiSelect = options.multiSelect === true;

    this.rowRangeSelection = options.rowRangeSelection === true;

    this.searchPanelVisible = options.searchPanel === true;

    this.statusBarOptions = normalizeTreeStatusBar(options.statusBar);

    this._filter = null;

    this._columnFilters = new Map();

    this._sortState = [];

    this._searchQuery = "";

    this._editing = null;

    this._ownsData = !options.data && !options.treeView?.data;

    this._ownsTreeView = !options.treeView;

    this._ownsSelection = !options.selection;



    this.data =

      options.data ??

      options.treeView?.data ??

      new DataStore({

        idField: options.idField ?? "id",

        getId: options.getId

      });



    assertDataStore(this.data);



    this.treeView =

      options.treeView ??

      new TreeDataView({

        data: this.data,

        parentField: this.parentField,

        rootParentId: this.rootParentId,

        expandedIds: options.expandedIds,

        expandAll: options.expandAll

      });

    assertTreeDataView(this.treeView);



    if (this.treeView.data && this.treeView.data !== this.data) {

      throw new Error("TreeGrid treeView must project the same DataStore used by TreeGrid data.");

    }

    this._filter = this.treeView.getFilter?.() ?? null;



    this.selection =

      options.selection ??

      new SelectionModel({

        multiple: this.multiSelect

      });



    assertSelectionModel(this.selection);



    this.disposables.add(

      this.data.events.on("change", event => {

        if (this.destroyed) return;

        if (event.newId != null && Object.is(this._activeId, event.id)) {

          this._activeId = event.newId;

        }



        this._reconcileSelection();

        if (this.destroyed) return;

        this.events.emit("dataChange", {

          source: this,

          dataEvent: event,

          origin: event.origin,

          userAction: event.userAction

        });

      })

    );



    this.disposables.add(

      this.treeView.events.on("invalidate", event => {

        if (this.destroyed) return;

        if (this._body) this._windowRenderer.captureAnchor();

        if (this._editing && !this._committingEdit &&

            (this.data.get(this._editing.id) !== this._editing.item || !this.treeView.has(this._editing.id))) {

          this._discardActiveEdit(event);

          if (this.destroyed) return;

        }

        this._reconcileActiveItem();

        this._reconcileSelection();

        if (this.destroyed) return;

        this._windowRenderer.request();

      })

    );

    this.disposables.add(

      this.treeView.events.on("change", event => {

        if (this.destroyed) return;

        this._reconcileActiveItem();

        this._reconcileSelection();

        if (this.destroyed) return;

        this._windowRenderer.request();

        this.events.emit("treeViewChange", {

          source: this,

          viewEvent: event,

          origin: event.origin,

          reason: event.reason,

          userAction: event.userAction

        });

      })

    );



    bindGridSelection(this);



    this.disposables.add(bindViewSort(this.treeView, sort => {

      if (sort === this._ownedViewSort || !this._sortState.length) return;

      this._sortState = [];

      this._renderHeader();

    }));

    this._filterBinding = bindViewFilter(this.treeView, this._filter, filter => {

      this._filter = filter;

      return this._createFilterProjection();

    }, () => this._windowRenderer.request());

    this._nodeDragController = createTreeGridNodeDragController(this);

    if (hasContainer) {

      try { this.mount(containerOrOptions); }

      catch (error) { this.destroy(); throw error; }

    }

  }



  mount(container) {

    super.mount(container);

    this._windowRenderer.invalidateColumns();

    this._renderRows();

    return this;

  }



  createElement() {

    const root = document.createElement("div");

    root.className = ["dui-control", "dui-grid", "dui-tree-grid", this.css, this.className]

      .filter(Boolean)

      .join(" ");

    root.classList.toggle("dui-grid--virtual", this.virtualRows);

    root.classList.toggle("dui-grid--indicator-gutter", this.indicatorGutterEnabled);

    root.dataset.duiControlId = this.id;

    root.dataset.duiFocusTarget = "true";

    root.tabIndex = this.disabled ? -1 : 0;

    root.setAttribute("role", "treegrid");

    root.setAttribute("aria-colcount", String(this._visibleColumns().length));



    if (this.rowHeight != null) {

      root.style.setProperty("--dui-grid-row-height", normalizeCssSize(this.rowHeight));

    }



    const header = document.createElement("div");

    header.className = "dui-grid__header";

    header.setAttribute("role", "row");



    const body = document.createElement("div");

    body.className = "dui-grid__body";

    body.tabIndex = -1;



    const search = document.createElement("div");

    search.className = "dui-grid__search-panel";

    search.hidden = !this.searchPanelVisible;

    const searchInput = document.createElement("input");

    searchInput.className = "dui-grid__search-input";

    searchInput.type = "search";

    searchInput.placeholder = "Search tree...";

    searchInput.value = this._searchQuery;

    search.appendChild(searchInput);



    const status = document.createElement("div");

    status.className = "dui-grid__status-bar";

    status.hidden = !this.statusBarOptions.visible;



    root.append(search, header, body, status);

    root.style.gridTemplateRows = `${this.searchPanelVisible ? "var(--dui-control-height) " : ""}var(--dui-control-height) minmax(0, 1fr)${this.statusBarOptions.visible ? " var(--dui-control-height)" : ""}`;

    this._header = header;

    this._body = body;

    this._searchPanel = search;

    this._searchInput = searchInput;

    this._statusBar = status;

    this._nodeDragController?.attachGrid(body);



    this.disposables.addEventListener(searchInput, "input", () => {

      this.setSearchQuery(searchInput.value, { origin:"user", userAction:true });

    });



    this.disposables.addEventListener(root, "click", event => {

      this._handleClick(event, root);

    });



    this.disposables.addEventListener(root, "keydown", event => {

      this._handleKeyDown(event);

    });

    this.disposables.addEventListener(root, "dblclick", event => {

      if (this.disabled || this.destroyed || this._editing) return;

      const cell = event.target.closest?.(".dui-grid__cell");

      const row = event.target.closest?.(".dui-grid__row");

      const item = row ? this._getItemFromRow(row) : null;

      const column = cell ? this.getColumn(cell.dataset.duiGridColumnId) : null;

      if (!item || !column || !root.contains(row)) return;

      if (!this._emitDoubleClick(event, item, column, getCellValue(item, column, this._getVisibleEntries().findIndex(entry => entry.item === item)))) return;

      if (this.data.get(this.data.idOf(item)) === item && this.getColumn(column.id) === column)

        this.startEdit(item, column.id, { origin:"user", userAction:true });

    });



    this.disposables.addEventListener(body, "scroll", () => {

      header.scrollLeft = body.scrollLeft;



      if (this.virtualRows || this.virtualColumns) {

        if (this._editing && (this._editing.scrollTop !== body.scrollTop || this._editing.scrollLeft !== body.scrollLeft)) {

          this._discardActiveEdit({ origin: "user", reason: "scroll", userAction: true });

          this._windowRenderer.request();

        }

        this._windowRenderer.request({ scrollOnly: true });

      }

    });



    this._renderHeader();

    // mount() renders rows after BaseControl attaches the shell. Avoid building

    // the full-column fallback window before the viewport can be measured.

    this._renderStatusBar();

    this._mountColumnMenu();

    return root;

  }



  refresh() {

    if (this._windowRenderer.painting) return this;

    super.refresh();

    this._renderHeader();

    this._renderRows();

    return this;

  }



  enable() {

    super.enable();

    this._nodeDragController?.sync();



    if (this.element) {

      this.element.tabIndex = 0;

    }



    return this;

  }



  disable() {

    super.disable();

    this._nodeDragController?.sync();

    if (this.destroyed || !this.disabled) return this;



    if (this.element) {

      this.element.tabIndex = -1;

    }



    return this;

  }



  destroy() {

    if (this.destroyed || this._destroyingGrid) return;

    this._destroyingGrid = true;

    try {

      this._nodeDragController?.destroy();

      this._windowRenderer.destroy();

      const ownedData = this._ownsData ? this.data : null;

      const ownedTreeView = this._ownsTreeView ? this.treeView : null;

      const ownedSelection = this._ownsSelection ? this.selection : null;



      releaseGridEditor(this);

      if (this.destroyed) return;

      this.disposables.dispose();

      if (!this._ownsTreeView && !this.treeView.destroyed && this._ownedViewSort && this.treeView.getSort?.() === this._ownedViewSort) {

        this.treeView.setSort(this._detachedViewSort ?? null, {

          silent: true, origin: "system", reason: "sort-owner-destroy"

        });

      }

      super.destroy();

      this._filterBinding?.dispose({ refresh: !this._ownsTreeView });

      this._filterBinding = null;



      this._header = null;

      this._body = null;

      this._rowKeysById.clear();

      this._idsByRowKey.clear();

      this.columnModel.destroy();



      if (ownedTreeView && !ownedTreeView.destroyed) {

        ownedTreeView.destroy();

      }



      if (ownedData && !ownedData.destroyed) {

        ownedData.destroy();

      }



      if (ownedSelection && !ownedSelection.destroyed) {

        ownedSelection.destroy();

      }

    } finally { this._destroyingGrid = false; }

  }



  moveNode(id, targetId, position = "inside", options = {}) {
    return this.moveNodes([id], targetId, position, options);
  }

  moveNodes(ids, targetId, position = "inside", options = {}) {
    return moveTreeGridNodes(this, ids, targetId, position, options);
  }

  setColumns(columns) {

    this._assertMutable("setColumns");

    const nextColumns = normalizeColumns(columns);

    const revision = this._schemaRevision = (this._schemaRevision ?? 0) + 1;

    const current = () => !this.destroyed && this._schemaRevision === revision;

    this.columns = nextColumns;

    this._withDeferredColumnRender(() => this.columnModel.replace(this.columns, { silent:true }));

    if (!current()) return this;

    this.cancelEdit({silent:true, origin:"system", reason:"columns-change"});

    if (!current()) return this;

    this._reconcileColumnState();

    for (const id of this._columnFilters.keys()) {

      if (!this.getColumn(id)) this._columnFilters.delete(id);

    }

    const sort = this._sortState[0];

    if (sort) {

      if (this.getColumn(sort.columnId)?.sortable !== false && this.getColumn(sort.columnId)) {

        this.sortBy(sort.columnId, sort.direction, {silent:true, origin:"system"});

      } else this.clearSort({silent:true, origin:"system"});

      if (!current()) return this;

    }

    this._applyProjection({silent:true, origin:"system"}, "columns-change");

    if (!current()) return this;

    this._renderHeader();

    if (!current()) return this;

    this._renderRows();

    return this;

  }



  getColumn(id) {

    return this.columnModel.get(id);

  }



  getLayoutState() {

    return { version:1, columns:this.columnModel.getState(),

      expandedIds:this.treeView.getExpandedIds() };

  }



  _reconcileColumnState() {

    super._reconcileColumnState();

    if (this.getColumn(this.treeColumnId)?.hidden === true || !this.getColumn(this.treeColumnId)) {

      this.treeColumnId = this._visibleColumns()[0]?.id ?? null;

    }

  }



  restoreLayoutState(state, options = {}) {
    this._assertMutable("restoreLayoutState");
    if (!state || !Array.isArray(state.columns)) throw new TypeError("TreeGrid layout state requires columns.");
    const revision = this._layoutRestoreRevision = (this._layoutRestoreRevision ?? 0) + 1;
    const schema = this._schemaRevision;
    const current = () => !this.destroyed && !this._destroyingGrid &&
      this._layoutRestoreRevision === revision && this._schemaRevision === schema;
    this._withDeferredColumnRender(() => this.columnModel.restoreState(state.columns, { ...options, silent:true }));
    if (!current()) return this;
    this.columns = this.columnModel.all();
    if (Array.isArray(state.expandedIds)) {
      // Restoring retained branches must not temporarily hide their selected
      // descendants (or discard a live editor) via collapseAll/expand.
      const wanted = new Set(state.expandedIds);
      for (const id of this.treeView.getExpandedIds()) {
        if (!wanted.has(id)) this.treeView.collapse(id, { ...options, silent:true });
        if (!current()) return this;
      }
      for (const id of wanted) {
        if (!this.treeView.isExpanded(id)) this.treeView.expand(id, { ...options, silent:true });
        if (!current()) return this;
      }
    }
    this._renderHeader();
    if (!current()) return this;
    this._renderRows();
    return this;
  }

  moveColumn(id, index, options = {}) { return this.columnModel.move(id, index, options); }

  hideColumn(id, options = {}) { return this.columnModel.setHidden(id, true, options); }

  showColumn(id, options = {}) { return this.columnModel.setHidden(id, false, options); }

  freezeColumn(id, side = "left", options = {}) { return this.columnModel.setFrozen(id, side, options); }

  unfreezeColumn(id, options = {}) { return this.columnModel.setFrozen(id, null, options); }



  getSelectedIds() {

    this._assertMutable("getSelectedIds");

    return this.selection

      .get()

      .filter(item => item && typeof item === "object")

      .map(item => this.data.idOf(item));

  }



  setSelectedIds(ids, options = {}) {

    this._assertMutable("setSelectedIds");

    return setGridSelectedIds(this, ids, options);

  }



  selectById(id, options = {}) {

    return this.setSelectedIds([id], options);

  }



  clearSelection(options = {}) {

    this._assertMutable("clearSelection");

    return this.selection.clear(options);

  }



  setFilter(filter, options = {}) {

    if (filter != null && typeof filter !== "function") throw new TypeError("TreeGrid filter must be a function or null.");

    this._filter = filter;

    return this._applyProjection(options, "filter");

  }



  clearFilter(options = {}) { return this.setFilter(null, options); }

  getFilter() { return this._filter; }



  setColumnFilter(columnId, filter, options = {}) {

    this._assertMutable("setColumnFilter");

    if (!this.getColumn(columnId)) throw new Error(`Unknown TreeGrid column: ${String(columnId)}.`);

    const normalized = filter != null && typeof filter === "object"

      ? normalizeColumnFilter(filter) : filter;

    if (filter == null || filter === "") this._columnFilters.delete(columnId);

    else this._columnFilters.set(columnId, normalized);

    const changed = this._applyProjection(options, "column-filter");

    if (this.destroyed) return changed;

    this._renderHeader();

    if (this.treeView._buildingProjection) return changed;

    if (!options.silent) this.events.emit("filterChange", { source:this, columnId,

      activeColumns:[...this._columnFilters.keys()], origin:options.origin??"api",

      userAction:options.userAction===true });

    return changed;

  }



  clearColumnFilter(columnId, options = {}) {

    this._assertMutable("clearColumnFilter");

    if (!this._columnFilters.has(columnId)) return false;

    return this.setColumnFilter(columnId, null, options);

  }



  clearAllFilters(options = {}) {

    this._assertMutable("clearAllFilters");

    this._filter = null;

    this._columnFilters.clear();

    // Preserve the legacy Tree default; explicit search:false is shared with Grid.

    if (options.search !== false) {

      this._searchQuery = "";

      if (this._searchInput) this._searchInput.value = "";

    }

    const changed = this._applyProjection(options, "clear-filters");

    if (this.destroyed) return changed;

    this._renderHeader();

    return changed;

  }



  setSearchQuery(query, options = {}) {

    this._searchQuery = String(query ?? "").trim().toLocaleLowerCase();

    if (this._searchInput) this._searchInput.value = String(query ?? "");

    return this._applyProjection(options, "search");

  }



  sortBy(columnId, direction, options = {}) {

    const column = this.getColumn(columnId);

    if (!column) throw new Error(`Unknown TreeGrid column: ${String(columnId)}.`);

    const current = this._sortState[0];

    const nextDirection = direction ?? (current?.columnId === columnId && current.direction === "asc" ? "desc" : "asc");

    this._sortState = nextDirection ? [{ columnId, direction:nextDirection }] : [];

    const comparator = this._sortState.length ? (left, right) => {

      const leftValue = getCellValue(left, column);

      if (typeof column.value === "function") assertProjectionCurrent(this.treeView);

      const rightValue = getCellValue(right, column);

      if (typeof column.value === "function") assertProjectionCurrent(this.treeView);

      return compareTreeValues(leftValue, rightValue, nextDirection);

    } : null;

    const currentSort = this.treeView.getSort?.();

    if (currentSort !== this._ownedViewSort) this._detachedViewSort = currentSort;

    this._ownedViewSort = comparator;

    const changed = this.treeView.setSort(comparator, { ...options, reason:"sort" });

    if (this.destroyed) return changed;

    this._renderHeader();

    if (this.treeView._buildingProjection || this.treeView.getSort() !== comparator) return changed;

    if (!options.silent) this.events.emit("sortChange", { source:this, columnId, direction:nextDirection,

      sortState:this.getSortState(), origin:options.origin??"api", userAction:options.userAction===true });

    return changed;

  }



  clearSort(options = {}) {

    const hadSort = this._sortState.length > 0;

    this._sortState = [];

    const changed = this.treeView.setSort(null, { ...options, reason:"sort-clear" });

    if (this.destroyed) return changed;

    this._renderHeader();

    if (this.treeView._buildingProjection || this.treeView.getSort() !== null) return changed;

    if (hadSort && !options.silent) this.events.emit("sortChange", { source:this, columnId:null, direction:null,

      sortState:[], origin:options.origin??"api", userAction:options.userAction===true });

    return changed;

  }



  getSortState() { return this._sortState.map(item => ({ ...item })); }



  getSortModel() {

    this._assertMutable("getSortModel");

    return this.getSortState();

  }



  startEdit(itemOrId = this._activeId, columnId = this._activeColumnId, options = {}) {

    if (this.destroyed || this._destroyingGrid || !this.mounted || this.disabled || this._startingEdit || itemOrId == null || columnId == null) return false;

    this._startingEdit = true;

    try {

      const activation = gridEditActivation(this);

      const item = typeof itemOrId === "object" ? itemOrId : this.data.get(itemOrId);

      const column = this.getColumn(columnId);

      if (!item || !column || column.hidden === true) return false;

      const readOnly = typeof column.readOnly === "function" ? column.readOnly(item, column) : column.readOnly;

      if (readOnly === true || !activation.current()) return false;

      if (!getTreeColumnEditor(column, item) || !activation.current()) return false;

      this._startingEdit = false;

      if (this._editing && !this.commitEdit(options)) return false;

      this._startingEdit = true;

      if (this.destroyed || this._editing || !activation.current()) return false;

      const id = this.data.idOf(item);

      if (!this.treeView.has(id)) return false;

      const rowIndex = this.treeView.all().findIndex(current => Object.is(this.data.idOf(current), id));

      const validTarget = () => activation.current() && this.data.get(id) === item &&

        this.treeView.all()[rowIndex] === item && this.getColumn(column.id) === column && column.hidden !== true;

      if (rowIndex < 0 || !validTarget()) return false;

      const value = getCellValue(item, column, rowIndex);

      if (!validTarget()) return false;

      const beforeEvent = { source:this, item, id, column, columnId:column.id, value,

        cancel:false, origin:options.origin ?? "api", userAction:options.userAction === true };

      if (!options.silent) this.events.emit("beforeEditStart", beforeEvent);

      if (beforeEvent.cancel === true || !validTarget()) return false;

      activation.activate(id, column.id);

      this._setActiveCell(item, column.id, options);

      if (!validTarget()) return false;

      const cell = this._getCellElement(id, column.id);

      if (!cell) return false;

      const editor = getTreeColumnEditor(column, item, this);

      if (!editor || !validTarget()) return false;

      const host = document.createElement("div");

      host.className = "dui-grid__editor-host";

      host.addEventListener("keydown", event => this._handleEditorKeyDown(event));

      const cellEditor = editor.createCellEditor({ source: this, grid: this, item, id, rowIndex, column, columnId: column.id, value });

      const editing = { item, id, column, cell, cellEditor, scrollTop: this._body?.scrollTop ?? 0,

        scrollLeft: this._body?.scrollLeft ?? 0, oldValue: value, origin: options.origin ?? "api", userAction: options.userAction === true };

      return mountGridEditor(this, editing, host, options,

        () => validTarget() && this._body?.contains(cell), false);

    } finally { this._startingEdit = false; this._nodeDragController?.sync(); }

  }



  commitEdit(options = {}) {

    const editing = this._editing;

    if (!editing || this.destroyed || this._commitSession || this._startingEdit) return false;

    const mutation = normalizeMutationOptions(options);

    this._commitSession = editing;

    const current = () => !this.destroyed && this._editing === editing;

    const event = { source: this, item: editing.item, id: editing.id, column: editing.column,

      columnId: editing.column.id, oldValue: editing.oldValue,

      origin: mutation.origin, userAction: mutation.userAction };

    const reject = (reason, details = {}) => {

      if (!mutation.silent) this.events.emit("editReject", { ...event, reason, ...details });

      if (current()) editing.cellEditor.focus();

      return false;

    };

    try {

      const validation = editing.cellEditor.validate({ ...event, grid: this });

      if (!current()) return false;

      event.newValue = editing.cellEditor.getValue();

      if (!current()) return false;

      if (validation.ok === false) return reject("validation", { validation });

      const before = { ...event, cancel: false };

      if (!mutation.silent) this.events.emit("beforeCellChange", before);

      if (!current()) return false;

      // Only the draft is editable through beforeCellChange; identity and

      // provenance continue to describe this commit attempt.

      event.newValue = before.newValue;

      if (before.cancel === true) return reject("before-cell-change");

      editing.committedItem = editing.item;

      const changed = !Object.is(event.oldValue, event.newValue);

      let writeResult = false;

      if (changed) {

        this._committingEdit = true;

        try { writeResult = this._writeEditorValue(editing, event.newValue, { ...event, silent: mutation.silent }); }

        finally { this._committingEdit = false; }

        // A completed write cannot be rolled back by closing the editor/table.

        if (!current()) return writeResult !== false;

        if (writeResult === false) return reject("write-rejected", { writeResult });

        event.item = this.data.get(editing.id) ?? editing.item;

        editing.committedItem = event.item;

        if (!mutation.silent) this.events.emit("cellChange", { ...event });

        if (!current()) return true;

      }

      releaseGridEditor(this, editing);

      if (this.destroyed || this._editing) return true;

      if (!mutation.silent) this.events.emit("editCommit", { ...event, changed, writeResult, cancel: false });

      if (!this.destroyed && !this._editing) {

        this._renderRows();

        this.element?.focus({ preventScroll:true });

      }

      return true;

    } finally {

      this._commitSession = null;

    }

  }



  _writeEditorValue(editing, value, context) {

    if (typeof editing.column.set === "function") {

      const result = editing.column.set(editing.item, value, context);

      if (result && typeof result.then === "function") {

        throw new TypeError("TreeGrid column set() must be synchronous.");

      }

      return result !== false;

    }

    const field = editing.column.field ?? editing.column.id;

    return this.data.update(editing.id, { [field]: value }, {

      origin: context.origin, userAction: context.userAction, silent: context.silent

    });

  }



  cancelEdit(options = {}) {

    const changed = this._discardActiveEdit({ ...options, origin: options.origin ?? "api" });

    if (changed && !this.destroyed && !this._editing) {

      this._renderRows();

      this.element?.focus({ preventScroll:true });

    }

    return changed;

  }



  _discardActiveEdit(options = {}) {

    const editing = this._editing;

    if (!editing) return false;

    releaseGridEditor(this, editing);

    if (!this.destroyed && !options.silent) this.events.emit("editCancel", { source:this, item:editing.item, id:editing.id,

      column:editing.column, columnId:editing.column.id, value:editing.oldValue,

      origin:options.origin??"system", reason: options.reason, userAction:options.userAction===true });

    return true;

  }



  _applyProjection(options = {}, reason = "filter") {

    return this.treeView.setFilter(this._filterBinding

      ? this._filter : this._createFilterProjection(), { ...options, reason });

  }



  _createFilterProjection() {

    return this._filter || this._columnFilters.size || this._searchQuery

      ? item => this._matchesProjection(item)

      : null;

  }



  _matchesProjection(item) {

    if (this._filter && !this._filter(item)) return false;

    assertProjectionCurrent(this.treeView);

    for (const [columnId, filter] of this._columnFilters) {

      const column = this.getColumn(columnId);

      if (!column) continue;

      const value = getCellValue(item, column);

      assertProjectionCurrent(this.treeView);

      const matches = typeof filter === "function" ? filter(value, item)

        : filter != null && typeof filter === "object" ? matchesColumnFilter(value, filter)

        : String(value ?? "").toLocaleLowerCase().includes(String(filter).toLocaleLowerCase());

      assertProjectionCurrent(this.treeView);

      if (!matches) return false;

    }

    if (this._searchQuery && !this._visibleColumns().some(column =>

      String(getCellValue(item, column) ?? "").toLocaleLowerCase().includes(this._searchQuery))) return false;

    return true;

  }



  expand(idOrItem, options = {}) {

    this._assertMutable("expand");

    return changeTreeExpansion(this, "expand", this._normalizeItemId(idOrItem), options, "beforeExpand");

  }



  collapse(idOrItem, options = {}) {

    this._assertMutable("collapse");

    return changeTreeExpansion(this, "collapse", this._normalizeItemId(idOrItem), options, "beforeCollapse");

  }



  toggle(idOrItem, options = {}) {

    this._assertMutable("toggle");

    const id = this._normalizeItemId(idOrItem);

    return this.isExpanded(id) ? this.collapse(id, options) : this.expand(id, options);

  }



  expandAll(options = {}) {

    this._assertMutable("expandAll");

    changeTreeExpansion(this, "expandAll", null, options);

    return this;

  }



  collapseAll(options = {}) {

    this._assertMutable("collapseAll");

    changeTreeExpansion(this, "collapseAll", null, options);

    return this;

  }



  isExpanded(idOrItem) {

    return this.treeView.isExpanded(this._normalizeItemId(idOrItem));

  }



  _syncAfterSilentTreeViewChange(changed, options = {}) {

    if (!changed || !options.silent || this.destroyed) {

      return;

    }



    this._reconcileActiveItem();

    this._reconcileSelection();

    if (this.destroyed) return;

    this._windowRenderer.request();

  }



  _renderHeader() {

    if (!this._header) {

      return;

    }



    this._clearHeaderData();

    this._applyColumnTemplate();

    this._appendIndicatorHeader(this._header);



    const columns = this._visibleColumns();

    this.element?.setAttribute("aria-colcount", String(columns.length));

    for (const [columnIndex, column] of columns.entries()) {

      const cell = document.createElement("div");

      cell.className = "dui-grid__header-cell";

      cell.dataset.duiGridColumnId = column.id;

      cell.setAttribute("role", "columnheader");

      cell.setAttribute("aria-colindex", String(columnIndex + 1));

      this._applyFrozenColumnCell(cell, column, columns, columnIndex);

      this._attachColumnDragHandlers(cell, column);



      const title = document.createElement("span");

      title.className = "dui-grid__header-title";

      title.textContent = column.title ?? column.label ?? column.id;

      cell.appendChild(title);



      const sort = this._sortState.find(item => item.columnId === column.id);

      if (sort) {

        cell.classList.add(`dui-grid__header-cell--sort-${sort.direction}`);

        const indicator = document.createElement("span");

        indicator.className = "dui-grid__sort-indicator";

        indicator.setAttribute("aria-hidden", "true");

        cell.appendChild(indicator);

        cell.setAttribute("aria-sort", sort.direction === "desc" ? "descending" : "ascending");

      }

      if (column.sortable !== false) {

        cell.classList.add("dui-grid__header-cell--sortable");

        cell.addEventListener("click", event => {

          if (event.target.closest?.(".dui-grid__resize-handle, .dui-grid__column-menu-button")) return;

          this.sortBy(column.id, undefined, { origin:"user", userAction:true });

        });

      }



      const activeFilter = this._columnFilters.get(column.id);

      if (activeFilter != null) cell.classList.add("dui-grid__header-cell--filtered");

      const menuButton = this._createColumnMenuButton(column, { filtered:activeFilter != null });

      if (menuButton) cell.appendChild(menuButton);



      if (column.resizable !== false) {

        const handle = document.createElement("span");

        handle.className = "dui-grid__resize-handle";

        handle.dataset.duiGridResizeColumnId = column.id;

        handle.setAttribute("aria-hidden", "true");



        handle.addEventListener("pointerdown", event => {

          this._columnResizer.start(event, column);

        });



        cell.appendChild(handle);

      }



      this._header.appendChild(cell);

    }

  }



  _renderRows(scrollWindow = null) {

    if (this._windowRenderer.painting) {

      this._windowRenderer.request();

      return;

    }

    return this._windowRenderer.paint(() => this._renderRowsPass(scrollWindow));

  }



  _renderRowsPass(scrollWindow = null) {

    if (!this._body || this.destroyed) return;

    this._windowRenderer.cancel();

    const revision = this._windowRenderer.revision;

    this._rowKeysById.clear(); this._idsByRowKey.clear();

    let layout, range;

    if (scrollWindow) {

      ({ layout, range } = scrollWindow);

    } else {

      const entries = this._getVisibleEntries().map((entry, rowIndex) => ({ ...entry, rowIndex, type: "item" }));

      layout = this._windowRenderer.columns();

      range = this._windowRenderer.prepare(entries);

    }

    this.element?.setAttribute("aria-rowcount", String(this._windowRenderer.entries.length + 1));

    this.element?.setAttribute("aria-colcount", String(layout.tracks.length));

    let left = layout.indicatorWidth, right = 0;

    for (const track of layout.tracks) if (track.column.frozen === "left") { track.offset = left; left += track.width; }

    for (const track of [...layout.tracks].reverse()) if (track.column.frozen === "right") { track.offset = right; right += track.width; }

    this._windowRenderer.draw(range, (record, entry, index, reused) => {

      const { row } = record, rowKey = toRowKey(entry.id);

      if (!scrollWindow || !reused) {

        row.classList.add("dui-grid__row", "dui-tree-grid__row");

        row.classList.toggle("dui-grid__row--indicator-gutter", this.indicatorGutterEnabled);

        row.dataset.duiGridRowId = rowKey;

        row.dataset.duiGridRowIndex = String(index);

        row.dataset.duiTreeLevel = String(entry.level);

        row.setAttribute("role", "row");

        row.setAttribute("aria-rowindex", String(index + 2));

        row.setAttribute("aria-level", String(entry.level + 1));

        if (entry.hasChildren) row.setAttribute("aria-expanded", String(entry.expanded));

        else row.removeAttribute("aria-expanded");

        row.style.gridTemplateColumns = layout.template;

        row.style.width = layout.totalWidth ? `${layout.totalWidth}px` : "";

        // Keep intrinsic sizing for full-column/fallback layouts only.

        row.style.minWidth = layout.virtual ? "0" : "";

      }

      this._rowKeysById.set(entry.id, rowKey); this._idsByRowKey.set(rowKey, entry.id);

      const indicator = this.indicatorGutterEnabled ? (record.indicator ??= this._createIndicatorCell("row")) : null;

      if (indicator) this._nodeDragController?.syncIndicator(indicator, entry);

      const cells = indicator ? [indicator] : [], retained = new Set();

      for (const track of layout.visible) {

        const { column } = track;

        let cell = record.cells.get(column.id);

        const existing = Boolean(cell);

        if (!cell) { cell = document.createElement("div"); record.cells.set(column.id, cell); }

        retained.add(column.id); cells.push(cell);

        if (scrollWindow && existing) continue;

        cell.dataset.duiGridColumnId = column.id;

        cell.id = `${this.id}-tree-cell-${encodeURIComponent(rowKey)}-${encodeURIComponent(column.id)}`;

        cell.setAttribute("role", "gridcell");

        cell.setAttribute("aria-colindex", String(track.index + 1));

        cell.style.gridColumn = String(track.index + 1 + (this.indicatorGutterEnabled ? 1 : 0)); cell.style.gridRow = "1";

        cell.style.left = column.frozen === "left" ? `${track.offset}px` : "";

        cell.style.right = column.frozen === "right" ? `${track.offset}px` : "";

        if (this._editing?.cell === cell) continue;

        cell.className = ["dui-grid__cell", column.align ? `dui-grid__cell--${column.align}` : "",

          column.frozen ? `dui-grid__cell--frozen dui-grid__cell--frozen-${column.frozen}` : ""].filter(Boolean).join(" ");

        const value = getCellValue(entry.item, column, index);

        if (typeof column.value === "function") this._windowRenderer.assertCurrent();

        if (column.id === this.treeColumnId) {

          const content = cell.firstElementChild?.classList.contains("dui-tree-grid__content") ? cell.firstElementChild : null;

          reconcileChildren(cell, [this._createTreeCellContent(value, entry.item, entry, column, index, content)]);

        } else {

          const rendered = renderCellValue(value, entry.item, column, index);

          if (typeof column.render === "function") this._windowRenderer.assertCurrent();

          setTreeCellValue(cell, rendered);

        }

      }

      for (const id of record.cells.keys()) if (!retained.has(id)) record.cells.delete(id);

      reconcileChildren(row, cells);

    }, layout, revision);

    this._header.scrollLeft = this._body.scrollLeft;

    this._syncScrollbarGutter(); this._syncSelectionState(this._body);

    if (!scrollWindow) this._renderStatusBar();

  }



  _afterResize() {

    this._windowRenderer.invalidateColumns();

    if (this._editing) {

      this._windowRenderer.scrollToColumn(this._editing.column.id);

      this._editing.scrollLeft = this._body.scrollLeft;

      this._editing.scrollTop = this._body.scrollTop;

    }

    this._windowRenderer.request(); this._syncScrollbarGutter();

  }



  _renderStatusBar() {

    if (!this._statusBar || !this.statusBarOptions.visible) return;

    const visible = this.treeView.entries().length;

    const total = this.data.all().length;

    const selected = this.selection.get().length;

    this._statusBar.textContent = `Visible ${visible} / Total ${total}${selected ? ` / Selected ${selected}` : ""}`;

  }



  _getColumnMenuItems(column) {

    const sort = this._sortState.find(item => item.columnId === column.id);

    const activeFilter = this._columnFilters.get(column.id);

    const user = { origin:"user", userAction:true };

    const filterable = column.filterable === true;

    const distinctValues = new Set();

    if (filterable) for (const item of this.data.all()) {

      const value = getCellValue(item, column);

      if (!this._isColumnMenuCurrent(column)) return [];

      distinctValues.add(value);

    }

    const values = [...distinctValues].sort((left, right) => compareTreeValues(left, right, "asc")).slice(0, 100);

    return [

      { id:"sort-asc", text:"Sort ascending", checked:sort?.direction === "asc",

        enabled:column.sortable !== false, onClick:() => this.sortBy(column.id, "asc", user) },

      { id:"sort-desc", text:"Sort descending", checked:sort?.direction === "desc",

        enabled:column.sortable !== false, onClick:() => this.sortBy(column.id, "desc", user) },

      { id:"clear-sort", text:"Clear sorting", enabled:sort != null,

        onClick:() => this._clearColumnSort(column.id, user) },

      "-",

      { id:"filter-values", text:"Filter values", enabled:filterable, items:values.map((value, index) => ({

        id:`filter-value-${index}`, text:String(value ?? "(blank)"),

        checked:activeFilter === value,

        onClick:() => this.setColumnFilter(column.id, value, user)

      })) },

      { id:"clear-filter", text:"Clear filter", enabled:activeFilter != null,

        onClick:() => this.setColumnFilter(column.id, null, user) },

      "-",

      ...this._getColumnLayoutMenuItems(column)

    ];

  }



  _getRenderRange(rowCount) {

    return super._getRenderRange(rowCount);

  }



  _getVirtualRowHeight() {

    return super._getVirtualRowHeight();

  }



  _createTreeCellContent(value, item, entry, column, rowIndex, content = null) {

    content ??= document.createElement("span");

    content.className = "dui-tree-grid__content";

    content.style.setProperty("--dui-tree-level", String(entry.level));

    const toggle = content.firstElementChild ?? document.createElement("span");

    toggle.className = "dui-tree-grid__toggle";

    toggle.setAttribute("aria-hidden", "true");

    if (entry.hasChildren) toggle.dataset.duiTreeToggle = "true";

    else delete toggle.dataset.duiTreeToggle;

    const text = content.lastElementChild ?? document.createElement("span");

    text.className = "dui-tree-grid__text";

    const resolved = typeof this.nodeIcon === "function" ? this.nodeIcon(item, entry, this) : item?.[this.iconField];

    if (typeof this.nodeIcon === "function") this._windowRenderer.assertCurrent();

    const signature = resolved instanceof Node ? resolved : JSON.stringify(resolved);

    if (content._iconSignature !== signature) {

      content._iconSignature = signature;

      content._nodeIcon = this._createNodeIcon(item, entry, resolved);

    }

    const icon = content._nodeIcon;

    if (icon) content.classList.add("dui-tree-grid__content--has-icon");

    const label = value ?? getItemText(item, this.textField);

    this._windowRenderer.assertCurrent();

    const rendered = renderCellValue(label, item, column, rowIndex);

    if (typeof column.render === "function") this._windowRenderer.assertCurrent();

    setTreeCellValue(text, rendered);

    reconcileChildren(content, [toggle, ...(icon ? [icon] : []), text]);

    return content;

  }



  _createNodeIcon(item, entry, resolved) {

    if (resolved == null || resolved === false || resolved === "") return null;

    if (typeof Node !== "undefined" && resolved instanceof Node) {

      resolved.classList?.add("dui-tree-grid__node-icon");

      resolved.setAttribute?.("aria-hidden", "true");

      return resolved;

    }

    const definition = typeof resolved === "object" ? resolved : { name:String(resolved) };

    const icon = document.createElement(definition.tagName === "img" ? "img" : "span");

    icon.className = ["dui-tree-grid__node-icon", definition.className ?? ""].filter(Boolean).join(" ");

    icon.setAttribute("aria-hidden", "true");

    if (icon instanceof HTMLImageElement) {

      icon.src = definition.src ?? "";

      icon.alt = "";

    } else if (definition.name) {

      icon.append(createIcon(definition.name));

    } else if (definition.text != null) {

      icon.textContent = String(definition.text);

    }

    if (definition.title) icon.title = String(definition.title);

    return icon;

  }



  _syncSelectionState(element = this._body) {

    if (!element) {

      return;

    }



    const selectedIds = new Set(

      this.selection

        .get()

        .filter(item => item && typeof item === "object")

        .map(item => this.data.idOf(item))

    );



    let activeDescendant = null;

    for (const row of element.querySelectorAll(".dui-grid__row")) {

      const id = this._idsByRowKey.get(row.dataset.duiGridRowId);

      const selected = selectedIds.has(id);

      const active = Object.is(id, this._activeId);



      row.classList.toggle("dui-selected", selected);

      row.classList.toggle("dui-active", active);

      row.setAttribute("aria-selected", selected ? "true" : "false");



      for (const cell of row.querySelectorAll(".dui-grid__cell")) {

        if (active && cell.dataset.duiGridColumnId === this._activeColumnId) activeDescendant = cell.id;

        cell.classList.toggle(

          "dui-grid__cell--active",

          active && cell.dataset.duiGridColumnId === this._activeColumnId

        );

      }

    }

    if (activeDescendant) this.element?.setAttribute("aria-activedescendant", activeDescendant);

    else this.element?.removeAttribute("aria-activedescendant");

  }



  _handleClick(event, root) {

    const cell = event.target.closest?.(".dui-grid__cell");

    const row = event.target.closest?.(".dui-grid__row");



    if (!row || !root.contains(row)) {

      return;

    }



    const item = this._getItemFromRow(row);



    if (!item) {

      return;

    }



    const id = this.data.idOf(item);

    const column = cell ? this.getColumn(cell.dataset.duiGridColumnId) : null;

    const toggleClicked = Boolean(event.target.closest?.("[data-dui-tree-toggle]"));



    if (

      this._editing &&

      (!Object.is(this._editing.id, id) || this._editing.column.id !== column?.id)

    ) {

      const committed = this.commitEdit({

        origin: "user",

        userAction: true

      });



      if (!committed) {

        event.preventDefault();

        event.stopPropagation();

        this._editing?.cellEditor.focus();

        return;

      }

    }



    if (toggleClicked) {

      this.toggle(id, {

        origin: "user",

        userAction: true

      });

      return;

    }



    if (this.expandOnClick && this._hasChildren(id) && column?.id === this.treeColumnId) {

      this.toggle(id, {

        origin: "user",

        userAction: true

      });

    }



    this._selectionController.selectFromUser(item, event);

    if (this.destroyed) return;



    if (column) {

      this._setActiveCell(item, column.id, {

        origin: "user",

        userAction: true

      });

    }



    this.events.emit("rowClick", {

      source: this,

      item,

      id,

      nativeEvent: event,

      origin: "user",

      userAction: true

    });



    if (cell) {

      this.events.emit("cellClick", {

        source: this,

        item,

        id,

        column,

        columnId: column?.id ?? null,

        value: column ? getCellValue(item, column, this._getVisibleEntries().findIndex(entry => entry.item === item)) : undefined,

        nativeEvent: event,

        origin: "user",

        userAction: true

      });

    }

  }



  _handleKeyDown(event) {

    if (this.destroyed || this.disabled || this._editing || event.defaultPrevented || event.isComposing || event.keyCode === 229) {

      return;

    }

    if (event.target !== this.element && event.target?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;



    const entries = this._getVisibleEntries();



    if (entries.length === 0) {

      return;

    }



    let index = this._getActiveEntryIndex(entries);

    const activeEntry = entries[index] ?? entries[0];

    if (this._keyboardController.handleNavigation(event, {

      rows:entries,

      activeIndex:index,

      itemOf:entry => entry.item,

      onRight:mutation => {

        if (this._activeColumnId !== this.treeColumnId || !activeEntry.hasChildren || activeEntry.expanded) {

          return false;

        }

        this.expand(activeEntry.id, mutation);

        return true;

      },

      onLeft:mutation => {

        if (this._activeColumnId !== this.treeColumnId) return false;

        if (activeEntry.hasChildren && activeEntry.expanded) {

          this.collapse(activeEntry.id, mutation);

          return true;

        }

        if (activeEntry.parentId == null) return false;

        const parent = this.treeView.get(activeEntry.parentId);

        if (!parent) return false;

        this._setActiveItem(parent, mutation);

        return true;

      }

    })) {

      event.preventDefault();

      return;

    }

    let handled = true;



    switch (event.key) {

      case "F2":

        this.startEdit(activeEntry.item, this._activeColumnId, { origin:"user", userAction:true });

        break;

      case "Enter":

        if (this.startEdit(activeEntry.item, this._activeColumnId, { origin:"user", userAction:true })) break;

        if (this.destroyed || this._editing) break;

        this._selectionController.selectOnly(activeEntry.item);

        break;

      case " ":

        this._selectionController.selectOnly(activeEntry.item);

        break;



      default:

        handled = false;

        break;

    }



    if (handled) {

      event.preventDefault();

    }

  }



  _setActiveItem(item, options = {}) {

    return super._setActiveItem(item, options);

  }



  _handleEditorKeyDown(event) {

    handleGridEditorKeyDown(this, event, isEditableTreeColumn);

  }



  _startAdjacentEdit(editing, direction) {

    return startAdjacentGridEdit(this, editing, direction, isEditableTreeColumn) === "started";

  }



  _setActiveCell(item, columnId, options = {}) {

    return super._setActiveCell(item, columnId, options);

  }



  _moveActiveColumn(delta, options = {}) {

    return super._moveActiveColumn(delta, options);

  }



  _getActiveColumnIndex() {

    return super._getActiveColumnIndex();

  }



  _getActiveEntryIndex(entries) {

    const index = entries.findIndex(entry => Object.is(entry.id, this._activeId));

    return index;

  }



  _scrollActiveIntoView() {

    if (!this._body || this._activeId == null) return;

    this._windowRenderer.flush();

    if (!this.virtualRows) return super._scrollActiveIntoView();

    if (this._windowRenderer.scrollToRow(this._activeId)) this._renderRows();

  }



  _scrollActiveCellIntoView() {

    this._scrollActiveIntoView();

    if (!this._body) return;

    this._windowRenderer.scrollToColumn(this._activeColumnId); this._renderRows();

  }



  _getCellElement(id, columnId) {

    return super._getCellElement(id, columnId);

  }



  _getItemFromRow(row) {

    const id = this._idsByRowKey.get(row.dataset.duiGridRowId);

    return id == null ? null : this.treeView.get(id) ?? null;

  }



  _reconcileSelection() {

    const current = this.selection.get();

    const next = current.flatMap(item => {

      if (!item || typeof item !== "object") {

        return [];

      }



      const id = this.data.idOf(item);

      const currentItem = this._nodeMoveSelectionHold ? this.data.get(id) : this.treeView.get(id);

      return currentItem ? [currentItem] : [];

    });



    if (next.length !== current.length || next.some((item, index) => item !== current[index])) {

      this.selection.set(next, {

        silent: true,

        origin: "system"

      });

    }

  }



  _getVisibleEntries() {

    return this.treeView.entries();

  }



  _visibleColumns() {

    return super._visibleColumns();

  }



  _applyFrozenColumnCell(cell, column, columns, columnIndex) {

    return super._applyFrozenColumnCell(cell, column, columns, columnIndex);

  }



  _hasChildren(id) {

    return this.treeView.hasChildren(id);

  }



  _getParentId(item) {

    return this.treeView.parentIdOf(item);

  }



  _normalizeItemId(idOrItem) {

    if (idOrItem && typeof idOrItem === "object") {

      return this.data.idOf(idOrItem);

    }



    return idOrItem;

  }



  _reconcileActiveItem() {

    if (this._activeId != null && !this.treeView.has(this._activeId)) {

      this._activeId = null;

    }

  }



  _getGridTemplateColumns() {

    return super._getGridTemplateColumns();

  }



  _applyColumnTemplate() {

    super._applyColumnTemplate();

    this._windowRenderer?.invalidateColumns(); this._windowRenderer?.request();

  }



  _createExpandEvent(type, id, options = {}, extra = {}) {

    return {

      source: this,

      type,

      id,

      item: this.data.get(id) ?? null,

      origin: options.origin ?? "api",

      userAction: options.userAction === true,

      ...extra

    };

  }



  _emitExpandEvent(type, id, options = {}) {

    if (options.silent) {

      return;

    }



    this.events.emit(type, this._createExpandEvent(type, id, options));

  }

}



function normalizeColumns(columns) {

  if (!Array.isArray(columns)) {

    throw new TypeError("TreeGrid columns must be an array.");

  }



  return columns.map(column => {

    if (!column || typeof column !== "object") {

      throw new TypeError("TreeGrid column must be an object.");

    }



    if (!column.id) {

      throw new TypeError("TreeGrid column requires id.");

    }



    return {

      minWidth: 48,

      maxWidth: null,

      resizable: true,

      ...column

    };

  });

}



function normalizeTreeStatusBar(value) {

  if (value === false) return { visible:false };

  if (value === true) return { visible:true };

  return { visible:value?.visible === true };

}



function compareTreeValues(left, right, direction) {

  let result;

  if (left == null && right == null) result = 0;

  else if (left == null) result = -1;

  else if (right == null) result = 1;

  else if (typeof left === "number" && typeof right === "number") result = left - right;

  else result = compareGridStrings(left, right);

  return direction === "desc" ? -result : result;

}



function getTreeColumnEditor(column, item, grid) {

  if (!column) return null;

  const editor = typeof column.editor === "function" ? column.editor(item, column, grid) : column.editor;

  if (editor == null || editor === false) return null;

  if (isGridEditorFactory(editor) || typeof editor.createCellEditor === "function") return editor;

  throw new TypeError("TreeGrid column editor must implement createCellEditor().");

}



function isEditableTreeColumn(column, item) {

  const readOnly = typeof column?.readOnly === "function" ? column.readOnly(item, column) : column?.readOnly;

  return readOnly !== true && getTreeColumnEditor(column, item) != null;

}



function assertDataStore(store) {

  const requiredMethods = ["parse", "all", "get", "add", "update", "remove", "clear", "idOf"];



  for (const method of requiredMethods) {

    if (typeof store?.[method] !== "function") {

      throw new TypeError("TreeGrid data must implement DataStore.");

    }

  }



  if (!store.events || typeof store.events.on !== "function") {

    throw new TypeError("TreeGrid data must expose EventBus.");

  }

}



function assertTreeDataView(treeView) {

  const requiredMethods = [

    "entries",

    "get",

    "idOf",

    "parentIdOf",

    "hasChildren",

    "isExpanded",

    "expand",

    "collapse",

    "expandAll",

    "collapseAll"

  ];



  for (const method of requiredMethods) {

    if (typeof treeView?.[method] !== "function") {

      throw new TypeError("TreeGrid treeView must implement TreeDataView.");

    }

  }



  if (!treeView.events || typeof treeView.events.on !== "function") {

    throw new TypeError("TreeGrid treeView must expose EventBus.");

  }

}



function assertSelectionModel(selection) {

  const requiredMethods = ["get", "set", "clear", "hasAny"];



  for (const method of requiredMethods) {

    if (typeof selection?.[method] !== "function") {

      throw new TypeError("TreeGrid selection must implement SelectionModel.");

    }

  }



  if (!selection.events || typeof selection.events.on !== "function") {

    throw new TypeError("TreeGrid selection must expose EventBus.");

  }

}



function getCellValue(item, column, rowIndex) {

  if (typeof column.value === "function") {

    return column.value(item, rowIndex);

  }



  const field = column.field ?? column.id;

  return item[field];

}



function renderCellValue(value, item, column, rowIndex) {

  if (typeof column.render === "function") {

    return column.render(value, item, column, rowIndex);

  }



  return value;

}



function getItemText(item, textField) {

  if (typeof textField === "function") {

    return String(textField(item));

  }



  return String(item[textField] ?? item.id ?? "");

}



function normalizeColumnWidth(width) {

  if (width == null) {

    return "minmax(120px, 1fr)";

  }



  return normalizeCssSize(width);

}



function normalizeCssSize(value) {

  return typeof value === "number" ? `${value}px` : String(value);

}



function normalizeVirtualOverscan(value) {

  const parsed = Number(value ?? DEFAULT_GRID_OVERSCAN);

  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_GRID_OVERSCAN;

}



function parsePixelSize(value) {

  if (typeof value === "number") {

    return Number.isFinite(value) ? value : 0;

  }



  if (typeof value !== "string") {

    return 0;

  }



  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;

}



function toRowKey(id) {

  return `${typeof id}:${String(id)}`;

}



function cssEscape(value) {

  if (globalThis.CSS?.escape) {

    return CSS.escape(value);

  }



  return String(value).replaceAll('"', '\\"');

}



function setTreeCellValue(element, rendered) {

  if (rendered instanceof Node) reconcileChildren(element, [rendered]);

  else {

    const text = rendered == null ? "" : String(rendered);

    if (element.childNodes.length === 1 && element.firstChild.nodeType === Node.TEXT_NODE) {

      if (element.firstChild.nodeValue !== text) element.firstChild.nodeValue = text;

    } else element.replaceChildren(document.createTextNode(text));

  }

}

