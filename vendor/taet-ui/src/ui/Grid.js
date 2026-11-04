import { mountGridEditor, releaseGridEditor, handleGridEditorKeyDown, startAdjacentGridEdit, gridEditActivation } from "./gridEditorLifecycle.js";
import { compareGridStrings } from "./gridStringCompare.js";
import { gridIntrinsicWidth } from "./gridIntrinsicWidth.js";
import { assertProjectionCurrent } from "../core/projectionBuild.js";
import { normalizeMutationOptions } from "../core/mutationOptions.js";
import { bindViewSort } from "../core/viewSortBinding.js";
import { DataStore } from "../core/DataStore.js";
import { DataView } from "../core/DataView.js";
import { GridFilterModel } from "../core/GridFilterModel.js";
import { GridSearchModel } from "../core/GridSearchModel.js";
import { GridGroupModel } from "../core/GridGroupModel.js";
import { SelectionModel } from "../core/SelectionModel.js";
import { RangeSelectionModel } from "../core/RangeSelectionModel.js";
import { isGridEditorFactory } from "./gridEditorFactory.js";
import { GridCore } from "./GridCore.js";
import { createIcon } from "./Icon.js";
import { clampColumnWidth } from "./GridColumnResizer.js";
import { GridWindowRenderer } from "./GridWindowRenderer.js";
import { GridRowTransferController, transferGridRows } from "./GridRowTransferController.js";
import { GridRowReorderController } from "./GridRowReorderController.js";
import { reconcileChildren } from "./gridWindowGeometry.js";
import { trackProjection } from "../core/projectionDependencies.js";
import { assertFilterViewAvailable, bindViewFilter } from "../core/viewFilterBinding.js";
import { bindGridSelection, setGridSelectedIds } from "./gridSelectionState.js";

const DEFAULT_GRID_ROW_HEIGHT = 24;
const DEFAULT_GRID_OVERSCAN = 6;
const DEFAULT_GRID_FALLBACK_VISIBLE_ROWS = 40;
const DEFAULT_GRID_NUMBER_FORMAT = new Intl.NumberFormat();

export class Grid extends GridCore {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    assertFilterViewAvailable(options.view);
    const columns = normalizeColumns(options.columns ?? []);
    const formatting = normalizeFormattingRules(options.formatting ?? []);
    for (const rule of formatting) assertFormattingColumn(rule, columns);
    super(options, { columns });
    this.virtualColumns = options.virtualColumns !== false;
    this._windowRenderer = new GridWindowRenderer(this);
    this.rowClass = options.rowClass ?? null;
    this.multiSelect = options.multiSelect === true;
    this.rowRangeSelection = options.rowRangeSelection === true;
    this.rowReorderEnabled = options.rowReorder === true;
    this._rowReorderController = new GridRowReorderController(this);
    const transfer = options.rowTransfer ?? {};
    if (transfer.mode != null && !["move","copy"].includes(transfer.mode)) throw new TypeError("Grid row transfer mode must be move or copy.");
    this._rowTransferOptions = {drag:transfer.drag===true,accept:transfer.accept===true,mode:transfer.mode ?? "move"};
    this._rowTransferController = new GridRowTransferController(this);
    this.rangeSelectionEnabled = !this.rowRangeSelection && options.rangeSelection !== false;
    this.clipboardEnabled = options.clipboard !== false;
    this.filterable = options.filterable === true;
    this.filterValueLimit = normalizeFilterValueLimit(options.filterValueLimit);
    this.statusBarOptions = normalizeStatusBarOptions(options.statusBar);
    this.columnMenuEnabled = options.columnMenu !== false;
    this.columnReorderEnabled = options.columnReorder !== false;
    this.formatting = formatting;
    this.rowDetail = typeof options.rowDetail === "function" ? options.rowDetail : null;
    this.dataProvider = options.dataProvider ?? null;
    this.remoteTotalCount = null;
    this._remoteController = null;
    this._expandedDetails = new Set(options.expandedDetails ?? []);
    this.searchPanelVisible = options.searchPanel === true;
    this.sortModel = normalizeSortModel(options.sortModel ?? options.sortState ?? null);
    this.sortState = this.sortModel[0] ?? null;
    this._ownsData = !options.data && !options.view?.data;
    this._ownsView = !options.view;
    this._ownsSelection = !options.selection;
    this._ownsRanges = !options.ranges;
    this._ownsFilters = !options.filters;
    this._ownsSearch = !options.searchModel;
    this._ownsGroups = !options.groupModel;
    this._searchPanel = null;
    this._searchInput = null;
    this._searchMode = null;
    this._searchCount = null;
    this._footer = null;
    this._statusBar = null;
    this._statusPosition = null;
    this._statusFiltered = null;
    this._statusTotal = null;
    this._statusPagination = null;
    this._statusFirstPage = null;
    this._statusPreviousPage = null;
    this._statusPageInput = null;
    this._statusPageCount = null;
    this._statusNextPage = null;
    this._statusLastPage = null;
    this._statusPageSize = null;
    this._statusPageSizeSignature = "";
    this._editing = null;
    this._committingEdit = false;
    this._filterPopup = null;
    this._rangeDrag = null;
    this._activeSearchMatch = -1;

    this.data =
      options.data ??
      options.view?.data ??
      new DataStore({
        idField: options.idField ?? "id",
        getId: options.getId
      });

    assertDataStore(this.data);

    this.view = options.view ?? new DataView({ data: this.data });
    assertDataView(this.view);

    if (this.view.data && this.view.data !== this.data) {
      throw new Error("Grid view must project the same DataStore used by Grid data.");
    }

    this.filters = options.filters ?? new GridFilterModel();
    assertGridFilterModel(this.filters);
    this.search = options.searchModel ?? new GridSearchModel(options.search ?? {});
    assertGridSearchModel(this.search);
    this.groups = options.groupModel ?? new GridGroupModel({ rules: options.groups ?? [] });
    this._globalFilter = options.filter ?? this.view.getFilter() ?? null;
    this._applyInitialSortState();
    this._applyFilterProjection({
      silent: true,
      origin: "system",
      reason: "initial-filter"
    });
    this._applyInitialPagination();

    this.selection =
      options.selection ??
      new SelectionModel({
        multiple: this.multiSelect
      });

    assertSelectionModel(this.selection);

    this.ranges = options.ranges ?? new RangeSelectionModel({ multiple: true });
    assertRangeSelectionModel(this.ranges);

    this.disposables.add(
      this.groups.events.on("invalidate", () => this._windowRenderer.request())
    );
    this.disposables.add(
      this.groups.events.on("change", event => {
        this._windowRenderer.request();
        this.events.emit("groupChange", {
          source: this, groupModel: this.groups, operation: event.operation,
          state: event.state, origin: event.origin, userAction: event.userAction
        });
      })
    );

    this.disposables.add(
      this.search.events.on("invalidate", event => {
        this._activeSearchMatch = -1;
        if (event.oldState.mode === "filter" || event.state.mode === "filter") {
          this._applyFilterProjection({
            silent: event.silent === true,
            origin: event.origin,
            userAction: event.userAction,
            reason: "search"
          });
          // Clearing highlights can change DOM even when the projection stays unfiltered.
          this._windowRenderer.request();
        } else {
          this._renderRows();
        }
        this._renderSearchPanel();
      })
    );
    this.disposables.add(
      this.search.events.on("change", event => {
        this.events.emit("searchChange", {
          source: this,
          oldState: event.oldState,
          state: event.state,
          origin: event.origin,
          userAction: event.userAction
        });
      })
    );

    const technicalRanges = this.ranges instanceof RangeSelectionModel;
    this.disposables.add(this.ranges.events.on("invalidate", () => {
      if (!this.destroyed && !this._destroyingGrid && !this.ranges.destroyed) this._syncSelectionState();
    }));
    this.disposables.add(
      this.ranges.events.on("change", event => {
        if (this.destroyed || this.ranges.destroyed) return;
        if (!technicalRanges) this._syncSelectionState();
        if (this.destroyed) return;
        const currentRanges = this.ranges.get();
        if (event.ranges.length !== currentRanges.length || event.ranges.some((range, index) => {
          const current = currentRanges[index];
          return !Object.is(range.anchor.rowId, current.anchor.rowId) || !Object.is(range.anchor.columnId, current.anchor.columnId) ||
            !Object.is(range.focus.rowId, current.focus.rowId) || !Object.is(range.focus.columnId, current.focus.columnId);
        })) return;
        this.events.emit("rangeSelectionChange", {
          source: this,
          ranges: event.ranges,
          oldRanges: event.oldRanges,
          origin: event.origin,
          userAction: event.userAction
        });
      })
    );

    this.disposables.add(
      this.filters.events.on("beforeChange", event => {
        const gridEvent = {
          source: this,
          filterModel: this.filters,
          operation: event.operation,
          columnId: event.columnId,
          oldFilter: event.oldFilter,
          filter: event.filter,
          oldFilters: event.oldFilters,
          filters: event.filters,
          origin: event.origin,
          reason: event.reason,
          userAction: event.userAction === true,
          cancel: false
        };

        this.events.emit("beforeFilterChange", gridEvent);

        if (gridEvent.cancel) {
          event.cancel = true;
        }
      })
    );

    this.disposables.add(
      this.filters.events.on("invalidate", event => {
        this._closeFilterPopup();
        this._applyFilterProjection({
          silent: event.silent === true,
          origin: event.origin,
          userAction: event.userAction === true,
          reason: event.operation ?? "column-filter"
        });
        this._renderHeader();
      })
    );

    this.disposables.add(
      this.filters.events.on("change", event => {
        this.events.emit("filterChange", {
          source: this,
          filterModel: this.filters,
          operation: event.operation,
          columnId: event.columnId,
          oldFilter: event.oldFilter,
          filter: event.filter,
          oldFilters: event.oldFilters,
          filters: event.filters,
          activeColumns: event.activeColumns,
          origin: event.origin,
          reason: event.reason,
          userAction: event.userAction === true
        });
      })
    );

    this.disposables.add(
      this.data.events.on("change", event => {
        if (event.newId != null && Object.is(this._activeId, event.id)) {
          this._activeId = event.newId;
        }

        this._reconcileSelection();
        this.events.emit("dataChange", {
          source: this,
          dataEvent: event,
          origin: event.origin,
          userAction: event.userAction
        });
      })
    );

    this.disposables.add(
      this.view.events.on("invalidate", event => {
        if (this._editing && !this._committingEdit && !this._preservesEditedRow(event)) {
          this._discardActiveEdit({
            silent: event.silent === true,
            origin: event.origin ?? "system",
            reason: event.reason ?? "view-change",
            userAction: event.userAction === true
          });
        }

        if (pageProjectionChanged(event.oldPageState, event.pageState)) {
          this._virtualRenderer.resetScroll();
        }

        this._reconcileActiveItem();
        this._reconcileSelection();
        this._windowRenderer.request();
      })
    );

    this.disposables.add(
      this.view.events.on("change", event => {
        this.events.emit("viewChange", {
          source: this,
          viewEvent: event,
          origin: event.origin,
          reason: event.reason,
          userAction: event.userAction
        });

        if (!sameGridPageState(event.oldPageState, event.pageState)) {
          this.events.emit("pageChange", {
            source: this,
            oldPageState: event.oldPageState,
            pageState: event.pageState,
            origin: event.origin,
            reason: event.reason,
            userAction: event.userAction === true
          });
        }
      })
    );

    bindGridSelection(this);

