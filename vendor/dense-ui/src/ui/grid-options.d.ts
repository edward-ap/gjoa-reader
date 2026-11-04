import type { BaseControlOptions, DefaultItemId, ItemId, DataStore, DataStoreOptions, DataView, DataViewFilter,
  TreeDataView, TreeDataViewFilter, TreeDataViewEntry, SelectionModel, RangeSelectionModel,
  GridFilterModel, GridSearchModel, GridSearchOptions, GridGroupModel, GridGroupRuleInput,
  GridGroupState, GridSearchState, GridColumnState, GridColumnRestoreEntry, ColumnFilter, ColumnFilterInput,
  DataProviderResponse, DataProviderOptions, MutationMetadataOptions } from '../core/index.js';
import type { GridCoreOptions } from './GridCore.js';
import type { GridColumn, GridNormalizedSummary, TreeGridColumn, GridSortRule, GridSortInput } from './grid-columns.js';
import type { Grid } from './Grid.js';
import type { TreeGrid } from './TreeGrid.js';

export interface GridPagination { page?: number; pageSize?: number; pageSizes?: readonly number[] }
export interface GridStatusBar { visible?: boolean; showRowPosition?: boolean; showFilteredCount?: boolean;
  showTotalCount?: boolean; pagination?: boolean | GridPagination | null; formatNumber?: (value: number) => string }
export interface GridNormalizedStatusBar { visible: boolean; showRowPosition: boolean; showFilteredCount: boolean;
  showTotalCount: boolean; pagination: { page: number; pageSize: number; pageSizes: number[] } | null; formatNumber: (value: number) => string }
export type GridControlCallback = 'onResize' | 'onParentResize' | 'onFocus' | 'onBlur' | 'onKeyDown' | 'onKeyUp';
export interface GridFormattingRule<T extends object, I extends ItemId = DefaultItemId<T>> {
  id?: string;
  columnId?: string | null;
  column?: string;
  when: (value: unknown, context: { source: Grid<T, I>; grid: Grid<T, I>; item: T; column: GridColumn<T, I>; rowIndex: number }) => boolean;
  className?: string;
  style?: Partial<CSSStyleDeclaration> | null;
  icon?: string | null;
}
export type GridNormalizedFormattingRule<T extends object, I extends ItemId = DefaultItemId<T>> =
  GridFormattingRule<T, I> & { id: string; columnId: string | null; className: string; style: Partial<CSSStyleDeclaration> | null; icon: string | null };
