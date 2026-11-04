import type {DataStoreTransferResult} from "../core/DataStore.js";
import type { ItemId, DefaultItemId, ChangeOrigin, DataStoreChange, DataViewChange, TreeDataViewChange,
  DataViewPageState, GridColumnState, GridGroupChange, GridSearchState, GridFilterModel, ColumnFilter,
  CellRange, DataProviderResponse } from '../core/index.js';
import type { GridEditorColumn, GridEditingEvents, TreeGridEditingEvents, CellEditorValidation } from './grid-editor-contracts.js';
import type { GridNormalizedColumn, TreeGridNormalizedColumn, GridSortRule, GridSummaryKind, GridSummaryScope } from './grid-columns.js';
import type { GridLayoutState, TreeGridLayoutState, GridRemoteRequest, GridNormalizedFormattingRule, TreeGridNodeMoveProposal, TreeGridNodeMoveResult } from './grid-options.js';
import type { GridExportOptions, GridExporter } from './GridExporters.js';
import type { Grid } from './Grid.js';
import type { TreeGrid } from './TreeGrid.js';

/** Counterpart identity without pretending its record schema is known to this owner. */
export interface GridTransferPeer {readonly id:string;readonly name:string|null;readonly destroyed:boolean;readonly disabled:boolean;readonly rowTransferMode:'move'|'copy'}
export interface GridEvent<S> { source: S; origin: ChangeOrigin; userAction: boolean }
export type GridSourcedEvents<E, S, C> = { [K in keyof E]: Omit<E[K], 'source' | 'column'> & { source: S } &
  (E[K] extends { column: infer V } ? { column: C | Extract<V, null | undefined> } : {}) };
