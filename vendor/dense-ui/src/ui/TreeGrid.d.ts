import { GridCore } from './GridCore.js';
import type { DefaultItemId, ItemId, DataStore, TreeDataView, SelectionModel, MutationMetadataOptions } from '../core/index.js';
import type { TreeGridOptions, TreeGridLayoutState, TreeGridLayoutRestore, TreeGridFilter, TreeGridColumnFilter, GridClearFilterOptions, TreeGridNodeDropPosition, TreeGridNodeMoveOptions, TreeGridNodeMoveResult } from './grid-options.js';
import type { TreeGridColumn, TreeGridNormalizedColumn, GridSortRule } from './grid-columns.js';
import type { TreeGridEvents } from './grid-events.js';

export declare class TreeGrid<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>
  extends GridCore<T, I, TreeGridEvents<T, I>, TreeGridNormalizedColumn<T, I>> {
  constructor(options?: TreeGridOptions<T, I>);
  constructor(container: HTMLElement | string, options?: TreeGridOptions<T, I>);
  readonly data: DataStore<T, I>;
  readonly treeView: TreeDataView<T, I>;
  readonly selection: SelectionModel<T>;
  readonly treeColumnId: string | null;
  readonly nodeReorderEnabled: boolean;
  readonly multiSelect: boolean;
  readonly rowRangeSelection: boolean;
  readonly virtualColumns: boolean;
  readonly searchPanelVisible: boolean;
  readonly parentField: string;
  readonly rootParentId: ItemId | null;
  readonly textField: string | ((item: T) => unknown);
  readonly iconField: string;
  readonly nodeIcon: TreeGridOptions<T, I>['nodeIcon'];
  readonly expandOnClick: boolean;
  readonly statusBarOptions: { visible: boolean };
  moveNode(id: I, targetId: I | null, position?: TreeGridNodeDropPosition, options?: TreeGridNodeMoveOptions): TreeGridNodeMoveResult<I>;
  moveNodes(ids: readonly I[], targetId: I | null, position?: TreeGridNodeDropPosition, options?: TreeGridNodeMoveOptions): TreeGridNodeMoveResult<I>;
  setColumns(columns: readonly TreeGridColumn<T, I>[]): this;
  getLayoutState(): TreeGridLayoutState<I>;
  restoreLayoutState(state: TreeGridLayoutRestore<I>, options?: MutationMetadataOptions): this;
  getSelectedIds(): I[];
  setSelectedIds(ids: I | readonly I[], options?: MutationMetadataOptions): boolean;
  selectById(id: I, options?: MutationMetadataOptions): boolean;
  clearSelection(options?: MutationMetadataOptions): boolean;
  setFilter(filter: TreeGridFilter<T> | null, options?: MutationMetadataOptions): boolean;
  clearFilter(options?: MutationMetadataOptions): boolean;
  /** Same global predicate as the supplied TreeDataView; column/search filters are separate. */
  getFilter(): TreeGridFilter<T> | null;
  setColumnFilter(columnId: string, filter: TreeGridColumnFilter<T>, options?: MutationMetadataOptions): boolean;
  clearColumnFilter(columnId: string, options?: MutationMetadataOptions): boolean;
  clearAllFilters(options?: GridClearFilterOptions): boolean;
  setSearchQuery(query: string | null, options?: MutationMetadataOptions): boolean;
  sortBy(columnId: string, direction?: 'asc' | 'desc', options?: MutationMetadataOptions): boolean;
  clearSort(options?: MutationMetadataOptions): boolean;
  getSortState(): GridSortRule[];
  getSortModel(): GridSortRule[];
  startEdit(itemOrId?: T | I | null, columnId?: string | null, options?: MutationMetadataOptions): boolean;
  commitEdit(options?: MutationMetadataOptions): boolean;
  cancelEdit(options?: MutationMetadataOptions): boolean;
  expand(idOrItem: I | T, options?: MutationMetadataOptions): boolean;
  collapse(idOrItem: I | T, options?: MutationMetadataOptions): boolean;
  toggle(idOrItem: I | T, options?: MutationMetadataOptions): boolean;
  expandAll(options?: MutationMetadataOptions): boolean;
  collapseAll(options?: MutationMetadataOptions): boolean;
  isExpanded(idOrItem: I | T): boolean;
}
