import type {DataStoreTransferArguments,DataStoreTransferResult} from "../core/DataStore.js";
import { GridCore } from './GridCore.js';
import type { DefaultItemId, ItemId, DataStore, DataView, DataViewFilter, DataViewProjectionOptions,
  DataViewPageState, SelectionModel, RangeSelectionModel, CellRange, CellRangeInput, GridFilterModel,
  GridSearchModel, GridGroupModel, GridGroupRuleInput, ColumnFilterInput, MutationMetadataOptions,
  DataProviderOptions, DataProviderResponse } from '../core/index.js';
import type { GridColumn, GridNormalizedColumn, GridSummaryInput, GridNormalizedSummary, GridSummaryKind,
  GridSortRule, GridSortInput, GridSortDirection } from './grid-columns.js';
import type { GridOptions, GridLayoutState, GridLayoutRestore, GridFormattingRule, GridRemoteRequest,
  GridRemoteProvider, GridSortOptions, GridStatusBar, GridNormalizedStatusBar, GridNormalizedFormattingRule, GridClearFilterOptions } from './grid-options.js';
import type { GridEvents } from './grid-events.js';
import type { GridExporter, GridExportOptions } from './GridExporters.js';

export declare class Grid<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>
  extends GridCore<T, I, GridEvents<T, I>, GridNormalizedColumn<T, I>> {
  constructor(options?: GridOptions<T, I>);
  constructor(container: HTMLElement | string, options?: GridOptions<T, I>);
  readonly data: DataStore<T, I>;
  readonly view: DataView<T, I>;
  readonly selection: SelectionModel<T>;
  readonly ranges: RangeSelectionModel<I>;
  readonly filters: GridFilterModel<T>;
  readonly search: GridSearchModel;
  readonly groups: GridGroupModel<T>;
  readonly dataProvider: GridRemoteProvider<T> | null;
  readonly remoteTotalCount: number | null;
  readonly multiSelect: boolean;
  readonly rowRangeSelection: boolean;
  readonly rowReorderEnabled: boolean;
  readonly rowTransferMode: 'move' | 'copy';
  setRowTransferMode(mode: 'move' | 'copy'): this;
  transferRowsTo<U extends object, J extends ItemId>(target: Grid<U, J>, ids: readonly I[], ...options: DataStoreTransferArguments<T, NoInfer<U>>): DataStoreTransferResult<J, I>;
  moveRows(ids: readonly I[], targetId: I, options?: MutationMetadataOptions & { position?: 'before' | 'after' }): boolean;
  readonly virtualColumns: boolean;
  readonly searchPanelVisible: boolean;
  readonly rangeSelectionEnabled: boolean;
  readonly clipboardEnabled: boolean;
  readonly filterable: boolean;
  readonly filterValueLimit: number;
  readonly statusBarOptions: GridNormalizedStatusBar;
  readonly formatting: GridNormalizedFormattingRule<T, I>[];
  readonly sortModel: GridSortRule[];
  readonly sortState: GridSortRule | null;
  readonly rowClass: Exclude<GridOptions<T, I>['rowClass'], undefined>;
  readonly rowDetail: GridOptions<T, I>['rowDetail'] | null;
  setColumns(columns: readonly GridColumn<T, I>[]): this;
  getLayoutState(): GridLayoutState<T, I>;
  restoreLayoutState(state: GridLayoutRestore<T, I>, options?: MutationMetadataOptions): this;
  setColumnHidden(columnId: string, hidden: boolean, options?: MutationMetadataOptions): boolean;
  addFormattingRule(rule: GridFormattingRule<T, I>, options?: MutationMetadataOptions): string;
  removeFormattingRule(ruleId: string, options?: MutationMetadataOptions): boolean;
  setGroups(rules: readonly GridGroupRuleInput[], options?: MutationMetadataOptions): boolean;
  clearGroups(options?: MutationMetadataOptions): boolean;
  toggleGroup(path: string, options?: MutationMetadataOptions): boolean;
  expandDetail(rowId: I, options?: MutationMetadataOptions): boolean;
  collapseDetail(rowId: I, options?: MutationMetadataOptions): boolean;
  toggleDetail(rowId: I, options?: MutationMetadataOptions): boolean;
  exportData<R>(exporter: GridExporter<T, I, R>, options?: GridExportOptions): R;
  createRemoteRequest<O extends object = {}>(overrides?: O): Omit<GridRemoteRequest, keyof O> & O;
  reloadRemote(overrides?: Partial<GridRemoteRequest>, options?: DataProviderOptions): Promise<DataProviderResponse<T>>;
  undo(options?: MutationMetadataOptions): boolean;
  redo(options?: MutationMetadataOptions): boolean;
  getColumnSummary(columnId: string): GridSummaryKind | null;
  getColumnSummaryConfig(columnId: string): GridNormalizedSummary<T, I> | null;
  /** Formatted footer content (or custom content), not a raw numeric aggregate. */
  getColumnSummaryValue(columnId: string): unknown;
  setColumnSummary(columnId: string, summary: GridSummaryInput<T, I>, options?: MutationMetadataOptions): boolean;
  getSelectedIds(): I[];
  setSelectedIds(ids: I | readonly I[], options?: MutationMetadataOptions): boolean;
  selectById(id: I, options?: MutationMetadataOptions): boolean;
  clearSelection(options?: MutationMetadataOptions): boolean;
  getCellRanges(): CellRange<I>[];
  setCellRanges(ranges: CellRangeInput<I> | readonly CellRangeInput<I>[] | null, options?: MutationMetadataOptions): boolean;
  clearCellRanges(options?: MutationMetadataOptions): boolean;
  getClipboardText(): string;
  copy(options?: MutationMetadataOptions): Promise<boolean>;
  cut(options?: MutationMetadataOptions): Promise<boolean>;
  paste(options?: MutationMetadataOptions): Promise<boolean>;
  pasteClipboardText(text: string, options?: MutationMetadataOptions): boolean;
  setFilter(filter: DataViewFilter<T, I> | null, options?: DataViewProjectionOptions): boolean;
  clearFilter(options?: DataViewProjectionOptions): boolean;
  /** Same global predicate as the supplied DataView; column/search filters are separate. */
  getFilter(): DataViewFilter<T, I> | null;
  setColumnFilter(columnId: string, filter: ColumnFilterInput, options?: MutationMetadataOptions): boolean;
  clearColumnFilter(columnId: string, options?: MutationMetadataOptions): boolean;
  clearAllFilters(options?: GridClearFilterOptions): boolean;
  showSearchPanel(options?: MutationMetadataOptions): boolean;
  hideSearchPanel(options?: MutationMetadataOptions & { clear?: boolean }): boolean;
  nextSearchMatch(options?: MutationMetadataOptions): boolean;
  previousSearchMatch(options?: MutationMetadataOptions): boolean;
  sortBy(columnId: string, direction?: GridSortDirection, options?: GridSortOptions): boolean;
  setSortModel(sortModel: readonly GridSortInput[] | GridSortInput | null, options?: GridSortOptions): boolean;
  clearSort(options?: GridSortOptions): boolean;
  getSortState(): GridSortRule | null;
  getSortModel(): GridSortRule[];
  setStatusBar(statusBar: boolean | GridStatusBar | null): this;
  getPageState(): DataViewPageState;
  setPage(page: number, options?: MutationMetadataOptions): boolean;
  setPageSize(pageSize: number | null | false, options?: DataViewProjectionOptions): boolean;
  firstPage(options?: MutationMetadataOptions): boolean;
  previousPage(options?: MutationMetadataOptions): boolean;
  nextPage(options?: MutationMetadataOptions): boolean;
  lastPage(options?: MutationMetadataOptions): boolean;
  getStatusBarState(): { rowIndex: number; rowCount: number; filteredCount: number; totalCount: number;
    filterActive: boolean; pageState: DataViewPageState };
  startEdit(itemOrId?: T | I | null, columnId?: string | null, options?: MutationMetadataOptions): boolean;
  commitEdit(options?: MutationMetadataOptions): boolean;
  cancelEdit(options?: MutationMetadataOptions): boolean;
}