export interface GridCoreEvents<T extends object, I extends ItemId, C extends GridEditorColumn<T, I>, S> {
  layoutChange: GridEvent<S> & { operation: string; layoutState: { version: 1; columns: GridColumnState<string>[] } };
  activeChange: GridEvent<S> & { oldId: I | null; id: I; item: T };
  activeCellChange: GridEvent<S> & { oldId: I | null; oldColumnId: string | null; id: I; item: T; column: C; columnId: string };
  columnResizeStart: GridEvent<S> & { column: C; columnId: string; width: number };
  columnResize: GridEvent<S> & { column: C; columnId: string; width: number;
    adjacentColumn?: C | null; adjacentColumnId?: string | null; adjacentWidth?: number | string | null; reason?: string };
  columnResizeEnd: GridEvent<S> & { column: C; columnId: string; width: number | string | null | undefined };
  columnDragStart: GridEvent<S> & { column: C; columnId: string };
  columnReorder: GridEvent<S> & { columnId: string; oldIndex: number; index: number };
}
export interface GridRowEvents<T extends object, I extends ItemId, C, S> {
  rowDoubleClick: GridEvent<S> & { item:T; id:I; nativeEvent:MouseEvent; cancel:boolean };
  cellDoubleClick: GridEvent<S> & { item:T; id:I; column:C; columnId:string; value:unknown; nativeEvent:MouseEvent; cancel:boolean };
  rowClick: GridEvent<S> & { item: T; id: I; nativeEvent: MouseEvent };
  cellClick: GridEvent<S> & { item: T; id: I; column: C | null; columnId: string | null; value: unknown; nativeEvent: MouseEvent };
  dataChange: GridEvent<S> & { dataEvent: DataStoreChange<T, I> };
  selectionChange: GridEvent<S> & { items: T[]; oldItems: T[] };
}
export interface GridFilterEvent<T extends object, I extends ItemId> extends GridEvent<Grid<T, I>> {
  filterModel: GridFilterModel<T>;
  operation: 'set' | 'clear' | 'clearAll';
  columnId: string | null;
  oldFilter: ColumnFilter | null;
  filter: ColumnFilter | null;
  oldFilters: Map<string, ColumnFilter> | undefined;
  filters: Map<string, ColumnFilter> | undefined;
  reason: string | undefined;
}
export interface GridSummaryEvent<T extends object, I extends ItemId> extends GridEvent<Grid<T, I>> {
  column: GridNormalizedColumn<T, I>; columnId: string;
  oldSummary: GridSummaryKind | null; summary: GridSummaryKind | null; scope: GridSummaryScope | null;
}
export interface GridEvents<T extends object, I extends ItemId = DefaultItemId<T>> extends
  GridCoreEvents<T, I, GridNormalizedColumn<T, I>, Grid<T, I>>,
  GridRowEvents<T, I, GridNormalizedColumn<T, I>, Grid<T, I>>,
  GridSourcedEvents<GridEditingEvents<T, I>, Grid<T, I>, GridNormalizedColumn<T, I>> {
  beforeRowTransfer: GridEvent<Grid<T,I>> & {sourceGrid:GridTransferPeer;targetGrid:GridTransferPeer;role:'source'|'target';mode:'move'|'copy';ids:ItemId[];sourceIds:ItemId[];items:object[];cancel:boolean;reason:string|null};
  rowTransfer: GridEvent<Grid<T,I>> & {sourceGrid:GridTransferPeer;targetGrid:GridTransferPeer;role:'source'|'target';result:DataStoreTransferResult};
  beforeRowReorder: GridEvent<Grid<T, I>> & { ids: I[]; targetId: I; position: 'before' | 'after'; cancel: boolean };
  rowReorder: GridEvent<Grid<T, I>> & { ids: I[]; targetId: I; position: 'before' | 'after' };
  layoutChange: GridEvent<Grid<T, I>> & { operation: string; layoutState: GridLayoutState<T, I> };
  viewChange: GridEvent<Grid<T, I>> & { viewEvent: DataViewChange<T, I>; reason: string | undefined };
  pageChange: GridEvent<Grid<T, I>> & { oldPageState: DataViewPageState; pageState: DataViewPageState; reason: string | undefined };
  groupChange: Omit<GridGroupChange<T>, 'source'> & { source: Grid<T, I>; groupModel: GridGroupChange<T>['source'] };
  searchChange: GridEvent<Grid<T, I>> & { oldState: GridSearchState; state: GridSearchState };
  rangeSelectionChange: GridEvent<Grid<T, I>> & { ranges: CellRange<I>[]; oldRanges: CellRange<I>[] };
  beforeFilterChange: GridFilterEvent<T, I> & { cancel: boolean };
  filterChange: GridFilterEvent<T, I> & { activeColumns: string[] };
  beforeSummaryChange: GridSummaryEvent<T, I> & { cancel: boolean };
  summaryChange: GridSummaryEvent<T, I>;
  formattingChange: GridEvent<Grid<T, I>> & { operation: 'add' | 'remove'; rule: GridNormalizedFormattingRule<T, I> };
  detailChange: GridEvent<Grid<T, I>> & { rowId: I; expanded: boolean };
  export: GridEvent<Grid<T, I>> & { exporter: GridExporter<T, I>; result: unknown; options: GridExportOptions };
  editReject: GridSourcedEvents<GridEditingEvents<T, I>, Grid<T, I>, GridNormalizedColumn<T, I>>['editReject'] & { writeResult: boolean | undefined };
  remoteLoadStart: { source: Grid<T, I>; request: GridRemoteRequest };
  remoteLoad: { source: Grid<T, I>; request: GridRemoteRequest; response: DataProviderResponse<T> };
  clipboardCopy: GridEvent<Grid<T, I>> & { text: string; ranges: CellRange<I>[] };
  clipboardCut: GridEvent<Grid<T, I>> & { text: string; ranges: CellRange<I>[] };
  clipboardPaste: GridEvent<Grid<T, I>> & { text: string; changed: number };
  searchPanelChange: GridEvent<Grid<T, I>> & { visible: boolean };
  searchNavigate: GridEvent<Grid<T, I>> & { match: { rowId: I; columnId: string; item: T }; index: number; count: number };
  sortChange: GridEvent<Grid<T, I>> & { column: GridNormalizedColumn<T, I> | null; columnId: string | null;
    direction: 'asc' | 'desc' | null; oldSortModel: GridSortRule[]; sortModel: GridSortRule[] };
}
export interface TreeGridExpandEvent<T extends object, I extends ItemId> extends GridEvent<TreeGrid<T, I>> { id: I; item: T | null }
export interface TreeGridEvents<T extends object, I extends ItemId = DefaultItemId<T>> extends
  GridCoreEvents<T, I, TreeGridNormalizedColumn<T, I>, TreeGrid<T, I>>,
  GridRowEvents<T, I, TreeGridNormalizedColumn<T, I>, TreeGrid<T, I>>,
  GridSourcedEvents<TreeGridEditingEvents<T, I>, TreeGrid<T, I>, TreeGridNormalizedColumn<T, I>> {
  beforeNodeMove: GridEvent<TreeGrid<T, I>> & TreeGridNodeMoveProposal<T, I> & { cancel:boolean; reason:string|null; nativeEvent:DragEvent|null };
  nodeMove: GridEvent<TreeGrid<T, I>> & { result:TreeGridNodeMoveResult<I> };
  editReject: GridSourcedEvents<TreeGridEditingEvents<T, I>, TreeGrid<T, I>, TreeGridNormalizedColumn<T, I>>['editReject'] & {
    validation?: CellEditorValidation; cancel?: boolean;
  };
  layoutChange: GridEvent<TreeGrid<T, I>> & { operation: string; layoutState: TreeGridLayoutState<I> };
  treeViewChange: GridEvent<TreeGrid<T, I>> & { viewEvent: TreeDataViewChange<T, I>; reason: string | undefined };
  filterChange: GridEvent<TreeGrid<T, I>> & { columnId: string; activeColumns: string[] };
  sortChange: GridEvent<TreeGrid<T, I>> & { columnId: string | null; direction: 'asc' | 'desc' | null; sortState: GridSortRule[] };
  beforeExpand: TreeGridExpandEvent<T, I> & { cancel: boolean };
  beforeCollapse: TreeGridExpandEvent<T, I> & { cancel: boolean };
  expand: TreeGridExpandEvent<T, I>;
  collapse: TreeGridExpandEvent<T, I>;
  expandAll: GridEvent<TreeGrid<T, I>>;
  collapseAll: GridEvent<TreeGrid<T, I>>;
}