export interface GridRemoteRequest {
  page: number;
  pageSize: number | null;
  sort: GridSortRule[];
  filters: { columnId: string; filter: ColumnFilter }[];
  search: GridSearchState;
}
export interface GridRemoteProvider<T extends object> {
  request(request: GridRemoteRequest, options?: DataProviderOptions): DataProviderResponse<T> | PromiseLike<DataProviderResponse<T>>;
}
export interface GridOptions<T extends object, I extends ItemId = DefaultItemId<T>> extends Omit<GridCoreOptions<T, I>, 'columns' | GridControlCallback>,
  Pick<BaseControlOptions<Grid<T, I>>, GridControlCallback>, DataStoreOptions<T, I> {
  columns?: readonly GridColumn<T, I>[];
  virtualColumns?: boolean;
  data?: DataStore<T, I>;
  view?: DataView<T, I>;
  selection?: SelectionModel<T>;
  ranges?: RangeSelectionModel<I>;
  filters?: GridFilterModel<T>;
  searchModel?: GridSearchModel;
  search?: GridSearchOptions;
  groupModel?: GridGroupModel<T>;
  groups?: readonly GridGroupRuleInput[];
  multiSelect?: boolean;
  /** Opt-in Shift row ranges; disables Grid pointer/keyboard cell ranges. */
  rowRangeSelection?: boolean;
  /** Show local row reorder handles; sorting/grouping/remote data disable moves. */
  rowReorder?: boolean;
  /** Opt-in local independent-store Grid transfer; default mode is move. */
  rowTransfer?: {drag?: boolean; accept?: boolean; mode?: 'move' | 'copy'};
  rangeSelection?: boolean;
  clipboard?: boolean;
  filterable?: boolean;
  filterValueLimit?: number;
  filter?: DataViewFilter<T, I> | null;
  rowClass?: string | ((item: T, rowIndex: number, grid: Grid<T, I>) => string | null | undefined) | null;
  rowDetail?: (item: T, context: { source: Grid<T, I>; grid: Grid<T, I>; id: I; rowIndex: number }) => unknown;
  expandedDetails?: Iterable<I>;
  dataProvider?: GridRemoteProvider<T> | null;
  formatting?: readonly GridFormattingRule<T, I>[];
  searchPanel?: boolean;
  sortModel?: readonly GridSortInput[] | GridSortInput | null;
  sortState?: readonly GridSortInput[] | GridSortInput | null;
  statusBar?: boolean | GridStatusBar | null;
}
export interface TreeGridOptions<T extends object, I extends ItemId = DefaultItemId<T>> extends Omit<GridCoreOptions<T, I>, 'columns' | GridControlCallback>,
  Pick<BaseControlOptions<TreeGrid<T, I>>, GridControlCallback>, DataStoreOptions<T, I> {
  columns?: readonly TreeGridColumn<T, I>[];
  virtualColumns?: boolean;
  data?: DataStore<T, I>;
  treeView?: TreeDataView<T, I>;
  selection?: SelectionModel<T>;
  parentField?: Extract<keyof T, string>;
  rootParentId?: ItemId | null;
  textField?: Extract<keyof T, string> | ((item: T) => unknown);
  iconField?: Extract<keyof T, string>;
  nodeIcon?: ((item: T, entry: TreeDataViewEntry<T, I>, grid: TreeGrid<T, I>) => TreeGridIcon | undefined) | null;
  treeColumnId?: string;
  expandOnClick?: boolean;
  /** Opt-in local subtree move through the service gutter and moveNode(s). */
  nodeReorder?: boolean;
  multiSelect?: boolean;
  /** Opt-in Shift row ranges; disables Grid pointer/keyboard cell ranges. */
  rowRangeSelection?: boolean;
  searchPanel?: boolean;
  statusBar?: boolean | { visible?: boolean };
  expandedIds?: Iterable<I>;
  expandAll?: boolean;
}
export interface GridLayoutState<T extends object, I extends ItemId = DefaultItemId<T>> {
  version: 1;
  columns: GridColumnState<string>[];
  sort: GridSortRule[];
  summaries: { columnId: string; summary: GridNormalizedSummary<T, I> }[];
  pageSize: number | null;
  search: GridSearchState & { visible: boolean };
  groups: GridGroupState;
  expandedDetails: I[];
}
export type GridLayoutRestore<T extends object, I extends ItemId = DefaultItemId<T>> =
  Omit<Partial<GridLayoutState<T, I>>, 'columns'> & { columns: readonly GridColumnRestoreEntry<string>[] };
export interface TreeGridLayoutState<I extends ItemId> { version: 1; columns: GridColumnState<string>[]; expandedIds: I[] }
export type TreeGridLayoutRestore<I extends ItemId> = Omit<Partial<TreeGridLayoutState<I>>, 'columns'> & { columns: readonly GridColumnRestoreEntry<string>[] };
export interface GridSortOptions extends MutationMetadataOptions { additive?: boolean }
/** Explicit search scope shared by both tables; omitted retains each legacy default. */
export interface GridClearFilterOptions extends MutationMetadataOptions { search?: boolean }
export type TreeGridFilter<T> = (item: T) => boolean;
export type TreeGridColumnFilter<T> = ColumnFilterInput | string | ((value: unknown, item: T) => boolean) | null;
export type TreeGridIcon = string | Node | { name?: string; tagName?: 'img' | 'span'; src?: string;
  className?: string; text?: string | number; title?: string } | null | false;

export type TreeGridNodeDropPosition = 'before' | 'inside' | 'after';
export interface TreeGridNodeMoveOptions extends MutationMetadataOptions { expandTarget?: boolean; nativeEvent?: DragEvent | null }
export interface TreeGridNodeMoveResult<I extends ItemId = ItemId> {
  accepted: boolean; reason: string | null; ids: I[]; subtreeIds: I[];
  targetId: I | null; position: TreeGridNodeDropPosition; parentId: unknown;
  notificationErrors: unknown[];
}
export interface TreeGridNodeMoveProposal<T extends object, I extends ItemId = DefaultItemId<T>> {
  ids: I[]; subtreeIds: I[]; targetId: I | null; position: TreeGridNodeDropPosition;
  parentId: unknown; items: T[];
}