    this.disposables.add(bindViewSort(this.view, sort => {
      if (sort === this._ownedViewSort || !this.sortModel.length) return;
      this.sortModel = []; this.sortState = null;
      this._renderHeader();
    }));
    this._filterBinding = bindViewFilter(this.view, this._globalFilter, filter => {
      this._globalFilter = filter;
      return this._createFilterProjection(filter);
    }, () => this._windowRenderer.request());
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
    root.className = ["dui-control", "dui-grid", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.classList.toggle("dui-grid--virtual", this.virtualRows);
    root.classList.toggle("dui-grid--indicator-gutter", this.indicatorGutterEnabled);
    root.dataset.duiControlId = this.id;
    root.dataset.duiFocusTarget = "true";
    root.tabIndex = this.disabled ? -1 : 0;
    root.setAttribute("role", "grid");
    root.setAttribute("aria-colcount", String(this._visibleColumns().length));
    root.setAttribute("aria-multiselectable", this.multiSelect ? "true" : "false");
    root.classList.toggle("dui-grid--loading", this._remoteController != null);
    if (this._remoteController) root.setAttribute("aria-busy", "true");

    if (this.rowHeight != null) {
      root.style.setProperty("--dui-grid-row-height", normalizeCssSize(this.rowHeight));
    }

    const searchPanel = document.createElement("div");
    searchPanel.className = "dui-grid__search-panel";
    searchPanel.hidden = !this.searchPanelVisible;
    searchPanel.setAttribute("role", "search");
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "dui-grid__search-input";
    searchInput.placeholder = "Find";
    searchInput.setAttribute("aria-label", "Find in grid");
    const searchMode = document.createElement("select");
    searchMode.className = "dui-grid__search-mode";
    searchMode.setAttribute("aria-label", "Search mode");
    appendSelectOption(searchMode, "highlight", "Highlight");
    appendSelectOption(searchMode, "filter", "Filter");
    const searchPrevious = createPaginationButton("chevron-left", "Previous match");
    const searchNext = createPaginationButton("chevron-right", "Next match");
    const searchCount = document.createElement("span");
    searchCount.className = "dui-grid__search-count";
    const searchClose = createPaginationButton("window.close", "Close search");
    searchPanel.append(searchInput, searchMode, searchPrevious, searchNext, searchCount, searchClose);

    const header = document.createElement("div");
    header.className = "dui-grid__header";
    header.setAttribute("role", "row");
    header.setAttribute("aria-rowindex", "1");

    const body = document.createElement("div");
    body.className = "dui-grid__body";
    body.tabIndex = -1;
    body.setAttribute("role", "rowgroup");

    const footer = document.createElement("div");
    footer.className = "dui-grid__footer";
    footer.setAttribute("role", "row");

    const statusBar = document.createElement("div");
    statusBar.className = "dui-grid__status-bar";
    statusBar.setAttribute("role", "status");
    statusBar.setAttribute("aria-live", "polite");

    const statusPosition = document.createElement("span");
    statusPosition.className = "dui-grid__status-position";
    const statusFiltered = document.createElement("span");
    statusFiltered.className = "dui-grid__status-filtered";
    const statusSpacer = document.createElement("span");
    statusSpacer.className = "dui-grid__status-spacer";
    const statusTotal = document.createElement("span");
    statusTotal.className = "dui-grid__status-total";

    const statusPagination = document.createElement("div");
    statusPagination.className = "dui-grid__pagination";
    statusPagination.setAttribute("aria-label", "Pagination");
    const statusFirstPage = createPaginationButton("page-first", "First page");
    const statusPreviousPage = createPaginationButton("chevron-left", "Previous page");
    const statusPageInput = document.createElement("input");
    statusPageInput.className = "dui-grid__page-input";
    statusPageInput.type = "number";
    statusPageInput.min = "1";
    statusPageInput.step = "1";
    statusPageInput.setAttribute("aria-label", "Page number");
    const statusPageCount = document.createElement("span");
    statusPageCount.className = "dui-grid__page-count";
    const statusNextPage = createPaginationButton("chevron-right", "Next page");
    const statusLastPage = createPaginationButton("page-last", "Last page");
    const statusPageSize = document.createElement("select");
    statusPageSize.className = "dui-grid__page-size";
    statusPageSize.setAttribute("aria-label", "Rows per page");
    statusPagination.append(
      statusFirstPage,
      statusPreviousPage,
      statusPageInput,
      statusPageCount,
      statusNextPage,
      statusLastPage,
      statusPageSize
    );

    statusBar.append(statusPosition, statusFiltered, statusSpacer, statusTotal, statusPagination);

    const loading = document.createElement("div");
    loading.className = "dui-grid__loading";
    loading.setAttribute("role", "status");
    loading.hidden = this._remoteController == null;
    const spinner = document.createElement("span");
    spinner.className = "dui-grid__spinner";
    spinner.setAttribute("aria-hidden", "true");
    loading.append(spinner, document.createTextNode("Loading…"));
    root.append(searchPanel, header, body, footer, statusBar, loading);
    this._loadingIndicator = loading;
    this._searchPanel = searchPanel;
    this._searchInput = searchInput;
    this._searchMode = searchMode;
    this._searchCount = searchCount;
    this._header = header;
    this._body = body;
    this._footer = footer;
    this._statusBar = statusBar;
    this._statusPosition = statusPosition;
    this._statusFiltered = statusFiltered;
    this._statusTotal = statusTotal;
    this._statusPagination = statusPagination;
    this._statusFirstPage = statusFirstPage;
    this._statusPreviousPage = statusPreviousPage;
    this._statusPageInput = statusPageInput;
    this._statusPageCount = statusPageCount;
    this._statusNextPage = statusNextPage;
    this._statusLastPage = statusLastPage;
    this._statusPageSize = statusPageSize;

    this.disposables.addEventListener(searchInput, "input", () => {
      this.search.set(searchInput.value, { origin: "user", userAction: true });
    });
    this.disposables.addEventListener(searchInput, "keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.shiftKey ? this.previousSearchMatch() : this.nextSearchMatch();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.hideSearchPanel({ origin: "user", userAction: true });
      }
    });
    this.disposables.addEventListener(searchMode, "change", () => {
      this.search.setMode(searchMode.value, { origin: "user", userAction: true });
    });
    this.disposables.addEventListener(searchPrevious, "click", () => this.previousSearchMatch());
    this.disposables.addEventListener(searchNext, "click", () => this.nextSearchMatch());
    this.disposables.addEventListener(searchClose, "click", () => {
      this.hideSearchPanel({ origin: "user", userAction: true });
    });

    this.disposables.addEventListener(statusFirstPage, "click", () => {
      this.setPage(1, { origin: "user", userAction: true });
    });
    this.disposables.addEventListener(statusPreviousPage, "click", () => {
      this.setPage(this.getPageState().page - 1, { origin: "user", userAction: true });
    });
    this.disposables.addEventListener(statusNextPage, "click", () => {
      this.setPage(this.getPageState().page + 1, { origin: "user", userAction: true });
    });
    this.disposables.addEventListener(statusLastPage, "click", () => {
      this.setPage(this.getPageState().pageCount, { origin: "user", userAction: true });
    });
    this.disposables.addEventListener(statusPageInput, "change", () => {
      this.setPage(Number(statusPageInput.value), { origin: "user", userAction: true });
    });
    this.disposables.addEventListener(statusPageInput, "keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.setPage(Number(statusPageInput.value), { origin: "user", userAction: true });
      }
    });
    this.disposables.addEventListener(statusPageSize, "change", () => {
      this.setPageSize(Number(statusPageSize.value), { origin: "user", userAction: true });
    });

    this.disposables.addEventListener(root, "click", event => {
      this._handleClick(event, root);
    });

    this.disposables.addEventListener(root, "dblclick", event => {
      this._handleDoubleClick(event, root);
    });

    this.disposables.addEventListener(root, "keydown", event => {
      this._handleKeyDown(event);
    });
    this.disposables.addEventListener(root, "copy", event => this._handleClipboardCopy(event, false));
    this.disposables.addEventListener(root, "cut", event => this._handleClipboardCopy(event, true));
    this.disposables.addEventListener(root, "paste", event => this._handleClipboardPaste(event));

    this.disposables.addEventListener(body, "pointerdown", event => {
      this._handleRangePointerDown(event);
    });
    this._rowReorderController.attach(body);
    this._rowTransferController.attach(body);
    this.disposables.addEventListener(body, "pointerover", event => {
      this._handleRangePointerOver(event);
    });
    this.disposables.addEventListener(document, "pointerup", () => {
      this._rangeDrag = null;
    });

    this.disposables.addEventListener(header, "contextmenu", event => {
      const cell = event.target.closest?.("[data-dui-grid-column-id]");
      const column = cell ? this.getColumn(cell.dataset.duiGridColumnId) : null;

      if (column && this._columnMenu) {
        event.preventDefault();
        this._openColumnMenu(column, event.clientX, event.clientY);
      }
    });

    this.disposables.addEventListener(body, "scroll", () => {
      header.scrollLeft = body.scrollLeft;
      footer.scrollLeft = body.scrollLeft;

      if (this.virtualRows || this.virtualColumns) {
        if (this._editing && (this._editing.scrollTop !== body.scrollTop || this._editing.scrollLeft !== body.scrollLeft)) {
          this._discardActiveEdit({
            origin: "user",
            reason: "scroll",
            userAction: true
          });
          this._windowRenderer.request();
        }

        this._windowRenderer.request({ scrollOnly: true });
      }
    });

    this._renderHeader();
    // mount() renders the body after attachment, when column widths and the
    // viewport are measurable. Rendering here builds the fallback window first
    // and forces layout of that temporary DOM in BaseControl.mount().
    this._renderFooter(root);
    this._renderStatusBar(root);
    this._renderSearchPanel();
    this._mountColumnMenu();
    return root;
  }

  refresh() {
    if (this._windowRenderer.painting) return this;
    super.refresh();
    this._windowRenderer.invalidateDetails();
    this._renderHeader();
    this._renderRows();
    return this;
  }

  enable() {
    super.enable();
    this._rowTransferController?.sync();

    if (this.element) {
      this.element.tabIndex = 0;
    }

    return this;
  }

  disable() {
    super.disable();
    this._rowTransferController?.finish();
    this._rowTransferController?.sync();
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
      this._rowTransferController.destroy();
      this._rowReorderController.destroy();
      this._windowRenderer.destroy();
      this._remoteController?.abort();
      this._remoteController = null;
      const ownedData = this._ownsData ? this.data : null;
      const ownedView = this._ownsView ? this.view : null;
      const ownedSelection = this._ownsSelection ? this.selection : null;
      const ownedRanges = this._ownsRanges ? this.ranges : null;
      const ownedFilters = this._ownsFilters ? this.filters : null;
      const ownedSearch = this._ownsSearch ? this.search : null;
      const ownedGroups = this._ownsGroups ? this.groups : null;

      this._closeFilterPopup();
      this._columnMenu?.destroy();
      this._columnMenu = null;
      releaseGridEditor(this);
      if (this.destroyed) return;
      this.disposables.dispose();
      if (!this._ownsView && !this.view.destroyed && this._ownedViewSort && this.view.getSort() === this._ownedViewSort) {
        this.view.setSort(this._detachedViewSort ?? null, {
          silent: true, keepPage: true, origin: "system", reason: "sort-owner-destroy"
        });
      }
      super.destroy();
      // View subscriptions are gone before removing the table's filter layer.
      this._filterBinding?.dispose({ refresh: !this._ownsView });
      this._filterBinding = null;
      this._header = null;
      this._searchPanel = null;
      this._searchInput = null;
      this._searchMode = null;
      this._searchCount = null;
      this._body = null;
      this._loadingIndicator = null;
      this._footer = null;
      this._statusBar = null;
      this._statusPosition = null;
      this._statusFiltered = null;
      this._statusTotal = null;
      this._statusPagination = null;
      this._statusFirstPage = null;
      this._statusPreviousPage = null;
      this._statusPageInput = null;
      this._statusPageCount = null;
      this._statusNextPage = null;
      this._statusLastPage = null;
      this._statusPageSize = null;
      this._statusPageSizeSignature = "";
      this._rangeDrag = null;
      this._rowKeysById.clear();
      this._idsByRowKey.clear();
      this.columnModel.destroy();

      if (ownedView && !ownedView.destroyed) {
        ownedView.destroy();
      }

      if (ownedData && !ownedData.destroyed) {
        ownedData.destroy();
      }

      if (ownedSelection && !ownedSelection.destroyed) {
        ownedSelection.destroy();
      }

      if (ownedRanges && !ownedRanges.destroyed) {
        ownedRanges.destroy();
      }

      if (ownedFilters && !ownedFilters.destroyed) {
        ownedFilters.destroy();
      }
      if (ownedSearch && !ownedSearch.destroyed) {
        ownedSearch.destroy();
      }
      if (ownedGroups && !ownedGroups.destroyed) ownedGroups.destroy();
    } finally { this._destroyingGrid = false; }
  }

  setColumns(columns) {
    this._assertMutable("setColumns");
    this._closeFilterPopup();
    const nextColumns = normalizeColumns(columns);
    const revision = this._schemaRevision = (this._schemaRevision ?? 0) + 1;
    const current = () => !this.destroyed && this._schemaRevision === revision;
    this.columns = nextColumns;
    this._withDeferredColumnRender(() => this.columnModel.replace(this.columns, { silent: true }));
    if (!current()) return this;
    this._activeColumnId = this.getColumn(this._activeColumnId)?.id ?? this.columns[0]?.id ?? null;
    this.cancelEdit({
      silent: true,
      origin: "system"
    });

    if (!current()) return this;
    if (this.sortModel.length) {
      this.setSortModel(this.sortModel.filter(rule => isSortableColumn(this.getColumn(rule.columnId))), {
        silent: true, origin: "system", reason: "columns-change"
      });
      if (!current()) return this;
    }

    for (const columnId of this.filters.activeColumns()) {
      if (!this.getColumn(columnId)) {
        this.filters.clear(columnId, {
          silent: true,
          origin: "system",
          reason: "columns-change"
        });
        if (!current()) return this;
      }
    }

    this._renderHeader();
    if (!current()) return this;
    this._renderRows();
    if (!current()) return this;
    this._renderFooter();
    return this;
  }

  getColumn(id) {
    return this.columnModel.get(id);
  }

  getLayoutState() {
    this._assertMutable("getLayoutState");
    return {
      version: 1,
      columns: this.columnModel.getState(),
      sort: this.getSortModel(),
      summaries: this.columns.flatMap(column => column.summary
        ? [{ columnId: column.id, summary: { ...column.summary } }]
        : []),
      pageSize: this.getPageState().pageSize,
      search: { ...this.search.getState(), visible: this.searchPanelVisible },
      groups: this.groups.getState(),
      expandedDetails: [...this._expandedDetails]
    };
  }

  restoreLayoutState(state, options = {}) {
    this._assertMutable("restoreLayoutState");

    if (!state || typeof state !== "object" || !Array.isArray(state.columns)) {
      throw new TypeError("Grid layout state requires a columns array.");
    }

    this._withDeferredColumnRender(() => this.columnModel.restoreState(state.columns, { ...options, silent: true }));
    this.columns = this.columnModel.all();

    if (Array.isArray(state.sort)) {
      this.setSortModel(state.sort, { ...options, silent: true });
    }

    if (Array.isArray(state.summaries)) {
      for (const entry of state.summaries) {
        if (this.getColumn(entry?.columnId)) {
          this.setColumnSummary(entry.columnId, entry.summary, { ...options, silent: true });
        }
      }
    }
    if (state.search) {
      this.searchPanelVisible = state.search.visible === true;
      const searchChanged = this.search.restoreState(state.search, { ...options, silent: true });
      if (!searchChanged) this._applyFilterProjection({ ...options, silent: true, reason: "layout-search" });
    }
    if (state.groups) this.groups.restoreState(state.groups, { ...options, silent:true });
    this._expandedDetails = new Set(state.expandedDetails ?? []);

    if (state.pageSize != null && typeof this.view.setPageSize === "function") {
      this.view.setPageSize(state.pageSize, { ...options, silent: true });
    }

    this._activeColumnId = this._visibleColumns()[0]?.id ?? null;
    this._renderHeader();
    this._renderRows();
    this._renderSearchPanel();

    if (!options.silent) {
      this.events.emit("layoutChange", {
        source: this,
        operation: "restore",
        layoutState: this.getLayoutState(),
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  moveColumn(columnId, targetIndex, options = {}) {
    return this.columnModel.move(columnId, targetIndex, options);
  }

  setColumnHidden(columnId, hidden, options = {}) {
    return this.columnModel.setHidden(columnId, hidden, options);
  }

  showColumn(columnId, options = {}) {
    return this.setColumnHidden(columnId, false, options);
  }

  hideColumn(columnId, options = {}) {
    return this.setColumnHidden(columnId, true, options);
  }

  freezeColumn(columnId, side = "left", options = {}) {
    return this.columnModel.setFrozen(columnId, side, options);
  }

  unfreezeColumn(columnId, options = {}) {
    return this.columnModel.setFrozen(columnId, null, options);
  }

  autoSizeColumn(columnId, options = {}) {
    this._assertMutable("autoSizeColumn");
    const column = this.getColumn(columnId);

    if (!column || column.hidden === true) {
      return false;
    }

    const selector = `[data-dui-grid-column-id="${cssEscape(column.id)}"]`;
    const cells = [
      this._header?.querySelector(selector),
      ...Array.from(this._body?.querySelectorAll(selector) ?? []),
      this._footer?.querySelector(selector)
    ].filter(Boolean);
    const measured = cells.reduce(
      (width, cell) => Math.max(width, gridIntrinsicWidth(cell)),
      Number(column.minWidth) || 48
    );
    const width = clampColumnWidth(measured, column);
    const revision = this._columnStateRevision ?? 0;
    const current = () => !this.destroyed && !this._destroyingGrid &&
      (this._columnStateRevision ?? 0) === revision + 1 && this.getColumn(columnId) === column;
    const changed = this._withDeferredColumnRender(() => this.columnModel.setWidth(column.id, width, {
      ...options,
      silent: true
    }));

    if (!changed) {
      return false;
    }

    if (!current()) return true;
    this._applyColumnTemplate();
    if (!current()) return true;

    if (!options.silent) {
      this.events.emit("columnResize", {
        source: this,
        column,
        columnId: column.id,
        width,
        reason: "auto-size",
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
      if (!current()) return true;
      this.events.emit("layoutChange", {
        source: this,
        operation: "width",
        layoutState: this.getLayoutState(),
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  autoSizeColumns(options = {}) { return super.autoSizeColumns(options); }

  addFormattingRule(rule, options = {}) {
    this._assertMutable("addFormattingRule");
    const normalized = normalizeFormattingRule(rule, this.formatting.length);
    assertFormattingColumn(normalized, this.columns);
    this.formatting.push(normalized);
    this._renderRows();
    if (!options.silent) this.events.emit("formattingChange", {
      source: this, operation: "add", rule: { ...normalized },
      origin: options.origin ?? "api", userAction: options.userAction === true
    });
    return normalized.id;
  }

  removeFormattingRule(ruleId, options = {}) {
    const index = this.formatting.findIndex(rule => rule.id === ruleId);
    if (index < 0) return false;
    const [rule] = this.formatting.splice(index, 1);
    this._renderRows();
    if (!options.silent) this.events.emit("formattingChange", {
      source: this, operation: "remove", rule,
      origin: options.origin ?? "api", userAction: options.userAction === true
    });
    return true;
  }

  setGroups(rules, options = {}) { return this.groups.set(rules, options); }
  clearGroups(options = {}) { return this.groups.clear(options); }
  toggleGroup(path, options = {}) { return this.groups.toggle(path, options); }

  expandDetail(rowId, options = {}) {
    if (!this.rowDetail || this._expandedDetails.has(rowId)) return false;
    this._expandedDetails.add(rowId);
    this._renderRows();
    this.events.emit("detailChange", { source:this, rowId, expanded:true,
      origin:options.origin??"api", userAction:options.userAction===true });
    return true;
  }
  collapseDetail(rowId, options = {}) {
    if (!this._expandedDetails.delete(rowId)) return false;
    this._renderRows();
    this.events.emit("detailChange", { source:this, rowId, expanded:false,
      origin:options.origin??"api", userAction:options.userAction===true });
    return true;
  }
  toggleDetail(rowId, options = {}) {
    return this._expandedDetails.has(rowId)
      ? this.collapseDetail(rowId, options)
      : this.expandDetail(rowId, options);
  }

  exportData(exporter, options = {}) {
    if (!exporter || typeof exporter.export !== "function") {
      throw new TypeError("Grid exporter must implement export().");
    }
    const columns = options.includeHidden ? this.columns : this._visibleColumns();
    const rows = options.scope === "selection"
      ? this.selection.get()
      : options.scope === "page"
        ? this._visibleItems()
        : typeof this.view.projectedAll === "function"
          ? this.view.projectedAll()
          : this._visibleItems();
    const result = exporter.export({
      source:this, grid:this, columns, rows,
      getValue:(item, column) => getCellValue(item, column, rows.indexOf(item)),
      options
    });
    this.events.emit("export", { source:this, exporter, result, options,
      origin:options.origin??"api", userAction:options.userAction===true });
    return result;
  }

  createRemoteRequest(overrides = {}) {
    const page = this.getPageState();
    return {
      page: page.page,
      pageSize: page.pageSize,
      sort: this.getSortModel(),
      filters: Array.from(this.filters.all(), ([columnId, filter]) => ({ columnId, filter })),
      search: this.search.getState(),
      ...overrides
    };
  }

  async reloadRemote(overrides = {}, options = {}) {
    this._assertMutable("reloadRemote");
    if (!this.dataProvider || typeof this.dataProvider.request !== "function") {
      throw new Error("Grid reloadRemote() requires dataProvider.");
    }
    const request = this.createRemoteRequest(overrides);
    this._remoteController?.abort();
    const controller = new AbortController();
    this._remoteController = controller;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.element?.classList.add("dui-grid--loading");
    this.element?.setAttribute("aria-busy", "true");
    if (this._loadingIndicator) this._loadingIndicator.hidden = false;
    this.events.emit("remoteLoadStart", { source:this, request });
    try {
      controller.signal.throwIfAborted();
      const response = await this.dataProvider.request(request, { ...options, signal: controller.signal });
      controller.signal.throwIfAborted();
      this.remoteTotalCount = response.totalCount;
      this.data.parse(response.items, { origin:"import" });
      this.events.emit("remoteLoad", { source:this, request, response });
      return response;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (this._remoteController === controller) {
        this._remoteController = null;
        this.element?.classList.remove("dui-grid--loading");
        this.element?.removeAttribute("aria-busy");
        if (this._loadingIndicator) this._loadingIndicator.hidden = true;
      }
    }
  }

  undo(options = {}) {
    return typeof this.data.undo === "function" ? this.data.undo(options) : false;
  }

  redo(options = {}) {
    return typeof this.data.redo === "function" ? this.data.redo(options) : false;
  }

  getColumnSummary(columnId) {
    this._assertMutable("getColumnSummary");
    const column = this.getColumn(columnId);

    if (!column) {
      throw new Error(`Unknown Grid column: ${String(columnId)}.`);
    }

    return column.summary?.kind ?? null;
  }

  getColumnSummaryConfig(columnId) {
    const column = this.getColumn(columnId);
    if (!column) throw new Error(`Unknown Grid column: ${String(columnId)}.`);
    return column.summary ? { ...column.summary } : null;
  }

  getColumnSummaryValue(columnId) {
    const column = this.getColumn(columnId);
    if (!column) throw new Error(`Unknown Grid column: ${String(columnId)}.`);
    return resolveColumnSummaryValue(column, this._getSummaryRows(column), this);
  }

  setColumnSummary(columnId, summary, options = {}) {
    this._assertMutable("setColumnSummary");
    const column = this.getColumn(columnId);

    if (!column) {
      throw new Error(`Unknown Grid column: ${String(columnId)}.`);
    }

    const nextSummary = normalizeColumnSummary(summary, column);
    const oldSummary = column.summary;

    if (sameColumnSummary(oldSummary, nextSummary)) {
      return false;
    }

    const event = {
      source: this,
      column,
      columnId: column.id,
      oldSummary: oldSummary?.kind ?? null,
      summary: nextSummary?.kind ?? null,
      scope: nextSummary?.scope ?? null,
      origin: options.origin ?? "api",
      userAction: options.userAction === true || options.origin === "user",
      cancel: false
    };

    if (!options.silent) {
      this.events.emit("beforeSummaryChange", event);
    }

    if (event.cancel) {
      return false;
    }

    column.summary = nextSummary;
    this._windowRenderer.request();
    this._renderFooter();
    if (this.destroyed || column.summary !== nextSummary) return true;

    if (!options.silent) {
      const appliedEvent = { ...event };
      delete appliedEvent.cancel;
      this.events.emit("summaryChange", appliedEvent);
    }

    return true;
  }

  getSelectedIds() {
    this._assertMutable("getSelectedIds");
    return this.selection
      .get()
      .filter(item => item && typeof item === "object")
      .map(item => this.view.idOf(item));
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

  get rowTransferMode() { return this._rowTransferOptions.mode; }

  setRowTransferMode(mode) {
    this._assertMutable("setRowTransferMode");
    if (mode !== "move" && mode !== "copy") throw new TypeError("Grid row transfer mode must be move or copy.");
    this._rowTransferController.finish();
    this._rowTransferOptions.mode = mode;
    this._renderRows();
    return this;
  }

  transferRowsTo(target, ids, options = {}) { return transferGridRows(this,target,ids,options); }

  _canTransferRows() {
    return !this.destroyed && !this._destroyingGrid && !this.disabled && !this._editing &&
      !this.data.destroyed && !this.view.destroyed && !this.groups.destroyed && !this.dataProvider && !this.groups.hasAny();
  }

  _canReorderRows() {
    return !this.destroyed && !this._destroyingGrid && !this.disabled && !this._editing &&
      !this.data.destroyed && !this.view.destroyed && !this.groups.destroyed &&
      !this.dataProvider && !this.groups.hasAny() && !this.view.getSort();
  }

  moveRows(ids, targetId, options = {}) {
    this._assertMutable("moveRows");
    if (!Array.isArray(ids)) throw new TypeError("Grid moveRows requires an array of ids.");
    const position = options.position ?? "before";
    if (position !== "before" && position !== "after") throw new TypeError("Grid row position must be before or after.");
    if (this._movingRows || !this._canReorderRows()) return false;
    const mutation = normalizeMutationOptions(options);
    this._movingRows = true;
    let guard;
    try {
      const source = this.data.all();
      const visible = this.view.all();
      const wanted = new Set(ids);
      if (!wanted.size || wanted.has(targetId)) return false;
      const rowIds = source.map((item, index) => this.data.idOf(item, index));
      const moving = source.filter((item, index) => wanted.has(rowIds[index]));
      const target = source[rowIds.findIndex(id => Object.is(id, targetId))];
      if (!target || moving.length !== wanted.size) return false;
      const remaining = source.filter((item, index) => !wanted.has(rowIds[index]));
      const index = remaining.indexOf(target) + (position === "after" ? 1 : 0);
      const next = [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
      const same = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);
      if (same(source, next)) return false;
      const identities = new Map(source.map((item, i) => [item, rowIds[i]]));
      // Index-derived IDs cannot survive a reorder.
      if (next.some((item, i) => !Object.is(this.data.idOf(item, i), identities.get(item)))) return false;
      const current = () => this._canReorderRows() && same(source, this.data.all()) && same(visible, this.view.all());
      if (!current()) return false;
      const event = { source: this, ids: moving.map(item => identities.get(item)), targetId, position,
        origin: mutation.origin, userAction: mutation.userAction, cancel: false };
      const before = { ...event, ids: [...event.ids] };
      if (!mutation.silent) this.events.emit("beforeRowReorder", before);
      if (before.cancel || !current()) return false;
      // Runs after existing DataStore beforeChange listeners; they may alter the
      // projection or destroy a table which borrows its store.
      guard = this.data.events.on("beforeChange", change => {
        if (!current()) change.cancel = true;
      });
      const changed = this.data.parse(next, { ...mutation, reason: options.reason ?? "row-reorder" });
      if (changed && !this.destroyed && !mutation.silent) {
        this.events.emit("rowReorder", { source: this, ids: [...event.ids], targetId, position,
          origin: mutation.origin, userAction: mutation.userAction });
      }
      return changed;
    } finally {
      guard?.dispose();
      this._movingRows = false;
    }
  }

  getCellRanges() {
    this._assertMutable("getCellRanges");
    return this.ranges.get();
  }

  setCellRanges(ranges, options = {}) {
    this._assertMutable("setCellRanges");
    return this.ranges.set(ranges, options);
  }

  clearCellRanges(options = {}) {
    this._assertMutable("clearCellRanges");
    return this.ranges.clear(options);
  }

  getClipboardText() {
    this._assertMutable("getClipboardText");
    const matrix = this._getPrimaryRangeMatrix();
    return matrix.rows.map(row =>
      row.map(cell => escapeTsvValue(getCellValue(cell.item, cell.column, cell.rowIndex))).join("\t")
    ).join("\r\n");
  }

  _canUseClipboard() {
    return !this.destroyed && !this._destroyingGrid && !this.disabled && this.clipboardEnabled &&
      !this._editing && !this._clipboardBusy && !this._immediateEdit;
  }

  _captureClipboardTarget() {
    return { items: this._visibleItems(), columns: this._visibleColumns(), ranges: this.ranges.get() };
  }

  _sameClipboardTarget(target) {
    if (!this._canUseClipboard()) return false;
    const current = this._captureClipboardTarget();
    return current.items.length === target.items.length && current.items.every((item, i) => item === target.items[i]) &&
      current.columns.length === target.columns.length && current.columns.every((column, i) => column === target.columns[i]) &&
      JSON.stringify(current.ranges) === JSON.stringify(target.ranges);
  }

  async copy(options = {}) { return this._copyClipboardRange(options, false); }
  async cut(options = {}) { return this._copyClipboardRange(options, true); }

  async _copyClipboardRange(options, cut) {
    if (!this._canUseClipboard() || !globalThis.navigator?.clipboard?.writeText) return false;
    const mutation = normalizeMutationOptions(options);
    const target = this._captureClipboardTarget();
    const text = this.getClipboardText();
    if (!text || !this._sameClipboardTarget(target)) return false;
    await navigator.clipboard.writeText(text);
    // Copy already happened in the platform; teardown only suppresses UI events.
    if (!this.destroyed && !mutation.silent) this.events.emit(cut ? "clipboardCut" : "clipboardCopy", {
      source: this, text, ranges: target.ranges.map(range => ({ anchor: { ...range.anchor }, focus: { ...range.focus } })),
      origin: mutation.origin, userAction: mutation.userAction
    });
    if (!cut) return true;
    if (!this._sameClipboardTarget(target)) return false;
    return this._clearPrimaryRange(mutation);
  }

  async paste(options = {}) {
    if (!this._canUseClipboard() || !globalThis.navigator?.clipboard?.readText) return false;
    const mutation = normalizeMutationOptions(options);
    const target = this._captureClipboardTarget();
    const text = await navigator.clipboard.readText();
    if (!this._sameClipboardTarget(target)) return false;
    return this.pasteClipboardText(text, mutation);
  }

  pasteClipboardText(text, options = {}) {
    this._assertMutable("pasteClipboardText");
    if (!this._canUseClipboard() || typeof text !== "string" || text.length === 0) return false;
    const primary = this.ranges.primary();
    if (!primary) return false;
    const items = this._visibleItems(), columns = this._visibleColumns();
    const startRow = items.findIndex(item => Object.is(this.view.idOf(item), primary.anchor.rowId));
    const startColumn = columns.findIndex(column => column.id === primary.anchor.columnId);
    if (startRow < 0 || startColumn < 0) return false;
    const values = parseTsv(text);
    const mutation = normalizeMutationOptions({ ...options, reason: options.reason ?? "clipboard-paste" });
    let changed = 0;
    this._clipboardBusy = true;
    try {
      const apply = () => {
        for (let rowOffset = 0; rowOffset < values.length; rowOffset++) {
          if (this.destroyed || this.disabled || this._editing) break;
          const item = items[startRow + rowOffset];
          if (!item) break;
          const id = this.data.idOf(item);
          for (let columnOffset = 0; columnOffset < values[rowOffset].length; columnOffset++) {
            if (this.destroyed || this.disabled || this._editing) return;
            const column = columns[startColumn + columnOffset];
            if (!column) break;
            const currentItem = this.data.get(id);
            if (!currentItem) break;
            if (this._applyClipboardCell(currentItem, column, values[rowOffset][columnOffset], mutation)) changed++;
          }
        }
      };
      if (typeof this.data.batch === "function") this.data.batch(apply, { ...mutation, history: true });
      else apply();
      if (changed > 0 && !this.destroyed && !mutation.silent) this.events.emit("clipboardPaste", {
        source: this, text, changed, origin: mutation.origin, userAction: mutation.userAction
      });
      return changed > 0;
    } finally { this._clipboardBusy = false; }
  }

  setFilter(filter, options = {}) {
    this._assertMutable("setFilter");

    if (filter != null && typeof filter !== "function") {
      throw new TypeError("Grid filter must be a function or null.");
    }

    if (this._globalFilter === filter) {
      return false;
    }

    this._globalFilter = filter;
    return this._applyFilterProjection({
      ...options,
      reason: options.reason ?? "global-filter"
    });
  }

  clearFilter(options = {}) {
    this._assertMutable("clearFilter");
    return this.setFilter(null, {
      ...options,
      reason: options.reason ?? "global-filter-clear"
    });
  }

  getFilter() {
    this._assertMutable("getFilter");
    return this._globalFilter;
  }

  setColumnFilter(columnId, filter, options = {}) {
    this._assertMutable("setColumnFilter");

    if (!this.getColumn(columnId)) {
      throw new Error(`Cannot filter missing Grid column: ${String(columnId)}.`);
    }

    return this.filters.set(columnId, filter, options);
  }

  clearColumnFilter(columnId, options = {}) {
    this._assertMutable("clearColumnFilter");
    return this.filters.clear(columnId, options);
  }

  clearAllFilters(options = {}) {
    this._assertMutable("clearAllFilters");
    const hadGlobalFilter = this._globalFilter != null;
    const hadColumnFilters = this.filters.hasAny();
    const clearSearch = () => !this.destroyed && options.search === true
      ? this.search.clear(options) : false;

    if (!hadGlobalFilter && !hadColumnFilters) {
      return clearSearch();
    }

    const oldGlobalFilter = this._globalFilter;
    this._globalFilter = null;

    if (hadColumnFilters) {
      const changed = this.filters.clearAll(options);
      if (this.destroyed) return changed;

      if (!changed) {
        this._globalFilter = oldGlobalFilter;
      }

      return (changed && clearSearch()) || changed;
    }

    const changed = this._applyFilterProjection({
      ...options,
      reason: options.reason ?? "filter-clear-all"
    });
    return clearSearch() || changed;
  }

  showSearchPanel(options = {}) {
    this._assertMutable("showSearchPanel");
    if (this.searchPanelVisible) {
      this._searchInput?.focus({ preventScroll: true });
      return false;
    }
    this.searchPanelVisible = true;
    this._renderSearchPanel();
    this._searchInput?.focus({ preventScroll: true });
    this.events.emit("searchPanelChange", {
      source: this, visible: true, origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
    return true;
  }

  hideSearchPanel(options = {}) {
    this._assertMutable("hideSearchPanel");
    if (!this.searchPanelVisible) return false;
    if (options.clear !== false && this.search.hasQuery()) {
      this.search.clear({
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }
    this.searchPanelVisible = false;
    this._renderSearchPanel();
    this.element?.focus({ preventScroll: true });
    this.events.emit("searchPanelChange", {
      source: this, visible: false, origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
    return true;
  }

  nextSearchMatch(options = {}) {
    return this._moveSearchMatch(1, options);
  }

  previousSearchMatch(options = {}) {
    return this._moveSearchMatch(-1, options);
  }

  _moveSearchMatch(delta, options = {}) {
    const matches = this._getSearchMatches();
    if (matches.length === 0) return false;
    this._activeSearchMatch = (this._activeSearchMatch + delta + matches.length) % matches.length;
    const match = matches[this._activeSearchMatch];
    const pageState = this.getPageState();
    if (pageState.enabled && typeof this.view.projectedAll === "function") {
      const projectionIndex = this.view.projectedAll().findIndex(item =>
        Object.is(this.view.idOf(item), match.rowId)
      );
      if (projectionIndex >= 0) {
        this.setPage(Math.floor(projectionIndex / pageState.pageSize) + 1, {
          origin: options.origin ?? "user", userAction: options.userAction !== false
        });
      }
    }
    const item = this.view.get(match.rowId) ?? match.item;
    this._setActiveCell(item, match.columnId, {
      origin: options.origin ?? "user", userAction: options.userAction !== false
    });
    this._renderRows();
    this._renderSearchPanel();
    this.events.emit("searchNavigate", {
      source: this, match, index: this._activeSearchMatch,
      count: matches.length, origin: options.origin ?? "user",
      userAction: options.userAction !== false
    });
    return true;
  }

  _applyFilterProjection(options = {}) {
    return this.view.setFilter(this._filterBinding
      ? this._globalFilter : this._createFilterProjection(this._globalFilter), options);
  }

  _createFilterProjection(globalFilter) {
    const hasColumnFilters = this.filters.hasAny();
    let filter = null;

    const searchFilter = this.search?.mode === "filter" && this.search.hasQuery();
    // No table-local conditions: the view can own the global predicate directly.
    // This also avoids retaining the table in a redundant per-row wrapper.
    if (globalFilter && !hasColumnFilters && !searchFilter) return globalFilter;
    if (globalFilter || hasColumnFilters || searchFilter) {
      filter = (item, context) => {
        if (globalFilter && !globalFilter(item, context)) {
          return false;
        }
        assertProjectionCurrent(this.view);

        if (searchFilter && !this._itemMatchesSearch(item, context?.index ?? -1)) {
          return false;
        }

        return this.filters.matches(item, (currentItem, columnId) => {
          assertProjectionCurrent(this.view);
          const column = this.getColumn(columnId);
          const value = column ? getCellValue(currentItem, column, context?.index ?? -1) : undefined;
          assertProjectionCurrent(this.view);
          return value;
        });
      };
    }

    if (filter && !globalFilter && !searchFilter && this.filters.constructor === GridFilterModel) {
      const columns = this.filters.activeColumns().map(id => this.getColumn(id));
      const fields = columns.every(column => column && typeof column.value !== "function")
        ? columns.map(column => column.field ?? column.id) : null;
      trackProjection(filter, () => {
        return fields && columns.every((column, index) => this.getColumn(column.id) === column &&
          typeof column.value !== "function" && (column.field ?? column.id) === fields[index]) ? fields : null;
      });
    }
    return filter;
  }

  sortBy(columnId, direction, options = {}) {
    this._assertMutable("sortBy");

    const column = this.getColumn(columnId);

    if (!column || !isSortableColumn(column)) {
      return false;
    }

    const currentRule = this.sortModel.find(rule => rule.columnId === column.id) ?? null;
    const nextDirection = direction === undefined
      ? getNextSortDirection(currentRule, column.id)
      : normalizeSortDirection(direction);

    if (nextDirection == null) {
      if (options.additive) {
        return this.setSortModel(
          this.sortModel.filter(rule => rule.columnId !== column.id),
          options
        );
      }
      return this.clearSort(options);
    }

    const nextRule = {
      columnId: column.id,
      direction: nextDirection
    };
    const nextModel = options.additive
      ? [...this.sortModel.filter(rule => rule.columnId !== column.id), nextRule]
      : [nextRule];

    return this.setSortModel(nextModel, options);
  }

  setSortModel(sortModel, options = {}) {
    this._assertMutable("setSortModel");
    const nextModel = normalizeSortModel(sortModel);

    for (const rule of nextModel) {
      if (!isSortableColumn(this.getColumn(rule.columnId))) {
        throw new TypeError(`Grid sort column must exist and be sortable: ${String(rule.columnId)}.`);
      }
    }

    const oldSortModel = this.getSortModel();
    this.sortModel = nextModel;
    this.sortState = nextModel[0] ?? null;
    const changed = nextModel.length === 0
      ? this.view.clearSort({ ...options, reason: options.reason ?? "sort-clear" })
      : this.view.setSort(createMultiColumnSort(nextModel, this), {
      ...options,
      reason: options.reason ?? "sort"
    });

    if (this.destroyed) return changed;
    this._renderHeader();
    if (this.view._buildingProjection || this.sortModel !== nextModel) return changed;

    if (!options.silent) {
      this.events.emit("sortChange", {
        source: this,
        column: this.getColumn(nextModel[0]?.columnId) ?? null,
        columnId: nextModel[0]?.columnId ?? null,
        direction: nextModel[0]?.direction ?? null,
        oldSortModel,
        sortModel: this.getSortModel(),
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return changed;
  }

  clearSort(options = {}) {
    this._assertMutable("clearSort");
    const oldSortState = this.sortState;
    const oldSortModel = this.getSortModel();
    this.sortModel = [];
    this.sortState = null;
    const changed = this.view.clearSort({
      ...options,
      reason: options.reason ?? "sort-clear"
    });

    if (this.destroyed) return changed;
    this._renderHeader();
    if (this.view._buildingProjection || this.view.getSort() !== null) return changed;

    if (!options.silent && oldSortState) {
      this.events.emit("sortChange", {
        source: this,
        column: this.getColumn(oldSortState.columnId),
        columnId: oldSortState.columnId,
        direction: null,
        oldSortModel,
        sortModel: [],
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return changed;
  }

  getSortState() {
    this._assertMutable("getSortState");
    return this.sortState ? { ...this.sortState } : null;
  }

  getSortModel() {
    this._assertMutable("getSortModel");
    return this.sortModel.map(rule => ({ ...rule }));
  }

  setStatusBar(statusBar) {
    this._assertMutable("setStatusBar");
    const hadPagination = this.statusBarOptions.pagination != null;
    this.statusBarOptions = normalizeStatusBarOptions(statusBar);

    if (this.statusBarOptions.pagination) {
      this._applyInitialPagination();
    } else if (hadPagination) {
      assertPagingDataView(this.view);
      this.view.clearPaging({
        origin: "api",
        reason: "status-pagination-clear"
      });
    }

    this._renderStatusBar();
    return this;
  }

  getPageState() {
    this._assertMutable("getPageState");
    assertPagingDataView(this.view);
    return this.view.getPageState();
  }

  setPage(page, options = {}) {
    this._assertMutable("setPage");
    assertPagingDataView(this.view);
    return this.view.setPage(page, {
      ...options,
      reason: options.reason ?? "page"
    });
  }

  setPageSize(pageSize, options = {}) {
    this._assertMutable("setPageSize");
    assertPagingDataView(this.view);
    const changed = this.view.setPageSize(pageSize, {
      ...options,
      reason: options.reason ?? "page-size"
    });

    if (changed && this.statusBarOptions.pagination && pageSize != null) {
      this.statusBarOptions.pagination.pageSize = Number(pageSize);
      this.statusBarOptions.pagination.pageSizes = normalizePageSizes(
        this.statusBarOptions.pagination.pageSizes,
        Number(pageSize)
      );
    }

    return changed;
  }

  firstPage(options = {}) {
    return this.setPage(1, options);
  }

  previousPage(options = {}) {
    const state = this.getPageState();
    return this.setPage(Math.max(1, state.page - 1), options);
  }

  nextPage(options = {}) {
    const state = this.getPageState();
    return this.setPage(Math.min(state.pageCount, state.page + 1), options);
  }

  lastPage(options = {}) {
    const state = this.getPageState();
    return this.setPage(state.pageCount, options);
  }

  getStatusBarState() {
    this._assertMutable("getStatusBarState");
    const items = this._visibleItems();
    const activeIndex = this._activeId == null
      ? -1
      : items.findIndex(item => Object.is(this.view.idOf(item), this._activeId));

    const pageState = typeof this.view.getPageState === "function"
      ? this.view.getPageState()
      : createUnpagedState(items.length);

    return {
      rowIndex: activeIndex >= 0 ? activeIndex + 1 : 0,
      rowCount: items.length,
      filteredCount: pageState.filteredCount,
      totalCount: this.remoteTotalCount ?? this.data.all().length,
      filterActive: this._globalFilter != null || this.filters.hasAny() ||
        (this.search.mode === "filter" && this.search.hasQuery()),
      pageState
    };
  }

  _applyInitialSortState() {
    if (this.sortModel.length === 0) {
      return;
    }

    for (const rule of this.sortModel) {
      const column = this.getColumn(rule.columnId);
      if (!column || !isSortableColumn(column)) {
        throw new TypeError(`Grid initial sort column must exist and be sortable: ${String(rule.columnId)}.`);
      }
    }

    this.view.setSort(createMultiColumnSort(this.sortModel, this), {
      silent: true,
      origin: "system",
      reason: "initial-sort"
    });
  }

  _applyInitialPagination() {
    const pagination = this.statusBarOptions.pagination;

    if (!pagination) {
      return;
    }

    assertPagingDataView(this.view);
    this.view.setPageSize(pagination.pageSize, {
      silent: true,
      origin: "system",
      reason: "initial-page-size"
    });
    this.view.setPage(pagination.page, {
      silent: true,
      origin: "system",
      reason: "initial-page"
    });
  }

  startEdit(itemOrId = this._activeId, columnId = this._activeColumnId, options = {}) {
    if (this.destroyed || this._destroyingGrid || !this.mounted || this.disabled || this._startingEdit || itemOrId == null || columnId == null) return false;
    this._startingEdit = true;
    try {
      const activation = gridEditActivation(this);
      const item = typeof itemOrId === "object" ? itemOrId : this.view.get(itemOrId);
      const column = this.getColumn(columnId);
      if (!item || !column || column.hidden === true || !getColumnEditor(column, item) || !activation.current()) return false;
      if (resolveReadOnly(column, item) === true || !activation.current()) return false;
      return this._startCellEdit(item, column, options, activation);
    } finally { this._startingEdit = false; this._rowTransferController?.sync(); }
  }

  _preservesEditedRow(event) {
    // Background replacements may invalidate the view without moving any row.
    // Keep the draft only with evidence that both its record and order survived.
    return (event.reason === "update" || event.reason === "batch") &&
      this.view.get(this._editing.id) === this._editing.item &&
      !pageProjectionChanged(event.oldPageState, event.pageState) &&
      Array.isArray(event.oldIds) && Array.isArray(event.ids) &&
      event.oldIds.length === event.ids.length &&
      event.oldIds.every((id, index) => Object.is(id, event.ids[index]));
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
        try { writeResult = this._writeCellValue(editing.item, editing.id, editing.column, event.newValue, mutation); }
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
      if (!mutation.silent) this.events.emit("editCommit", { ...event, changed, writeResult });
      if (!this.destroyed && !this._editing) {
        this._renderRows();
        this.element?.focus({ preventScroll: true });
      }
      return true;
    } finally {
      this._commitSession = null;
    }
  }

  cancelEdit(options = {}) {
    if (!this._editing) {
      return false;
    }

    const editing = this._editing;
    releaseGridEditor(this, editing);

    if (!this.destroyed && !options.silent) {
      this.events.emit("editCancel", {
        source: this,
        item: editing.item,
        id: editing.id,
        column: editing.column,
        columnId: editing.column.id,
        value: editing.oldValue,
        origin: options.origin ?? "api",
        reason: options.reason,
        userAction: options.userAction === true
      });
    }

    if (!this.destroyed && !this._editing) {
      this._renderRows();
      this.element?.focus({ preventScroll: true });
    }
    return true;
  }

  _discardActiveEdit(options = {}) {
    if (!this._editing) {
      return false;
    }

    const editing = this._editing;
    releaseGridEditor(this, editing);

    if (!this.destroyed && !options.silent) {
      this.events.emit("editCancel", {
        source: this,
        item: editing.item,
        id: editing.id,
        column: editing.column,
        columnId: editing.column.id,
        value: editing.oldValue,
        origin: options.origin ?? "system",
        reason: options.reason ?? "projection-change",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  _emitEditReject(options) {
    const event = {
      source: this,
      item: options.item,
      id: options.id,
      column: options.column,
      columnId: options.columnId ?? options.column?.id ?? null,
      oldValue: options.oldValue,
      newValue: options.newValue,
      reason: options.reason ?? "rejected",
      ...(options.validation !== undefined ? { validation: options.validation } : {}),
      ...(options.error !== undefined ? { error: options.error } : {}),
      writeResult: options.writeResult,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    };

    this.events.emit("editReject", event);
    return event;
  }

  _renderHeader() {
    if (!this._header) {
      return;
    }

    this._clearHeaderData();
    this._applyColumnTemplate();
    this._appendIndicatorHeader(this._header);
    const visibleColumns = this._visibleColumns();
    this.element?.setAttribute("aria-colcount", String(visibleColumns.length));

    for (const [columnIndex, column] of visibleColumns.entries()) {
      const cell = document.createElement("div");
      cell.className = "dui-grid__header-cell";
      cell.dataset.duiGridColumnId = column.id;
      cell.setAttribute("role", "columnheader");
      cell.setAttribute("aria-colindex", String(columnIndex + 1));
      const sortIndex = this.sortModel.findIndex(rule => rule.columnId === column.id);
      const sortRule = sortIndex >= 0 ? this.sortModel[sortIndex] : null;
      cell.setAttribute("aria-sort", getHeaderAriaSort(sortRule, column));
      this._applyFrozenColumnCell(cell, column, visibleColumns, columnIndex);
      this._attachColumnDragHandlers(cell, column);

      const filterable = isFilterableColumn(column, this.filterable);
      const activeFilter = this.filters.get(column.id);

      if (activeFilter) {
        cell.classList.add("dui-grid__header-cell--filtered");
      }

      if (isSortableColumn(column)) {
        cell.classList.add("dui-grid__header-cell--sortable");

        if (sortRule) {
          cell.classList.add(`dui-grid__header-cell--sort-${sortRule.direction}`);
        }

        cell.addEventListener("click", event => {
          if (
            event.target.closest?.(".dui-grid__resize-handle") ||
            event.target.closest?.(".dui-grid__filter-button") ||
            event.target.closest?.(".dui-grid__column-menu-button")
          ) {
            return;
          }

          this.sortBy(column.id, undefined, {
            additive: event.shiftKey,
            origin: "user",
            userAction: true
          });
        });
      }

      const title = document.createElement("span");
      title.className = "dui-grid__header-title";
      title.textContent = column.title ?? column.label ?? column.id;
      cell.appendChild(title);

      if (isSortableColumn(column) && sortRule) {
        const indicator = document.createElement("span");
        indicator.className = "dui-grid__sort-indicator";
        indicator.setAttribute("aria-hidden", "true");
        if (sortRule && this.sortModel.length > 1) {
          indicator.dataset.duiGridSortPriority = String(sortIndex + 1);
        }
        cell.appendChild(indicator);
      }

      if (filterable && !this._columnMenu) {
        const filterButton = document.createElement("button");
        filterButton.type = "button";
        filterButton.className = "dui-grid__filter-button";
        filterButton.dataset.duiGridFilterColumnId = column.id;
        filterButton.title = activeFilter ? "Edit filter" : "Filter";
        filterButton.setAttribute(
          "aria-label",
          `${activeFilter ? "Edit filter for" : "Filter"} ${column.title ?? column.label ?? column.id}`
        );
        filterButton.setAttribute("aria-haspopup", "dialog");
        filterButton.setAttribute("aria-expanded", "false");
        filterButton.setAttribute("aria-pressed", activeFilter ? "true" : "false");

        filterButton.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          this._toggleFilterPopup(column, filterButton);
        });

        cell.appendChild(filterButton);
      }

      if (this._columnMenu) {
        const menuButton = this._createColumnMenuButton(column, { filtered:Boolean(activeFilter) });
        cell.appendChild(menuButton);
      }

      if (column.resizable !== false) {
        const handle = document.createElement("span");
        handle.className = "dui-grid__resize-handle";
        handle.dataset.duiGridResizeColumnId = column.id;
        handle.setAttribute("aria-hidden", "true");

        handle.addEventListener("pointerdown", event => {
          this._columnResizer.start(event, column);
        });
        handle.addEventListener("dblclick", event => {
          event.preventDefault();
          event.stopPropagation();
          this.autoSizeColumn(column.id, {
            origin: "user",
            userAction: true
          });
        });

        cell.appendChild(handle);
      }

      this._header.appendChild(cell);
    }
  }

  _openColumnMenu(column, x, y) {
    return this._showColumnMenu(column, x, y, () => {
    const sortRule = this.sortModel.find(rule => rule.columnId === column.id) ?? null;
    const visibleColumns = this._visibleColumns();
    const filterable = isFilterableColumn(column, this.filterable);
    const activeFilter = this.filters.get(column.id);
    const userOptions = { origin: "user", userAction: true };
    const items = [
      {
        id: "sort-asc",
        text: "Sort ascending",
        checked: sortRule?.direction === "asc",
        enabled: isSortableColumn(column),
        onClick: () => this.sortBy(column.id, "asc", userOptions)
      },
      {
        id: "sort-desc",
        text: "Sort descending",
        checked: sortRule?.direction === "desc",
        enabled: isSortableColumn(column),
        onClick: () => this.sortBy(column.id, "desc", userOptions)
      },
      {
        id: "clear-sort",
        text: "Clear sorting",
        enabled: sortRule != null,
        onClick: () => this._clearColumnSort(column.id, userOptions)
      },
      "-",
      {
        id: "filter-values",
        text: "Filter values...",
        enabled: filterable,
        onClick: () => this._queueColumnFilterPopup(column, "values")
      },
      {
        id: "filter-condition",
        text: "Condition...",
        enabled: filterable,
        onClick: () => this._queueColumnFilterPopup(column, "condition")
      },
      {
        id: "clear-filter",
        text: "Clear filter",
        enabled: Boolean(activeFilter),
        onClick: () => this.clearColumnFilter(column.id, userOptions)
      },
      {
        id: "summary",
        text: "Summary",
        items: [
          {
            id: "summary-none",
            text: "None",
            checked: column.summary == null,
            onClick: () => this.setColumnSummary(column.id, "none", userOptions)
          },
          {
            id: "summary-count",
            text: "Count",
            checked: column.summary?.kind === "count",
            onClick: () => this.setColumnSummary(column.id, "count", userOptions)
          },
          ...(isNumericSummaryColumn(column)
            ? [{
                id: "summary-total",
                text: "Total",
                checked: column.summary?.kind === "total",
                onClick: () => this.setColumnSummary(column.id, "total", userOptions)
              }, {
                id: "summary-min",
                text: "Minimum",
                checked: column.summary?.kind === "min",
                onClick: () => this.setColumnSummary(column.id, "min", userOptions)
              }, {
                id: "summary-max",
                text: "Maximum",
                checked: column.summary?.kind === "max",
                onClick: () => this.setColumnSummary(column.id, "max", userOptions)
              }, {
                id: "summary-average",
                text: "Average",
                checked: column.summary?.kind === "average",
                onClick: () => this.setColumnSummary(column.id, "average", userOptions)
              }]
            : [])
        ]
      },
      {
        id: "summary-scope",
        text: "Summary scope",
        enabled: column.summary != null,
        items: ["page", "filtered", "all", "selection"].map(scope => ({
          id: `summary-scope-${scope}`,
          text: scope[0].toUpperCase() + scope.slice(1),
          checked: (column.summary?.scope ?? "page") === scope,
          onClick: () => this.setColumnSummary(column.id, {
            ...column.summary,
            scope
          }, userOptions)
        }))
      },
      "-",
      {
        id: "best-fit",
        text: "Best fit",
        onClick: () => this.autoSizeColumn(column.id, userOptions)
      },
      "-",
      {
        id: "freeze-left",
        text: "Freeze left",
        checked: column.frozen === "left",
        onClick: () => this.freezeColumn(column.id, "left", userOptions)
      },
      {
        id: "freeze-right",
        text: "Freeze right",
        checked: column.frozen === "right",
        onClick: () => this.freezeColumn(column.id, "right", userOptions)
      },
      {
        id: "unfreeze",
        text: "Unfreeze",
        enabled: column.frozen != null,
        onClick: () => this.unfreezeColumn(column.id, userOptions)
      },
      "-",
      {
        id: "hide-column",
        text: "Hide column",
        enabled: visibleColumns.length > 1,
        onClick: () => this.hideColumn(column.id, userOptions)
      }
    ];

    return items;
    });
  }

  _queueColumnFilterPopup(column, mode) {
    queueMicrotask(() => {
      if (this.destroyed || column.hidden === true) {
        return;
      }

      const trigger = this._header?.querySelector(
        `[data-dui-grid-column-id="${cssEscape(column.id)}"] .dui-grid__column-menu-button`
      );

      if (trigger) {
        this._openFilterPopup(column, trigger, mode);
      }
    });
  }

  _toggleFilterPopup(column, trigger) {
    if (this._filterPopup?.columnId === column.id) {
      this._closeFilterPopup();
      return;
    }

    this._openFilterPopup(column, trigger);
  }

  _openFilterPopup(column, trigger, preferredMode = null) {
    this._closeFilterPopup();

    const { entries, truncated } = collectDistinctFilterValues(
      this.data.all(),
      column,
      this.filterValueLimit
    );
    const currentFilter = this.filters.get(column.id);
    const filterType = resolveColumnFilterType(column);
    const conditionFilterType = resolveColumnConditionType(column, filterType, entries);
    const conditionOperators = getConditionOperators(conditionFilterType);
    let filterMode = preferredMode ?? (
      currentFilter && currentFilter.kind !== "values" && currentFilter.kind !== "boolean"
        ? "condition"
        : "values"
    );
    const selectedKeys = new Set();

    if (currentFilter?.kind === "values" || currentFilter?.kind === "boolean") {
      for (const entry of entries) {
        if (
          (currentFilter.kind === "values" && entry.empty && currentFilter.includeEmpty) ||
          (currentFilter.kind === "values" &&
            currentFilter.values.some(value => sameFilterValue(value, entry.value))) ||
          (currentFilter.kind === "boolean" && entry.value === currentFilter.value)
        ) {
          selectedKeys.add(entry.key);
        }
      }
    } else {
      for (const entry of entries) {
        selectedKeys.add(entry.key);
      }
    }

    const popup = document.createElement("div");
    popup.className = "dui-grid-filter";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", `Filter ${column.title ?? column.label ?? column.id}`);

    const heading = document.createElement("div");
    heading.className = "dui-grid-filter__heading";
    heading.textContent = column.title ?? column.label ?? column.id;

    const modes = document.createElement("div");
    modes.className = "dui-grid-filter__modes";
    modes.setAttribute("role", "tablist");
    modes.setAttribute("aria-label", "Filter mode");
    modes.hidden = conditionOperators.length === 0;
    const valuesModeButton = createFilterModeButton("Values", "values");
    const conditionModeButton = createFilterModeButton("Condition", "condition");
    modes.append(valuesModeButton, conditionModeButton);

    const search = document.createElement("input");
    search.className = "dui-grid-filter__search";
    search.type = "search";
    search.autocomplete = "off";
    search.value = "";
    search.placeholder = "Search";
    search.setAttribute("aria-label", "Search filter values");

    const selectAllLabel = document.createElement("label");
    selectAllLabel.className = "dui-grid-filter__select-all";
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    const selectAllText = document.createElement("span");
    selectAllText.textContent = "Select All";
    selectAllLabel.append(selectAll, selectAllText);

    const list = document.createElement("div");
    list.className = "dui-grid-filter__values";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Filter values");

    const note = document.createElement("div");
    note.className = "dui-grid-filter__note";
    note.hidden = !truncated;
    note.textContent = `Showing first ${this.filterValueLimit} distinct values`;

    const valuesPanel = document.createElement("div");
    valuesPanel.className = "dui-grid-filter__values-panel";
    valuesPanel.setAttribute("role", "tabpanel");
    valuesPanel.append(search, selectAllLabel, list, note);

    const conditionPanel = document.createElement("div");
    conditionPanel.className = "dui-grid-filter__condition";
    conditionPanel.setAttribute("role", "tabpanel");
    const operatorSelect = document.createElement("select");
    operatorSelect.className = "dui-grid-filter__operator";
    operatorSelect.setAttribute("aria-label", "Filter operator");

    for (const operator of conditionOperators) {
      const option = document.createElement("option");
      option.value = operator.id;
      option.textContent = operator.label;
      operatorSelect.appendChild(option);
    }

    const conditionValue = createConditionInput(conditionFilterType, "Filter value");
    const conditionValueTo = createConditionInput(conditionFilterType, "Filter value to");
    const conditionError = document.createElement("div");
    conditionError.className = "dui-grid-filter__condition-error";
    conditionError.setAttribute("role", "alert");
    const operatorField = createFilterField("Match", operatorSelect);
    const conditionValueField = createFilterField("Value", conditionValue);
    const conditionValueToField = createFilterField("And", conditionValueTo);
    conditionPanel.append(operatorField, conditionValueField, conditionValueToField, conditionError);

    if (currentFilter && currentFilter.kind === conditionFilterType) {
      operatorSelect.value = currentFilter.operator;
      conditionValue.value = currentFilter.value ?? "";
      conditionValueTo.value = currentFilter.valueTo ?? "";
    }

    const summarySection = document.createElement("label");
    summarySection.className = "dui-grid-filter__summary";
    const summaryLabel = document.createElement("span");
    summaryLabel.textContent = "Summary";
    const summarySelect = document.createElement("select");
    summarySelect.className = "dui-grid-filter__summary-select";
    summarySelect.setAttribute("aria-label", "Column summary");
    appendSelectOption(summarySelect, "none", "None");
    appendSelectOption(summarySelect, "count", "Count");

    if (isNumericSummaryColumn(column)) {
      appendSelectOption(summarySelect, "total", "Total");
      appendSelectOption(summarySelect, "min", "Minimum");
      appendSelectOption(summarySelect, "max", "Maximum");
      appendSelectOption(summarySelect, "average", "Average");
    }

    if (column.summary?.kind === "custom") {
      appendSelectOption(summarySelect, "custom", "Custom");
    }

    summarySelect.value = column.summary?.kind ?? "none";
    summarySection.append(summaryLabel, summarySelect);

    const actions = document.createElement("div");
    actions.className = "dui-grid-filter__actions";
    const clearButton = createFilterActionButton("Clear", "dui-grid-filter__clear");
    const actionSpacer = document.createElement("span");
    actionSpacer.className = "dui-grid-filter__action-spacer";
    const applyButton = createFilterActionButton("Apply", "dui-grid-filter__apply");
    const cancelButton = createFilterActionButton("Cancel", "dui-grid-filter__cancel");
    clearButton.disabled = !currentFilter;
    actions.append(clearButton, actionSpacer, applyButton, cancelButton);

    popup.append(heading, modes, valuesPanel, conditionPanel, summarySection, actions);
    document.body.appendChild(popup);
    trigger.setAttribute("aria-expanded", "true");

    const getVisibleEntries = () => {
      const query = search.value.trim().toLocaleLowerCase();
      return query
        ? entries.filter(entry => entry.text.toLocaleLowerCase().includes(query))
        : entries;
    };

    const syncSelectAll = () => {
      const visibleEntries = getVisibleEntries();
      const selectedCount = visibleEntries.filter(entry => selectedKeys.has(entry.key)).length;
      selectAll.checked = visibleEntries.length > 0 && selectedCount === visibleEntries.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < visibleEntries.length;
    };

    const renderValues = () => {
      const visibleEntries = getVisibleEntries();
      const fragment = document.createDocumentFragment();

      for (const entry of visibleEntries) {
        const label = document.createElement("label");
        label.className = "dui-grid-filter__value";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedKeys.has(entry.key);
        checkbox.dataset.duiGridFilterValueKey = entry.key;
        const text = document.createElement("span");
        text.textContent = entry.text;
        label.append(checkbox, text);

        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            selectedKeys.add(entry.key);
          } else {
            selectedKeys.delete(entry.key);
          }

          syncSelectAll();
        });

        fragment.appendChild(label);
      }

      if (visibleEntries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "dui-grid-filter__empty";
        empty.textContent = "No values";
        fragment.appendChild(empty);
      }

      list.replaceChildren(fragment);
      syncSelectAll();
    };

    const syncConditionInputs = () => {
      const operator = operatorSelect.value;
      const noValue = operator === "empty" || operator === "notEmpty";
      conditionValueField.hidden = noValue;
      conditionValueToField.hidden = noValue || operator !== "between";
      conditionError.textContent = "";
    };

    const setFilterMode = mode => {
      filterMode = mode === "condition" && conditionOperators.length > 0 ? "condition" : "values";
      const valuesMode = filterMode === "values";
      valuesPanel.hidden = !valuesMode;
      conditionPanel.hidden = valuesMode;
      valuesModeButton.setAttribute("aria-pressed", valuesMode ? "true" : "false");
      conditionModeButton.setAttribute("aria-pressed", valuesMode ? "false" : "true");
      valuesModeButton.setAttribute("aria-selected", valuesMode ? "true" : "false");
      conditionModeButton.setAttribute("aria-selected", valuesMode ? "false" : "true");

      if (valuesMode) {
        search.focus({ preventScroll: true });
      } else if (operatorSelect.value === "empty" || operatorSelect.value === "notEmpty") {
        operatorSelect.focus({ preventScroll: true });
      } else {
        conditionValue.focus({ preventScroll: true });
      }
    };

    search.addEventListener("input", renderValues);
    valuesModeButton.addEventListener("click", () => setFilterMode("values"));
    conditionModeButton.addEventListener("click", () => setFilterMode("condition"));
    operatorSelect.addEventListener("change", syncConditionInputs);
    selectAll.addEventListener("change", () => {
      for (const entry of getVisibleEntries()) {
        if (selectAll.checked) {
          selectedKeys.add(entry.key);
        } else {
          selectedKeys.delete(entry.key);
        }
      }

      renderValues();
    });

    applyButton.addEventListener("click", () => {
      if (filterMode === "condition") {
        try {
          const filter = createConditionFilter(
            conditionFilterType,
            operatorSelect.value,
            conditionValue.value,
            conditionValueTo.value
          );

          if (summarySelect.value !== "custom") {
            this.setColumnSummary(column.id, summarySelect.value, {
              origin: "user",
              userAction: true
            });
          }

          this.setColumnFilter(column.id, filter, {
            origin: "user",
            userAction: true
          });
          this._closeFilterPopup();
        } catch (error) {
          conditionError.textContent = error.message ?? String(error);
        }

        return;
      }

      const allSelected = entries.every(entry => selectedKeys.has(entry.key));
      const values = entries
        .filter(entry => !entry.empty && selectedKeys.has(entry.key))
        .map(entry => entry.value);
      const includeEmpty = entries.some(
        entry => entry.empty && selectedKeys.has(entry.key)
      );

      if (summarySelect.value !== "custom") {
        this.setColumnSummary(column.id, summarySelect.value, {
          origin: "user",
          userAction: true
        });
      }

      this._closeFilterPopup();

      if (allSelected) {
        this.clearColumnFilter(column.id, {
          origin: "user",
          userAction: true
        });
      } else {
        this.setColumnFilter(
          column.id,
          {
            kind: "values",
            values,
            includeEmpty
          },
          {
            origin: "user",
            userAction: true
          }
        );
      }
    });

    cancelButton.addEventListener("click", () => {
      this._closeFilterPopup();
    });

    clearButton.addEventListener("click", () => {
      this._closeFilterPopup();
      this.clearColumnFilter(column.id, {
        origin: "user",
        userAction: true
      });
    });

    const outside = event => {
      if (!popup.contains(event.target) && event.target !== trigger) {
        this._closeFilterPopup();
      }
    };
    const keydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        this._closeFilterPopup();
        trigger.focus({ preventScroll: true });
      }
    };
    const closeOnViewportChange = () => {
      this._closeFilterPopup();
    };

    document.addEventListener("pointerdown", outside, true);
    popup.addEventListener("keydown", keydown);
    window.addEventListener("resize", closeOnViewportChange);
    this._body?.addEventListener("scroll", closeOnViewportChange);

    this._filterPopup = {
      columnId: column.id,
      element: popup,
      trigger,
      dispose: () => {
        document.removeEventListener("pointerdown", outside, true);
        popup.removeEventListener("keydown", keydown);
        window.removeEventListener("resize", closeOnViewportChange);
        this._body?.removeEventListener("scroll", closeOnViewportChange);
        trigger.setAttribute("aria-expanded", "false");
        popup.remove();
      }
    };

    renderValues();
    syncConditionInputs();
    setFilterMode(filterMode);
    positionFilterPopup(popup, trigger);
  }

  _closeFilterPopup() {
    const popup = this._filterPopup;

    if (!popup) {
      return false;
    }

    this._filterPopup = null;
    popup.dispose();
    return true;
  }

  _applyColumnTemplate() {
    super._applyColumnTemplate();
    this._windowRenderer?.invalidateColumns();
    this._windowRenderer?.request();
  }

  _afterResize() {
    this._windowRenderer.invalidateColumns();
    if (this._editing) {
      this._windowRenderer.scrollToColumn(this._editing.column.id);
      this._editing.scrollLeft = this._body.scrollLeft;
      this._editing.scrollTop = this._body.scrollTop;
    }
    this._windowRenderer.request();
    this._syncScrollbarGutter();
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
    this._rowKeysById.clear();
    this._idsByRowKey.clear();
    let layout, range;
    if (scrollWindow) {
      ({ layout, range } = scrollWindow);
    } else {
      const items = this._visibleItems();
      const entries = this.groups.entries(items, (item, columnId, rowIndex) => {
        const column = this.getColumn(columnId);
        const value = column ? getCellValue(item, column, rowIndex) : undefined;
        if (typeof column?.value === "function") this._windowRenderer.assertCurrent();
        return value;
      });
      layout = this._windowRenderer.columns();
      range = this._windowRenderer.prepare(entries);
    }
    const hasFooter = layout.tracks.some(({ column }) => column.summary != null);
    const ariaRowCount = this._windowRenderer.entries.length + 1 + (hasFooter ? 1 : 0);
    this.element?.setAttribute("aria-rowcount", String(ariaRowCount));
    this._footer?.setAttribute("aria-rowindex", String(ariaRowCount));
    const activeMatch = this._activeSearchMatch >= 0 ? this._getSearchMatches()[this._activeSearchMatch] : null;
    let frozenLeft = layout.indicatorWidth, frozenRight = 0;
    for (const track of layout.tracks) {
      if (track.column.frozen === "left") { track.frozenOffset = frozenLeft; frozenLeft += track.width; }
    }
    for (const track of [...layout.tracks].reverse()) {
      if (track.column.frozen === "right") { track.frozenOffset = frozenRight; frozenRight += track.width; }
    }
    this._windowRenderer.draw(range, (record, entry, index, reused) => {
      const row = record.row;
      if (entry.type === "group") {
        if (scrollWindow && reused) return;
        this._createGroupRow(entry, index, row);
        row.style.width = this.indicatorGutterEnabled ? `${Math.max(layout.totalWidth, this._body.clientWidth)}px` : "";
        row.style.height = this.virtualRows ? `${this._getVirtualRowHeight()}px` : "";
        return;
      }
      if (entry.type === "detail") {
        if (scrollWindow && reused) return;
        if (record.detailItem !== entry.item || record.detailIndex !== entry.rowIndex || record.detailRenderer !== this.rowDetail) {
          this._createDetailRow(entry.item, entry.id, entry.rowIndex, row);
          record.detailItem = entry.item;
          record.detailIndex = entry.rowIndex;
          record.detailRenderer = this.rowDetail;
        }
        row.style.width = this.indicatorGutterEnabled ? `${Math.max(layout.totalWidth, this._body.clientWidth)}px` : "";
        const content = row.querySelector(":scope > .dui-grid__detail-content");
        if (content) content.style.width = `${Math.max(0, this._body.clientWidth - layout.indicatorWidth)}px`;
        row.setAttribute("aria-rowindex", String(index + 2));
        return;
      }
      const rowKey = toRowKey(entry.id);
      if (!scrollWindow || !reused) {
        const rowClass = resolveRowClass(this.rowClass, entry.item, entry.rowIndex, this);
        if (typeof this.rowClass === "function") this._windowRenderer.assertCurrent();
        row.className = ["dui-grid__row", this.indicatorGutterEnabled ? "dui-grid__row--indicator-gutter" : "", rowClass, row.classList.contains("dui-selected") ? "dui-selected" : "",
          row.classList.contains("dui-active") ? "dui-active" : ""].filter(Boolean).join(" ");
        row.dataset.duiGridRowId = rowKey;
        row.dataset.duiGridRowIndex = String(entry.rowIndex);
        row.setAttribute("role", "row");
        row.setAttribute("aria-rowindex", String(index + 2));
        row.style.gridTemplateColumns = layout.template;
        row.style.width = layout.totalWidth ? `${layout.totalWidth}px` : "";
        // Measured virtual tracks already define the row width; avoid a second
        // intrinsic sizing pass when entering/leaving cells change its children.
        row.style.minWidth = layout.virtual ? "0" : "";
      }
      this._rowKeysById.set(entry.id, rowKey);
      this._idsByRowKey.set(rowKey, entry.id);
      const indicator = this.indicatorGutterEnabled ? (record.indicator ??= this._createIndicatorCell("row")) : null;
      if (indicator) this._rowTransferController.syncIndicator(indicator);
      const cells = indicator ? [indicator] : [], retained = new Set();
      for (const track of layout.visible) {
        const column = track.column;
        let state = record.cells.get(column.id);
        const existing = Boolean(state);
        if (!state) {
          const cell = document.createElement("div");
          cell.className = "dui-grid__cell";
          cell.dataset.duiGridColumnId = column.id;
          cell.setAttribute("role", "gridcell");
          cell.id = createCellDomId(this.id, rowKey, column.id);
          state = { cell, styles: new Set(), icons: [] };
          record.cells.set(column.id, state);
        }
        retained.add(column.id);
        if (!scrollWindow || !existing) this._updateWindowCell(state, entry, track, activeMatch);
        cells.push(state.cell);
      }
      for (const id of record.cells.keys()) if (!retained.has(id)) record.cells.delete(id);
      reconcileChildren(row, cells);
    }, layout, revision);
    this._header.scrollLeft = this._body.scrollLeft;
    this._footer.scrollLeft = this._body.scrollLeft;
    this._syncScrollbarGutter();
    this._syncSelectionState(this._body);
    if (!scrollWindow) {
      this._renderFooter();
      this._renderStatusBar();
    }
  }

  _updateWindowCell(state, entry, track, activeMatch) {
    const { cell } = state, { column, index } = track;
    cell.setAttribute("aria-colindex", String(index + 1));
    cell.style.gridColumn = String(index + 1 + (this.indicatorGutterEnabled ? 1 : 0));
    cell.style.gridRow = "1";
    if (this._editing?.cell === cell) return;
    const value = getCellValue(entry.item, column, entry.rowIndex);
    if (typeof column.value === "function") this._windowRenderer.assertCurrent();
    const rendered = renderCellValue(value, entry.item, column, entry.rowIndex);
    if (typeof column.render === "function") this._windowRenderer.assertCurrent();
    const classes = ["dui-grid__cell"];
    // Selection is synchronized separately; retain its classes between paints.
    for (const name of ["dui-grid__cell--active", "dui-grid__cell--range-selected"]) if (cell.classList.contains(name)) classes.push(name);
    const styles = { gridColumn: String(index + 1 + (this.indicatorGutterEnabled ? 1 : 0)), gridRow: "1" };
    if (column.frozen) {
      classes.push("dui-grid__cell--frozen", `dui-grid__cell--frozen-${column.frozen}`);
      styles[column.frozen] = `${track.frozenOffset}px`;
    }
    if (column.align) classes.push(`dui-grid__cell--${column.align}`);
    if (this._cellMatchesSearch(value, column)) {
      classes.push("dui-grid__cell--search-match");
      if (activeMatch && Object.is(activeMatch.rowId, entry.id) && activeMatch.columnId === column.id) classes.push("dui-grid__cell--search-current");
    }
    const icons = [];
    for (const rule of this.formatting) {
      if (rule.columnId != null && rule.columnId !== column.id) continue;
      const matches = rule.when(value, { source: this, grid: this, item: entry.item, column, rowIndex: entry.rowIndex });
      this._windowRenderer.assertCurrent();
      if (!matches) continue;
      if (rule.className) classes.push(rule.className);
      if (rule.style) Object.assign(styles, rule.style);
      if (rule.icon) icons.unshift(rule.icon);
    }
    const editable = isEditableColumn(column, entry.item, this);
    if (editable) { classes.push("dui-grid__cell--editable"); cell.dataset.duiGridEditor = "control"; cell.removeAttribute("aria-readonly"); }
    else { delete cell.dataset.duiGridEditor; cell.setAttribute("aria-readonly", "true"); }
    const className = classes.join(" ");
    if (cell.className !== className) cell.className = className;
    for (const key of state.styles) if (!(key in styles)) setWindowCellStyle(cell, key, "");
    for (const [key, next] of Object.entries(styles)) setWindowCellStyle(cell, key, next);
    state.styles = new Set(Object.keys(styles));
    if (rendered instanceof Node) state.content = rendered;
    else {
      const text = rendered == null ? "" : String(rendered);
      if (state.content?.nodeType !== Node.TEXT_NODE) state.content = document.createTextNode(text);
      else if (state.content.nodeValue !== text) state.content.nodeValue = text;
    }
    state.icons = icons.map((name, i) => {
      if (state.icons[i]?.name === name) return state.icons[i];
      const element = document.createElement("span");
      element.className = "dui-grid__format-icon";
      element.append(createIcon(name));
      return { name, element };
    });
    const handle = this.rowReorderEnabled && index === 0
      ? (state.rowHandle ??= this._rowReorderController.handle()) : null;
    if (handle) {
      handle.disabled = !this._canReorderRows();
      cell.classList.add("dui-grid__cell--row-handle");
    }
    reconcileChildren(cell, [...(handle ? [handle] : []), ...state.icons.map(icon => icon.element), state.content]);
  }

  _createGroupRow(entry, rowIndex, row = document.createElement("div")) {
    row.className = `dui-grid__group-row${this.indicatorGutterEnabled ? " dui-grid__group-row--indicator-gutter" : ""}`;
    row.dataset.duiGridGroupPath = entry.path;
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(rowIndex + 2));
    row.setAttribute("aria-expanded", entry.collapsed ? "false" : "true");
    row.style.paddingLeft = "0";
    const indicator = this.indicatorGutterEnabled
      ? row.querySelector(":scope > .dui-grid__indicator") ?? this._createIndicatorCell("row") : null;
    let toggle = row.querySelector(":scope > .dui-grid__group-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "dui-grid__group-toggle";
      toggle.addEventListener("click", () => this.toggleGroup(row.dataset.duiGridGroupPath, { origin:"user", userAction:true }));
    }
    toggle.style.marginLeft = `${6 + entry.level * 16}px`;
    toggle.textContent = entry.collapsed ? ">" : "\u2304";
    toggle.setAttribute("aria-label", `${entry.collapsed ? "Expand" : "Collapse"} ${entry.label}`);
    const label = row.querySelector(":scope > .dui-grid__group-label") ?? document.createElement("span");
    label.className = "dui-grid__group-label";
    const summaries = entry.summaries?.map(summary => {
      const column = this.getColumn(summary.columnId);
      const title = column?.title ?? column?.label ?? summary.columnId;
      return `${title} ${summary.kind}: ${summary.value ?? ""}`;
    }).join("; ");
    label.textContent = `${entry.label} (${entry.count})${summaries ? `; ${summaries}` : ""}`;
    reconcileChildren(row, [...(indicator ? [indicator] : []), toggle, label]);
    return row;
  }

  _createDetailRow(item, id, rowIndex, row = document.createElement("div")) {
    row.replaceChildren();
    row.className = `dui-grid__detail-row${this.indicatorGutterEnabled ? " dui-grid__detail-row--indicator-gutter" : ""}`;
    row.dataset.duiGridDetailId = toRowKey(id);
    row.setAttribute("role", "row");
    const content = this.rowDetail(item, { source:this, grid:this, id, rowIndex });
    this._windowRenderer.assertCurrent();
    const indicator = this._createIndicatorCell("row");
    if (indicator) {
      const wrapper = document.createElement("div");
      wrapper.className = "dui-grid__detail-content";
      if (content instanceof Node) wrapper.appendChild(content);
      else wrapper.textContent = content == null ? "" : String(content);
      row.append(indicator, wrapper);
    } else if (content instanceof Node) row.appendChild(content);
    else row.textContent = content == null ? "" : String(content);
    return row;
  }

  _applyCellFormatting(cell, value, item, column, rowIndex) {
    for (const rule of this.formatting) {
      if (rule.columnId != null && rule.columnId !== column.id) continue;
      if (!rule.when(value, { source: this, grid: this, item, column, rowIndex })) continue;
      if (rule.className) cell.classList.add(...rule.className.split(/\s+/).filter(Boolean));
      if (rule.style) Object.assign(cell.style, rule.style);
      if (rule.icon) {
        const icon = document.createElement("span");
        icon.className = "dui-grid__format-icon";
        icon.append(createIcon(rule.icon));
        cell.prepend(icon);
      }
    }
  }

  _getRenderRange(rowCount) {
    return super._getRenderRange(rowCount, this.virtualRows);
  }

  _getVirtualRowHeight() {
    return super._getVirtualRowHeight();
  }

  _renderFooter(root = this.element ?? this._footer?.parentElement) {
    if (this._paintingFooter) return;
    this._paintingFooter = true;
    try {
      if (this._windowRenderer.painting) return this._renderFooterPass(root);
      return this._windowRenderer.paint(() => this._renderFooterPass(root));
    } finally { this._paintingFooter = false; }
  }

  _renderFooterPass(root) {
    if (!this._footer) {
      return;
    }

    const visibleColumns = this._visibleColumns();
    const hasFooter = visibleColumns.some(column => column.summary != null);
    this._footer.hidden = !hasFooter;
    root?.classList.toggle("dui-grid--has-footer", hasFooter);
    this._footer.replaceChildren();

    if (!hasFooter) {
      this._syncGridTemplateRows();
      return;
    }

    this._footer.style.gridTemplateColumns = this._getGridTemplateColumns();
    const indicator = this._createIndicatorCell("footer");
    if (indicator) this._footer.appendChild(indicator);

    for (const [columnIndex, column] of visibleColumns.entries()) {
      const cell = document.createElement("div");
      cell.className = "dui-grid__footer-cell";
      cell.dataset.duiGridColumnId = column.id;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-colindex", String(columnIndex + 1));
      this._applyFrozenColumnCell(cell, column, visibleColumns, columnIndex);

      const value = this.getColumnSummaryValue(column.id);
      this._windowRenderer.assertCurrent();

      cell.textContent = value == null ? "" : String(value);

      if (column.align) {
        cell.classList.add(`dui-grid__cell--${column.align}`);
      }

      this._footer.appendChild(cell);
    }
    this._syncGridTemplateRows();
  }

  _getSummaryRows(column) {
    switch (column.summary?.scope ?? "page") {
      case "all": return this.data.all();
      case "filtered": return typeof this.view.projectedAll === "function"
        ? this.view.projectedAll()
        : this._visibleItems();
      case "selection": return this.selection.get();
      default: return this._visibleItems();
    }
  }

  _renderStatusBar(root = this.element ?? this._statusBar?.parentElement) {
    if (this._paintingStatus) return;
    this._paintingStatus = true;
    try {
      if (this._windowRenderer.painting) return this._renderStatusBarPass(root);
      return this._windowRenderer.paint(() => this._renderStatusBarPass(root));
    } finally { this._paintingStatus = false; }
  }

  _renderStatusBarPass(root) {
    if (!this._statusBar) {
      return;
    }

    const options = this.statusBarOptions;
    const visible = options.visible === true;
    this._statusBar.hidden = !visible;
    root?.classList.toggle("dui-grid--has-status", visible);

    if (!visible) {
      this._statusBar.removeAttribute("aria-label");
      this._syncGridTemplateRows();
      return;
    }

    const state = this.getStatusBarState();
    const formatNumber = options.formatNumber;
    const format = value => {
      const formatted = formatNumber(value);
      this._windowRenderer.assertCurrent();
      return formatted;
    };

    this._statusPosition.hidden = !options.showRowPosition;
    this._statusPosition.textContent = options.showRowPosition
      ? `Row ${format(state.rowIndex)} / ${format(state.rowCount)}`
      : "";

    const showFiltered = options.showFilteredCount && state.filterActive;
    this._statusFiltered.hidden = !showFiltered;
    this._statusFiltered.textContent = showFiltered
      ? `Filtered ${format(state.filteredCount)}`
      : "";

    this._statusTotal.hidden = !options.showTotalCount;
    this._statusTotal.textContent = options.showTotalCount
      ? `Total ${format(state.totalCount)}`
      : "";

    const pagination = options.pagination;
    const pageState = state.pageState;
    const showPagination = pagination != null && pageState.enabled;
    this._statusPagination.hidden = !showPagination;

    if (showPagination) {
      const pageSizes = normalizePageSizes(pagination.pageSizes, pageState.pageSize);
      const signature = pageSizes.join(",");

      if (signature !== this._statusPageSizeSignature) {
        this._statusPageSize.replaceChildren(
          ...pageSizes.map(size => {
            const option = document.createElement("option");
            option.value = String(size);
            option.textContent = String(size);
            return option;
          })
        );
        this._statusPageSizeSignature = signature;
      }

      this._statusFirstPage.disabled = !pageState.canGoFirst;
      this._statusPreviousPage.disabled = !pageState.canGoPrevious;
      this._statusNextPage.disabled = !pageState.canGoNext;
      this._statusLastPage.disabled = !pageState.canGoLast;
      this._statusPageInput.value = String(pageState.page);
      this._statusPageInput.max = String(pageState.pageCount);
      this._statusPageCount.textContent = `/ ${format(pageState.pageCount)}`;
      this._statusPageSize.value = String(pageState.pageSize);
    }

    this._statusBar.setAttribute(
      "aria-label",
      [
        options.showRowPosition
          ? `Row ${format(state.rowIndex)} of ${format(state.rowCount)}`
          : null,
        showFiltered ? `Filtered ${format(state.filteredCount)}` : null,
        options.showTotalCount ? `Total ${format(state.totalCount)}` : null,
        showPagination ? `Page ${format(pageState.page)} of ${format(pageState.pageCount)}` : null
      ]
        .filter(Boolean)
        .join("; ")
    );
    this._syncGridTemplateRows();
  }

  _syncSelectionState(element = this._body) {
    if (!element) {
      return;
    }

    const selectedIds = new Set(
      this.selection
        .get()
        .filter(item => item && typeof item === "object")
        .map(item => this.view.idOf(item))
    );
    const ranges = this.ranges.get();
    const items = ranges.length ? this._visibleItems() : [];
    // Resolve against this pass's column order; hidden/reordered columns must
    // never reuse indices from an earlier paint. Empty ranges need no lookup.
    const columnIndices = new Map();
    if (ranges.length) {
      this._visibleColumns().forEach((column, index) => {
        if (!columnIndices.has(column.id)) columnIndices.set(column.id, index);
      });
    }
    const rangeBounds = ranges.flatMap(range => {
      const anchorRow = items.findIndex(item => Object.is(this.view.idOf(item), range.anchor.rowId));
      const focusRow = items.findIndex(item => Object.is(this.view.idOf(item), range.focus.rowId));
      const anchorColumn = columnIndices.get(range.anchor.columnId) ?? -1;
      const focusColumn = columnIndices.get(range.focus.columnId) ?? -1;
      if ([anchorRow, focusRow, anchorColumn, focusColumn].some(index => index < 0)) return [];
      return [{
        top: Math.min(anchorRow, focusRow),
        bottom: Math.max(anchorRow, focusRow),
        left: Math.min(anchorColumn, focusColumn),
        right: Math.max(anchorColumn, focusColumn)
      }];
    });

    let activeDescendant = null;

    for (const row of element.querySelectorAll(".dui-grid__row")) {
      const id = this._idsByRowKey.get(row.dataset.duiGridRowId);
      const selected = selectedIds.has(id);
      const active = Object.is(id, this._activeId);

      row.classList.toggle("dui-selected", selected);
      row.classList.toggle("dui-active", active);
      row.setAttribute("aria-selected", selected ? "true" : "false");

      const rowIndex = Number(row.dataset.duiGridRowIndex);
      for (const cell of row.querySelectorAll(".dui-grid__cell")) {
        const columnId = cell.dataset.duiGridColumnId;
        const columnIndex = rangeBounds.length ? columnIndices.get(columnId) ?? -1 : -1;
        const inRange = rangeBounds.some(range =>
          rowIndex >= range.top && rowIndex <= range.bottom &&
          columnIndex >= range.left && columnIndex <= range.right
        );
        const cellActive = active && columnId === this._activeColumnId;
        cell.classList.toggle("dui-grid__cell--range-selected", inRange);
        cell.classList.toggle("dui-grid__cell--active", cellActive);

        if (cellActive) {
          activeDescendant = cell.id;
        }
      }
    }

    if (activeDescendant) {
      this.element?.setAttribute("aria-activedescendant", activeDescendant);
    } else {
      this.element?.removeAttribute("aria-activedescendant");
    }
  }

  _handleClick(event, root) {
    if (event.target.closest?.(".dui-grid__row-handle")) return;
    if (this._editing?.cell.contains(event.target)) {
      return;
    }

    const cell = event.target.closest?.(".dui-grid__cell");
    const row = event.target.closest?.(".dui-grid__row");

    if (!row || !root.contains(row)) {
      return;
    }

    const item = this._getItemFromRow(row);

    if (!item) {
      return;
    }

    const id = this.view.idOf(item);
    const column = cell ? this.getColumn(cell.dataset.duiGridColumnId) : null;
    const wasEditing = Boolean(this._editing);

    if (wasEditing && !this.commitEdit({ origin: "user", userAction: true })) {
      this._editing?.cellEditor.focus();
      return;
    }

    root.focus({ preventScroll: true });

    this._selectionController.selectFromUser(item, event);
    if (this.destroyed) return;

    if (column) {
      this._setActiveCell(item, column.id, {
        origin: "user",
        userAction: true
      });

      if (wasEditing && this.rangeSelectionEnabled) {
        const point = { rowId: id, columnId: column.id };
        this.ranges.set([{ anchor: point, focus: point }], {
          origin: "user",
          userAction: true
        });
      }
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
        value: column ? getCellValue(item, column, this._visibleItems().indexOf(item)) : undefined,
        nativeEvent: event,
        origin: "user",
        userAction: true
      });

      if (column && isCheckboxEditor(column, item) && isEditableColumn(column, item)) {
        this._toggleCheckboxCell(item, column, {
          origin: "user",
          userAction: true
        });
      }
    }
  }

  _handleRangePointerDown(event) {
    if (event.target.closest?.(".dui-grid__row-handle")) return;
    if (!this.rangeSelectionEnabled || this.disabled || event.button !== 0) return;
    if (this._editing && !this._editing.cell.contains(event.target)) return;
    const cell = event.target.closest?.(".dui-grid__cell");
    const row = event.target.closest?.(".dui-grid__row");
    const item = row ? this._getItemFromRow(row) : null;
    const column = cell ? this.getColumn(cell.dataset.duiGridColumnId) : null;
    if (!item || !column) return;
    this.element?.focus({ preventScroll: true });

    const point = { rowId: this.view.idOf(item), columnId: column.id };
    const primary = this.ranges.primary();
    const anchor = event.shiftKey && primary ? primary.anchor : point;
    const range = { anchor, focus: point };
    const options = { origin: "user", userAction: true };

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
      this.ranges.add(range, options);
    } else {
      this.ranges.set([range], options);
    }
    this._rangeDrag = { anchor };
    this._setActiveCell(item, column.id, options);
  }

  _handleRangePointerOver(event) {
    if (!this._rangeDrag || (event.buttons & 1) === 0) return;
    const cell = event.target.closest?.(".dui-grid__cell");
    const row = event.target.closest?.(".dui-grid__row");
    const item = row ? this._getItemFromRow(row) : null;
    const column = cell ? this.getColumn(cell.dataset.duiGridColumnId) : null;
    if (!item || !column) return;
    const focus = { rowId: this.view.idOf(item), columnId: column.id };
    this.ranges.set([{ anchor: this._rangeDrag.anchor, focus }], {
      origin: "user",
      userAction: true
    });
    this._setActiveCell(item, column.id, { origin: "user", userAction: true });
  }

  _getPrimaryRangeMatrix() {
    const range = this.ranges.primary();
    if (!range) return { rows: [], columns: [] };
    const items = this._visibleItems();
    const columns = this._visibleColumns();
    const anchorRow = items.findIndex(item => Object.is(this.view.idOf(item), range.anchor.rowId));
    const focusRow = items.findIndex(item => Object.is(this.view.idOf(item), range.focus.rowId));
    const anchorColumn = columns.findIndex(column => column.id === range.anchor.columnId);
    const focusColumn = columns.findIndex(column => column.id === range.focus.columnId);
    if ([anchorRow, focusRow, anchorColumn, focusColumn].some(index => index < 0)) {
      return { rows: [], columns: [] };
    }
    const top = Math.min(anchorRow, focusRow);
    const bottom = Math.max(anchorRow, focusRow);
    const left = Math.min(anchorColumn, focusColumn);
    const right = Math.max(anchorColumn, focusColumn);
    const selectedColumns = columns.slice(left, right + 1);
    return {
      columns: selectedColumns,
      rows: items.slice(top, bottom + 1).map((item, offset) =>
        selectedColumns.map(column => ({ item, column, rowIndex: top + offset }))
      )
    };
  }

  _handleClipboardCopy(event, cut) {
    if (!this._canUseClipboard() || !this.ranges.hasAny() || !event.clipboardData) return;
    const target = this._captureClipboardTarget();
    const text = this.getClipboardText();
    if (!text || !this._sameClipboardTarget(target)) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", text);
    this.events.emit(cut ? "clipboardCut" : "clipboardCopy", {
      source: this, text, ranges: target.ranges.map(range => ({ anchor: { ...range.anchor }, focus: { ...range.focus } })),
      origin: "user", userAction: true
    });
    if (cut && this._sameClipboardTarget(target)) this._clearPrimaryRange({ origin: "user", userAction: true, reason: "clipboard-cut" });
  }

  _handleClipboardPaste(event) {
    if (!this._canUseClipboard() || !this.ranges.hasAny()) return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    this.pasteClipboardText(text, { origin: "user", userAction: true });
  }

  _clearPrimaryRange(options = {}) {
    if (!this._canUseClipboard()) return false;
    const mutation = normalizeMutationOptions(options);
    const rows = this._getPrimaryRangeMatrix().rows;
    let changed = false;
    this._clipboardBusy = true;
    try {
      const apply = () => {
        for (const row of rows) for (const { item, column } of row) {
          if (this.destroyed || this.disabled || this._editing) return;
          const currentItem = this.data.get(this.data.idOf(item));
          if (!currentItem) continue;
          const empty = resolveColumnFilterType(column) === "boolean" ? false : null;
          changed = this._applyClipboardCell(currentItem, column, empty, mutation, true) || changed;
        }
      };
      if (typeof this.data.batch === "function") this.data.batch(apply, { ...mutation, history: true });
      else apply();
      return changed;
    } finally { this._clipboardBusy = false; }
  }

  _applyClipboardCell(item, column, rawValue, options = {}, typed = false, toggle = false) {
    if (this.destroyed || this._destroyingGrid || this.disabled || this._editing || this._immediateEdit) return false;
    const mutation = normalizeMutationOptions(options);
    this._immediateEdit = true;
    let temporary;
    try {
      if (!getColumnEditor(column, item) || this.destroyed) return false;
      if (resolveReadOnly(column, item) === true || this.destroyed) return false;
      const id = this.data.idOf(item);
      const current = () => !this.destroyed && !this.disabled && !this._editing &&
        this.data.get(id) === item && this.view.has(id) && this.getColumn(column.id) === column && column.hidden !== true;
      if (!current()) return false;
      const rowIndex = this._visibleItems().findIndex(row => Object.is(this.view.idOf(row), id));
      const oldValue = getCellValue(item, column, rowIndex);
      if (!current()) return false;
      const event = { source: this, item, id, column, columnId: column.id, oldValue,
        origin: mutation.origin, userAction: mutation.userAction };
      const reject = (reason, details = {}) => {
        if (!this.destroyed && !mutation.silent) this._emitEditReject({ ...event, reason, ...details });
        return false;
      };
      try { event.newValue = toggle ? !Boolean(oldValue) : typed ? rawValue : parseClipboardCellValue(rawValue, column); }
      catch (error) { return reject("clipboard-parse", { newValue: rawValue, error }); }
      const factory = getColumnEditor(column, item, this);
      if (!factory || !current()) return false;
      temporary = { cellEditor: factory.createCellEditor({ source: this, grid: this, item, id, rowIndex,
        column, columnId: column.id, value: event.newValue }) };
      if (!current()) return false;
      const editor = temporary.cellEditor;
      for (const method of ["validate", "getValue", "destroy"]) {
        if (typeof editor?.[method] !== "function") throw new TypeError(`Grid cell editor must implement ${method}().`);
      }
      const validation = editor.validate({ ...event, grid: this, ...mutation, reason: toggle ? "toggle" : "clipboard" });
      if (!current()) return false;
      if (validation?.ok === false) return reject("validation", { validation });
      event.newValue = editor.getValue();
      if (!current()) return false;
      releaseGridEditor(this, temporary);
      if (!current()) return false;
      const before = { ...event, cancel: false };
      if (!mutation.silent) this.events.emit("beforeCellChange", before);
      if (!current()) return false;
      event.newValue = before.newValue;
      if (before.cancel === true) return reject("before-cell-change");
      if (Object.is(oldValue, event.newValue)) return false;
      const written = this._writeCellValue(item, id, column, event.newValue, mutation);
      if (this.destroyed || this._editing) return written !== false;
      if (written === false) return reject("write-rejected", { writeResult: written });
      event.item = this.data.get(id) ?? item;
      if (!mutation.silent) this.events.emit("cellChange", { ...event });
      if (toggle && !this.destroyed && !this._editing && !mutation.silent) this.events.emit("editCommit", {
        ...event, changed: true, writeResult: written
      });
      return true;
    } finally {
      try { if (temporary) releaseGridEditor(this, temporary); }
      finally { this._immediateEdit = false; }
    }
  }

  _handleDoubleClick(event, root) {
    if (this.disabled || this.destroyed || this._editing) return;
    if (event.target.closest?.(".dui-grid__row-handle")) return;
    const cell = event.target.closest?.(".dui-grid__cell");
    const row = event.target.closest?.(".dui-grid__row");

    if (!cell || !row || !root.contains(row)) {
      return;
    }

    const item = this._getItemFromRow(row);
    const column = this.getColumn(cell.dataset.duiGridColumnId);

    if (!item || !column) {
      return;
    }

    if (!this._emitDoubleClick(event, item, column, getCellValue(item, column, this._visibleItems().indexOf(item)))) return;
    if (this.data.get(this.data.idOf(item)) !== item || this.getColumn(column.id) !== column || isCheckboxEditor(column, item)) return;

    if (this.rowDetail && !isEditableColumn(column, item)) {
      this.toggleDetail(this.view.idOf(item), { origin:"user", userAction:true });
      return;
    }

    this._setActiveCell(item, column.id, {
      origin: "user",
      userAction: true
    });

    this.startEdit(item, column.id, {
      origin: "user",
      userAction: true
    });
  }

  _handleKeyDown(event) {
    if (this.destroyed || this.disabled || event.defaultPrevented || event.isComposing || event.keyCode === 229) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.showSearchPanel({ origin: "user", userAction: true });
      return;
    }

    if (event.key === "F3") {
      event.preventDefault();
      event.shiftKey ? this.previousSearchMatch() : this.nextSearchMatch();
      return;
    }

    if (event.target?.closest?.(".dui-grid__search-panel")) {
      return;
    }

    if (event.target !== this.element && event.target?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;

    if (this._editing) {
      return;
    }

    const items = this.rowRangeSelection ? this._rowSelectionItems() : this._visibleItems();

    if (this.destroyed || items.length === 0) {
      return;
    }

    let index = this._getActiveIndex(items);
    const oldActive = this._activeId == null ? null : {
      rowId: this._activeId,
      columnId: this._activeColumnId
    };
    if (this._keyboardController.handleNavigation(event, {
      rows: items,
      activeIndex: index
    })) {
      event.preventDefault();
      if (!this.destroyed && this.rangeSelectionEnabled && event.shiftKey && event.key.startsWith("Arrow") && this._activeId != null) {
        const primary = this.ranges.primary();
        this.ranges.set([{
          anchor: primary?.anchor ?? oldActive ?? { rowId:this._activeId, columnId:this._activeColumnId },
          focus: { rowId:this._activeId, columnId:this._activeColumnId }
        }], { origin:"user", userAction:true });
      }
      return;
    }
    let handled = true;

    switch (event.key) {
      case "F2":
        this.startEdit(this._activeId, this._activeColumnId, {
          origin: "user",
          userAction: true
        });
        break;

      case "Enter":
        if (!this.startEdit(this._activeId, this._activeColumnId, {
          origin: "user",
          userAction: true
        }) && !this.destroyed && !this._editing) {
          this._selectionController.selectActive(items);
        }
        break;

      case " ":
        if (!this._toggleActiveCheckboxCell() && !this.destroyed && !this._editing) {
          this._selectionController.selectActive(items);
        }
        break;

      default:
        handled = false;
        break;
    }

    if (!handled) {
      return;
    }

    event.preventDefault();

  }

  _setActiveItem(item, options = {}) {
    return super._setActiveItem(item, options);
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

  _startCellEdit(item, column, options = {}, activation = gridEditActivation(this)) {
    // Committing an already open editor is allowed during this transition.
    this._startingEdit = false;
    if (this._editing && !this.commitEdit(options)) return false;
    this._startingEdit = true;
    if (this.destroyed || this._editing || !activation.current()) return false;
    const id = this.view.idOf(item);
    const rowIndex = this._visibleItems().findIndex(current => Object.is(this.view.idOf(current), id));
    const validTarget = () => activation.current() && this.data.get(id) === item &&
      this.view.all()[rowIndex] === item && this.getColumn(column.id) === column && column.hidden !== true;
    if (rowIndex < 0 || !validTarget()) return false;
    const value = getCellValue(item, column, rowIndex);
    if (!validTarget()) return false;
    const beforeEvent = { source: this, item, id, column, columnId: column.id, value,
      cancel: false, origin: options.origin ?? "api", userAction: options.userAction === true };
    if (!options.silent) this.events.emit("beforeEditStart", beforeEvent);
    if (beforeEvent.cancel === true || !validTarget()) return false;
    activation.activate(id, column.id);
    this._setActiveCell(item, column.id, options);
    if (!validTarget()) return false;
    const cell = this._getCellElement(id, column.id);
    if (!cell) return false;
    const editor = getColumnEditor(column, item, this);
    if (!editor || !validTarget()) return false;
    const host = document.createElement("div");
    host.className = "dui-grid__editor-host";
    host.addEventListener("keydown", event => this._handleEditorKeyDown(event));
    const cellEditor = editor.createCellEditor({ source: this, grid: this, item, id, rowIndex,
      column, columnId: column.id, value });
    const editing = { item, id, column, editor, cellEditor, oldValue: value, cell,
      scrollTop: this._body?.scrollTop ?? 0, scrollLeft: this._body?.scrollLeft ?? 0, editorElement: host,
      origin: options.origin ?? "api", userAction: options.userAction === true };
    return mountGridEditor(this, editing, host, options,
      () => validTarget() && this._body?.contains(cell));
  }

  _handleEditorKeyDown(event) {
    handleGridEditorKeyDown(this, event, isEditableColumn);
  }

  _startAdjacentEdit(editing, direction) {
    return startAdjacentGridEdit(this, editing, direction, isEditableColumn) === "started";
  }

  _writeCellValue(item, id, column, value, options = {}) {
    if (typeof column.set === "function") {
      const result = column.set(item, value, {
        source: this,
        id,
        column,
        columnId: column.id,
        origin: options.origin ?? "api",
        userAction: options.userAction === true,
        silent: options.silent === true
      });

      if (result && typeof result.then === "function") {
        throw new TypeError("Grid column set() must be synchronous in Grid v0.3.1.");
      }

      return result !== false;
    }

    const field = column.field ?? column.id;

    if (typeof field !== "string") {
      throw new TypeError("Editable Grid column requires string field or set().");
    }

    return this.data.update(
      id,
      {
        [field]: value
      },
      options
    );
  }

  _toggleActiveCheckboxCell() {
    const item = this.view.get(this._activeId);
    const column = this.getColumn(this._activeColumnId);

    if (!item || !column || !isCheckboxEditor(column, item) || !isEditableColumn(column, item)) {
      return false;
    }

    return this._toggleCheckboxCell(item, column, {
      origin: "user",
      userAction: true
    });
  }

  _toggleCheckboxCell(item, column, options = {}) {
    return this._applyClipboardCell(item, column, null, options, true, true);
  }

  _getActiveIndex(items) {
    return items.findIndex(item => Object.is(this.view.idOf(item), this._activeId));
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
    this._windowRenderer.scrollToColumn(this._activeColumnId);
    this._renderRows();
  }

  _getCellElement(id, columnId) {
    return super._getCellElement(id, columnId);
  }

  _getItemFromRow(row) {
    const id = this._idsByRowKey.get(row.dataset.duiGridRowId);
    return id == null ? null : this.view.get(id) ?? null;
  }

  _visibleItems() {
    return this.view.all();
  }

  _rowSelectionItems() {
    if (!this.groups.hasAny()) return this._visibleItems();
    if (this.mounted) {
      this._windowRenderer.flush();
      return this.destroyed ? [] : this._windowRenderer.entries.filter(entry => entry.type === "item").map(entry => entry.item);
    }
    return this.groups.entries(this._visibleItems(), (item, columnId, index) => {
      const column = this.getColumn(columnId);
      return column ? getCellValue(item, column, index) : undefined;
    })
      .filter(entry => entry.type === "item").map(entry => entry.item);
  }

  _searchableColumns() {
    const configured = this.search.columns;
    return this._visibleColumns().filter(column =>
      column.searchable !== false && (!configured || configured.includes(String(column.id)))
    );
  }

  _cellMatchesSearch(value, column) {
    const query = this.search.query.trim().toLocaleLowerCase();
    if (!query || column.searchable === false) return false;
    const configured = this.search.columns;
    if (configured && !configured.includes(String(column.id))) return false;
    return formatFilterValue(value, column).toLocaleLowerCase().includes(query);
  }

  _itemMatchesSearch(item, rowIndex = -1) {
    return this._searchableColumns().some(column =>
      this._cellMatchesSearch(getCellValue(item, column, rowIndex), column)
    );
  }

  _getSearchMatches() {
    if (!this.search.hasQuery()) return [];
    const items = typeof this.view.projectedAll === "function"
      ? this.view.projectedAll()
      : this._visibleItems();
    const matches = [];
    items.forEach((item, rowIndex) => {
      const rowId = this.view.idOf(item, rowIndex);
      for (const column of this._searchableColumns()) {
        if (this._cellMatchesSearch(getCellValue(item, column, rowIndex), column)) {
          matches.push({ rowId, columnId: column.id, item });
        }
      }
    });
    return matches;
  }

  _renderSearchPanel() {
    if (!this._searchPanel) return;
    this._searchPanel.hidden = !this.searchPanelVisible;
    if (this._searchInput && this._searchInput.value !== this.search.query) {
      this._searchInput.value = this.search.query;
    }
    if (this._searchMode) this._searchMode.value = this.search.mode;
    const matches = this._getSearchMatches();
    if (this._searchCount) {
      const current = matches.length && this._activeSearchMatch >= 0
        ? this._activeSearchMatch + 1
        : 0;
      this._searchCount.textContent = `${current} / ${matches.length}`;
    }
    this._syncGridTemplateRows();
  }

  _syncGridTemplateRows() {
    if (!this.element) return;
    const rows = [];
    if (this.searchPanelVisible) rows.push("var(--dui-grid-search-height, var(--dui-control-height))");
    rows.push("var(--dui-grid-header-height, var(--dui-control-height))", "minmax(0, 1fr)");
    if (this._visibleColumns().some(column => column.summary != null)) {
      rows.push("var(--dui-grid-footer-height, var(--dui-control-height))");
    }
    if (this.statusBarOptions.visible) rows.push("var(--dui-grid-status-height, var(--dui-control-height))");
    this.element.style.gridTemplateRows = rows.join(" ");
  }

  _visibleColumns() {
    return super._visibleColumns();
  }

  _applyFrozenColumnCell(cell, column, columns, columnIndex) {
    return super._applyFrozenColumnCell(cell, column, columns, columnIndex);
  }

  _getColumnPixelWidth(column) {
    return super._getColumnPixelWidth(column);
  }

  _reconcileActiveItem() {
    if (this._activeId != null && !this.view.get(this._activeId)) {
      this._activeId = null;
    }
  }

  _reconcileSelection() {
    const current = this.selection.get();
    const next = current.flatMap(item => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const id = this.view.idOf(item);
      const currentItem = this.view.get(id);
      return currentItem ? [currentItem] : [];
    });

    if (next.length !== current.length || next.some((item, index) => item !== current[index])) {
      this.selection.set(next, {
        silent: true,
        origin: "system"
      });
    }
  }

  _getGridTemplateColumns() {
    return super._getGridTemplateColumns();
  }

}

function normalizeColumns(columns) {
  if (!Array.isArray(columns)) {
    throw new TypeError("Grid columns must be an array.");
  }

  return columns.map(column => {
    if (!column || typeof column !== "object") {
      throw new TypeError("Grid column must be an object.");
    }

    if (!column.id) {
      throw new TypeError("Grid column requires id.");
    }

    return {
      minWidth: 48,
      maxWidth: null,
      resizable: true,
      ...column,
      editor: normalizeEditor(column.editor),
      summary: normalizeColumnSummary(
        Object.prototype.hasOwnProperty.call(column, "summary")
          ? column.summary
          : Object.prototype.hasOwnProperty.call(column, "footer")
            ? { kind: "custom", value: column.footer }
            : null,
        column
      )
    };
  });
}

function assertFormattingColumn(rule, columns) {
  if (rule.columnId !== null && !columns.some(column => column.id === rule.columnId)) {
    throw new RangeError(`Unknown Grid formatting column: ${String(rule.columnId)} (rule ${String(rule.id)}).`);
  }
}

function normalizeFormattingRules(rules) {
  if (!Array.isArray(rules)) throw new TypeError("Grid formatting must be an array.");
  return rules.map(normalizeFormattingRule);
}

function normalizeFormattingRule(rule, index = 0) {
  if (!rule || typeof rule !== "object" || typeof rule.when !== "function") {
    throw new TypeError("Grid formatting rule requires a when function.");
  }
  return {
    id: rule.id ?? `format-${index + 1}`,
    columnId: rule.columnId ?? rule.column ?? null,
    when: rule.when,
    className: rule.className ?? "",
    style: rule.style && typeof rule.style === "object" ? { ...rule.style } : null,
    icon: rule.icon == null ? null : String(rule.icon)
  };
}

function normalizeColumnSummary(summary, column) {
  if (summary == null || summary === false || summary === "none") {
    return null;
  }

  if (summary === "count") {
    return { kind: "count", scope: column.summary?.scope ?? "page" };
  }

  if (["total", "min", "max", "average"].includes(summary)) {
    if (!isNumericSummaryColumn(column)) {
      const label = summary === "total" ? "total" : "numeric";
      throw new TypeError(`Grid ${label} summary requires a numeric column: ${String(column.id)}.`);
    }

    return { kind: summary, scope: column.summary?.scope ?? "page" };
  }

  if (summary && typeof summary === "object") {
    const scope = normalizeSummaryScope(summary.scope ?? column.summary?.scope ?? "page");
    if (summary.kind === "count") return { kind: "count", scope };
    if (["total", "min", "max", "average"].includes(summary.kind)) {
      if (!isNumericSummaryColumn(column)) {
        throw new TypeError(`Grid numeric summary requires a numeric column: ${String(column.id)}.`);
      }
      return { kind: summary.kind, scope };
    }
    if (summary.kind !== "custom") {
      throw new TypeError("Unknown Grid summary kind.");
    }
    return {
      kind: "custom",
      value: summary.value,
      scope
    };
  }

  throw new TypeError("Grid column summary must be count, total, min, max, average, none, or custom.");
}

function normalizeSummaryScope(scope) {
  if (!["page", "filtered", "all", "selection"].includes(scope)) {
    throw new TypeError("Grid summary scope must be page, filtered, all, or selection.");
  }
  return scope;
}

function sameColumnSummary(left, right) {
  return (
    left?.kind === right?.kind &&
    left?.scope === right?.scope &&
    (left?.kind !== "custom" || Object.is(left.value, right.value))
  );
}

function isNumericSummaryColumn(column) {
  return column?.dataType === "number" || resolveColumnFilterType(column) === "number";
}

function resolveColumnSummaryValue(column, rows, grid) {
  const summary = column.summary;

  if (!summary) {
    return "";
  }

  if (summary.kind === "custom") {
    return typeof summary.value === "function"
      ? summary.value(rows, column, grid)
      : summary.value;
  }

  const values = rows.map((item, index) => {
    const value = getCellValue(item, column, index);
    if (typeof column.value === "function") grid._windowRenderer.assertCurrent();
    return value;
  });

  if (summary.kind === "count") {
    const count = values.filter(value => !isEmptyFilterValue(value)).length;
    return `Count ${formatSummaryValue(count, summary.kind, column, grid)}`;
  }

  // Missing numeric cells are not zero (notably for averages and minima).
  const numbers = values
    .filter(value => value != null && !(typeof value === "string" && value.trim() === ""))
    .map(Number).filter(Number.isFinite);
  let value;
  let label;
  switch (summary.kind) {
    case "min": value = numbers.length ? Math.min(...numbers) : null; label = "Min"; break;
    case "max": value = numbers.length ? Math.max(...numbers) : null; label = "Max"; break;
    case "average": value = numbers.length
      ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length
      : null; label = "Avg"; break;
    default: value = numbers.reduce((sum, number) => sum + number, 0); label = "Total"; break;
  }
  return value == null ? "" : `${label} ${formatSummaryValue(value, summary.kind, column, grid)}`;
}

function formatSummaryValue(value, kind, column, grid) {
  if (typeof column.summaryFormat === "function") {
    return String(column.summaryFormat(value, {
      source: grid,
      grid,
      column,
      columnId: column.id,
      kind
    }));
  }

  return DEFAULT_GRID_NUMBER_FORMAT.format(value);
}

function normalizeSortModel(sortState) {
  if (sortState == null) {
    return [];
  }

  const rules = Array.isArray(sortState) ? sortState : [sortState];
  const seen = new Set();

  return rules.flatMap(rule => {
    if (!rule || typeof rule !== "object") {
      throw new TypeError("Grid sort model entries must be objects.");
    }

    const direction = normalizeSortDirection(rule.direction);

    if (!rule.columnId || direction == null || seen.has(rule.columnId)) {
      return [];
    }

    seen.add(rule.columnId);
    return [{ columnId: rule.columnId, direction }];
  });
}

function assertDataStore(store) {
  const requiredMethods = ["parse", "all", "get", "add", "update", "remove", "clear", "idOf"];

  for (const method of requiredMethods) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError("Grid data must implement DataStore.");
    }
  }

  if (!store.events || typeof store.events.on !== "function") {
    throw new TypeError("Grid data must expose EventBus.");
  }
}

function assertDataView(view) {
  const requiredMethods = [
    "all",
    "get",
    "idOf",
    "setFilter",
    "clearFilter",
    "getFilter",
    "setSort",
    "clearSort",
    "getSort"
  ];

  for (const method of requiredMethods) {
    if (typeof view?.[method] !== "function") {
      throw new TypeError("Grid view must implement DataView.");
    }
  }

  if (!view.events || typeof view.events.on !== "function") {
    throw new TypeError("Grid view must expose EventBus.");
  }
}

function assertPagingDataView(view) {
  const requiredMethods = ["setPage", "setPageSize", "clearPaging", "getPageState"];

  for (const method of requiredMethods) {
    if (typeof view?.[method] !== "function") {
      throw new TypeError(
        `Grid pagination requires a paging-capable DataView; missing ${method}().`
      );
    }
  }
}

function assertSelectionModel(selection) {
  const requiredMethods = ["get", "set", "clear", "hasAny"];

  for (const method of requiredMethods) {
    if (typeof selection?.[method] !== "function") {
      throw new TypeError("Grid selection must implement SelectionModel.");
    }
  }

  if (!selection.events || typeof selection.events.on !== "function") {
    throw new TypeError("Grid selection must expose EventBus.");
  }
}

function assertRangeSelectionModel(ranges) {
  const requiredMethods = ["get", "primary", "set", "add", "clear", "hasAny"];
  for (const method of requiredMethods) {
    if (typeof ranges?.[method] !== "function") {
      throw new TypeError("Grid ranges must implement RangeSelectionModel.");
    }
  }
  if (!ranges.events || typeof ranges.events.on !== "function") {
    throw new TypeError("Grid ranges must expose EventBus.");
  }
}

function assertGridFilterModel(filters) {
  const requiredMethods = ["get", "all", "activeColumns", "hasAny", "set", "clear", "clearAll", "matches"];

  for (const method of requiredMethods) {
    if (typeof filters?.[method] !== "function") {
      throw new TypeError("Grid filters must implement GridFilterModel.");
    }
  }

  if (!filters.events || typeof filters.events.on !== "function") {
    throw new TypeError("Grid filters must expose EventBus.");
  }
}

function assertGridSearchModel(search) {
  const requiredMethods = ["getState", "set", "setMode", "setColumns", "restoreState", "clear", "hasQuery"];
  for (const method of requiredMethods) {
    if (typeof search?.[method] !== "function") {
      throw new TypeError("Grid searchModel must implement GridSearchModel.");
    }
  }
  if (!search.events || typeof search.events.on !== "function") {
    throw new TypeError("Grid searchModel must expose EventBus.");
  }
}

function getCellValue(item, column, rowIndex) {
  if (typeof column.value === "function") {
    return column.value(item, rowIndex);
  }

  const field = column.field ?? column.id;
  return item[field];
}

function isSortableColumn(column) {
  return column != null && (column.sortable === true || typeof column.sort === "function");
}

function isFilterableColumn(column, gridFilterable) {
  return column.filterable === true || (gridFilterable && column.filterable !== false);
}

function collectDistinctFilterValues(items, column, limit) {
  const entriesByKey = new Map();
  let truncated = false;

  for (let index = 0; index < items.length; index += 1) {
    const value = getCellValue(items[index], column, index);
    const empty = isEmptyFilterValue(value);
    const key = empty ? "empty" : createFilterValueKey(value);

    if (entriesByKey.has(key)) {
      continue;
    }

    if (entriesByKey.size >= limit) {
      truncated = true;
      break;
    }

    entriesByKey.set(key, {
      key,
      value,
      empty,
      text: empty ? "(Blanks)" : formatFilterValue(value, column)
    });
  }

  const entries = Array.from(entriesByKey.values()).sort((left, right) =>
    compareGridStrings(left.text, right.text)
  );

  return { entries, truncated };
}

function formatFilterValue(value, column) {
  if (typeof column.filterText === "function") {
    return String(column.filterText(value, column) ?? "");
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }

  return String(value);
}

function createFilterValueKey(value) {
  if (value instanceof Date) {
    return `date:${value.getTime()}`;
  }

  if (typeof value === "number" && Number.isNaN(value)) {
    return "number:NaN";
  }

  return `${typeof value}:${String(value)}`;
}

function sameFilterValue(left, right) {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }

  return Object.is(left, right);
}

function isEmptyFilterValue(value) {
  return value == null || value === "";
}

function createFilterActionButton(text, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `dui-grid-filter__button ${className}`;
  button.textContent = text;
  return button;
}

function createFilterModeButton(text, mode) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dui-grid-filter__mode";
  button.dataset.duiGridFilterMode = mode;
  button.textContent = text;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-selected", "false");
  return button;
}

function createFilterField(labelText, control) {
  const label = document.createElement("label");
  label.className = "dui-grid-filter__field";
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(text, control);
  return label;
}

function appendSelectOption(select, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  select.appendChild(option);
}

function resolveColumnFilterType(column) {
  if (["text", "number", "date", "boolean", "values"].includes(column.filterType)) {
    return column.filterType;
  }

  if (isGridEditorFactory(column.editor)) {
    return column.editor.filterType;
  }

  return "values";
}

function resolveColumnConditionType(column, filterType, entries) {
  if (["text", "number", "date"].includes(column.conditionFilterType)) {
    return column.conditionFilterType;
  }

  if (filterType !== "values") {
    return filterType;
  }

  const values = entries
    .filter(entry => !entry.empty)
    .map(entry => entry.value);

  if (values.length === 0) {
    return "text";
  }

  if (values.every(value => typeof value === "number" && Number.isFinite(value))) {
    return "number";
  }

  if (values.every(value => value instanceof Date)) {
    return "date";
  }

  if (values.every(value => typeof value === "boolean")) {
    return null;
  }

  return "text";
}

function getConditionOperators(filterType) {
  switch (filterType) {
    case "text":
      return [
        { id: "contains", label: "Contains" },
        { id: "equals", label: "Equals" },
        { id: "startsWith", label: "Starts with" },
        { id: "endsWith", label: "Ends with" },
        { id: "empty", label: "Is empty" },
        { id: "notEmpty", label: "Is not empty" }
      ];
    case "number":
      return [
        { id: "equals", label: "Equals" },
        { id: "notEquals", label: "Does not equal" },
        { id: "greater", label: "Greater than" },
        { id: "greaterOrEqual", label: "Greater than or equal" },
        { id: "less", label: "Less than" },
        { id: "lessOrEqual", label: "Less than or equal" },
        { id: "between", label: "Between" }
      ];
    case "date":
      return [
        { id: "on", label: "On" },
        { id: "before", label: "Before" },
        { id: "after", label: "After" },
        { id: "between", label: "Between" },
        { id: "empty", label: "Is empty" },
        { id: "notEmpty", label: "Is not empty" }
      ];
    default:
      return [];
  }
}

function createConditionInput(filterType, ariaLabel) {
  const input = document.createElement("input");
  input.className = "dui-grid-filter__condition-value";
  input.type = filterType === "number" ? "number" : filterType === "date" ? "date" : "text";
  input.autocomplete = "off";
  input.setAttribute("aria-label", ariaLabel);

  if (filterType === "number") {
    input.step = "any";
  }

  return input;
}

function createConditionFilter(filterType, operator, value, valueTo) {
  if (filterType === "text") {
    if (operator !== "empty" && operator !== "notEmpty" && value === "") {
      throw new TypeError("Text filter value is required.");
    }

    return {
      kind: "text",
      operator,
      value
    };
  }

  if (filterType === "number") {
    if (value === "" || (operator === "between" && valueTo === "")) {
      throw new TypeError("Number filter value is required.");
    }

    return {
      kind: "number",
      operator,
      value,
      ...(operator === "between" ? { valueTo } : {})
    };
  }

  if (filterType === "date") {
    if (
      operator !== "empty" &&
      operator !== "notEmpty" &&
      (value === "" || (operator === "between" && valueTo === ""))
    ) {
      throw new TypeError("Date filter value is required.");
    }

    return {
      kind: "date",
      operator,
      value,
      ...(operator === "between" ? { valueTo } : {})
    };
  }

  throw new TypeError(`Column filter type does not support conditions: ${String(filterType)}.`);
}

function positionFilterPopup(popup, trigger) {
  const margin = 6;
  const triggerRect = trigger.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - popupRect.width - margin);
  const left = Math.max(margin, Math.min(triggerRect.left, maxLeft));
  const preferredTop = triggerRect.bottom + 2;
  const top =
    preferredTop + popupRect.height <= window.innerHeight - margin
      ? preferredTop
      : Math.max(margin, triggerRect.top - popupRect.height - 2);

  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
}

function normalizeSortDirection(direction) {
  if (direction == null || direction === false || direction === "none") {
    return null;
  }

  if (direction === "asc" || direction === "ascending") {
    return "asc";
  }

  if (direction === "desc" || direction === "descending") {
    return "desc";
  }

  throw new TypeError("Grid sort direction must be 'asc', 'desc', or null.");
}

function getNextSortDirection(sortState, columnId) {
  if (!sortState || sortState.columnId !== columnId) {
    return "asc";
  }

  if (sortState.direction === "asc") {
    return "desc";
  }

  return null;
}

function createColumnSort(column, direction, grid) {
  const multiplier = direction === "desc" ? -1 : 1;

  return (left, right, context) => {
    let result;
    if (typeof column.sort === "function") {
      result = column.sort(left, right, {
        ...context,
        column,
        columnId: column.id,
        direction,
        grid
      });
      assertProjectionCurrent(grid.view);
    } else {
      const leftValue = getCellValue(left, column, -1);
      if (typeof column.value === "function") assertProjectionCurrent(grid.view);
      const rightValue = getCellValue(right, column, -1);
      if (typeof column.value === "function") assertProjectionCurrent(grid.view);
      result = compareValues(leftValue, rightValue);
    }

    return multiplier * normalizeSortResult(result);
  };
}

function createMultiColumnSort(sortModel, grid) {
  const currentSort = grid.view.getSort();
  if (currentSort !== grid._ownedViewSort) grid._detachedViewSort = currentSort;
  const columns = sortModel.map(rule => grid.getColumn(rule.columnId));
  const fields = columns.every(column => column && typeof column.value !== "function" && typeof column.sort !== "function")
    ? columns.map(column => column.field ?? column.id) : null;
  const comparators = sortModel.map(rule =>
    createColumnSort(grid.getColumn(rule.columnId), rule.direction, grid)
  );

  return grid._ownedViewSort = trackProjection((left, right, context) => {
    for (const compare of comparators) {
      const result = compare(left, right, context);
      if (result !== 0) {
        return result;
      }
    }
    return 0;
  }, () => {
    return fields && columns.every((column, index) => typeof column.value !== "function" && typeof column.sort !== "function" &&
      (column.field ?? column.id) === fields[index]) ? fields : null;
  });
}

function normalizeSortResult(result) {
  const value = Number(result);

  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }

  return value < 0 ? -1 : 1;
}

function compareValues(left, right) {
  if (Object.is(left, right) || (left == null && right == null)) {
    return 0;
  }

  if (left == null) {
    return 1;
  }

  if (right == null) {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  return compareGridStrings(left, right);
}

function escapeTsvValue(value) {
  if (value == null) return "";
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function parseTsv(text) {
  return String(text).replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map(row => row.split("\t"));
}

function parseClipboardCellValue(value, column) {
  const type = column.dataType ?? resolveColumnFilterType(column);
  if (type === "number") {
    if (String(value).trim() === "") return null;
    const number = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(number)) throw new TypeError("Clipboard value is not a number.");
    return number;
  }
  if (type === "boolean") {
    const normalized = String(value).trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(normalized)) return true;
    if (["false", "no", "0", "off", ""].includes(normalized)) return false;
    throw new TypeError("Clipboard value is not a boolean.");
  }
  if (type === "date" && String(value).trim() !== "") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError("Clipboard value is not a date.");
    return value;
  }
  return String(value);
}

function getHeaderAriaSort(sortState, column) {
  if (sortState?.columnId !== column.id) {
    return "none";
  }

  return sortState.direction === "desc" ? "descending" : "ascending";
}

function renderCellValue(value, item, column, rowIndex) {
  if (typeof column.render === "function") {
    return column.render(value, item, column, rowIndex);
  }

  return value;
}

function resolveRowClass(rowClass, item, rowIndex, grid) {
  return typeof rowClass === "function" ? rowClass(item, rowIndex, grid) : rowClass;
}

function normalizeEditor(editor) {
  if (editor == null || editor === false) {
    return null;
  }

  if (typeof editor === "function") {
    return editor;
  }

  if (isGridEditorFactory(editor)) {
    return editor;
  }

  if (!editor || typeof editor !== "object") {
    throw new TypeError("Grid column editor must be a Grid editor factory or resolver function.");
  }

  if (typeof editor.createCellEditor === "function") {
    return editor;
  }

  throw new TypeError("Grid column editor must implement createCellEditor().");
}

function isEditableColumn(column, item, renderGrid = null) {
  const editor = getColumnEditor(column, item);
  renderGrid?._windowRenderer.assertCurrent();
  if (editor == null) return false;
  const readOnly = resolveReadOnly(column, item);
  renderGrid?._windowRenderer.assertCurrent();
  return readOnly !== true;
}

function isCheckboxEditor(column, item) {
  return getColumnEditor(column, item)?.activation === "toggle";
}

function getColumnEditor(column, item, grid = null) {
  if (!column) {
    return null;
  }

  const resolved = typeof column.editor === "function"
    ? column.editor(item, column, grid)
    : column.editor;
  const normalized = normalizeEditor(resolved);

  if (normalized == null) {
    return null;
  }

  if (typeof normalized.createCellEditor !== "function") {
    throw new TypeError("Grid editor factory must implement createCellEditor().");
  }

  return normalized;
}

function resolveReadOnly(column, item) {
  return typeof column.readOnly === "function" ? column.readOnly(item, column) : column.readOnly;
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

function normalizeFilterValueLimit(value) {
  const parsed = Number(value ?? 500);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 500;
}

function normalizeStatusBarOptions(statusBar) {
  if (statusBar == null || statusBar === false) {
    return {
      visible: false,
      showRowPosition: true,
      showFilteredCount: true,
      showTotalCount: true,
      pagination: null,
      formatNumber: value => DEFAULT_GRID_NUMBER_FORMAT.format(value)
    };
  }

  if (statusBar !== true && (typeof statusBar !== "object" || Array.isArray(statusBar))) {
    throw new TypeError("Grid statusBar must be boolean or an options object.");
  }

  const options = statusBar === true ? {} : statusBar;

  if (options.formatNumber != null && typeof options.formatNumber !== "function") {
    throw new TypeError("Grid statusBar formatNumber must be a function.");
  }

  return {
    visible: options.visible !== false,
    showRowPosition: options.showRowPosition !== false,
    showFilteredCount: options.showFilteredCount !== false,
    showTotalCount: options.showTotalCount !== false,
    pagination: normalizePaginationOptions(options.pagination),
    formatNumber: options.formatNumber ?? (value => DEFAULT_GRID_NUMBER_FORMAT.format(value))
  };
}

function normalizePaginationOptions(pagination) {
  if (pagination == null || pagination === false) {
    return null;
  }

  if (pagination !== true && (typeof pagination !== "object" || Array.isArray(pagination))) {
    throw new TypeError("Grid statusBar pagination must be boolean or an options object.");
  }

  const options = pagination === true ? {} : pagination;
  const pageSize = normalizePositiveInteger(options.pageSize ?? 100, "pagination pageSize");
  const page = normalizePositiveInteger(options.page ?? 1, "pagination page");

  if (options.pageSizes != null && !Array.isArray(options.pageSizes)) {
    throw new TypeError("Grid pagination pageSizes must be an array.");
  }

  return {
    page,
    pageSize,
    pageSizes: normalizePageSizes(options.pageSizes ?? [25, 50, 100, 250], pageSize)
  };
}

function normalizePageSizes(pageSizes, currentPageSize) {
  const sizes = [...(pageSizes ?? []), currentPageSize]
    .map(size => normalizePositiveInteger(size, "pagination page size"));

  return [...new Set(sizes)].sort((left, right) => left - right);
}

function normalizePositiveInteger(value, label) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`Grid ${label} must be a positive integer.`);
  }

  return parsed;
}

function createPaginationButton(iconName, label) {
  const button = document.createElement("button");
  button.className = "dui-grid__page-button";
  button.type = "button";
  button.append(createIcon(iconName));
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

function createUnpagedState(itemCount) {
  return {
    enabled: false,
    page: 1,
    pageSize: null,
    pageCount: 1,
    filteredCount: itemCount,
    pageItemCount: itemCount,
    from: itemCount === 0 ? 0 : 1,
    to: itemCount,
    canGoFirst: false,
    canGoPrevious: false,
    canGoNext: false,
    canGoLast: false
  };
}

function pageProjectionChanged(oldState, state) {
  return Boolean(
    oldState &&
    state &&
    (oldState.page !== state.page || oldState.pageSize !== state.pageSize)
  );
}

function sameGridPageState(left, right) {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.enabled === right.enabled &&
    left.page === right.page &&
    left.pageSize === right.pageSize &&
    left.pageCount === right.pageCount &&
    left.filteredCount === right.filteredCount &&
    left.pageItemCount === right.pageItemCount &&
    left.from === right.from &&
    left.to === right.to
  );
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

function createCellDomId(controlId, rowKey, columnId) {
  return `${controlId}-cell-${encodeURIComponent(rowKey)}-${encodeURIComponent(columnId)}`;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(value);
  }

  return String(value).replaceAll('"', '\\"');
}

function setWindowCellStyle(cell, key, value) {
  if (key.startsWith("--") || key.includes("-")) cell.style.setProperty(key, value ?? "");
  else cell.style[key] = value ?? "";
}
