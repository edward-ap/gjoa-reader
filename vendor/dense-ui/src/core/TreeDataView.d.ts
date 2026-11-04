import type { DataStore, DefaultItemId } from './DataStore.js';
import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, ItemId, MutationMetadataOptions } from './contracts.js';

export type TreeDataViewFilter<T extends object> = (item: T) => boolean;
export type TreeDataViewSort<T extends object> = (left: T, right: T) => number;
export interface TreeDataViewOptions<T extends object, I extends ItemId = DefaultItemId<T>> {
  data: DataStore<T, I>;
  parentField?: Extract<keyof T, string>;
  /** The root marker can have a different scalar type from record IDs. */
  rootParentId?: ItemId | null;
  filter?: TreeDataViewFilter<T> | null;
  sort?: TreeDataViewSort<T> | null;
  expandedIds?: Iterable<I>;
  expandAll?: boolean;
}
export interface TreeDataViewEntry<T extends object, I extends ItemId = DefaultItemId<T>> {
  item: T;
  id: I;
  /** Parent fields are application data and are not validated by the tree. */
  parentId: unknown;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
}
export interface TreeDataViewEvent<T extends object, I extends ItemId = DefaultItemId<T>> {
  source: TreeDataView<T, I>;
  origin: ChangeOrigin;
  userAction: boolean;
}
export interface TreeDataViewChange<T extends object, I extends ItemId = DefaultItemId<T>>
  extends TreeDataViewEvent<T, I> {
  /** Snapshot arrays materialize when first read and retain their emission-time version. */
  oldEntries: TreeDataViewEntry<T, I>[];
  entries: TreeDataViewEntry<T, I>[];
  oldIds: I[];
  ids: I[];
  reason: string | undefined;
  operation: string | undefined;
}
export interface TreeDataViewEvents<T extends object, I extends ItemId = DefaultItemId<T>> {
  change: TreeDataViewChange<T, I>;
  afterChange: TreeDataViewChange<T, I>;
  invalidate: TreeDataViewChange<T, I> & { silent: boolean };
  expand: TreeDataViewEvent<T, I> & { id: I; item: T | null };
  collapse: TreeDataViewEvent<T, I> & { id: I; item: T | null };
  expandAll: TreeDataViewEvent<T, I>;
  collapseAll: TreeDataViewEvent<T, I>;
}
export declare class TreeDataView<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> {
  constructor(options: TreeDataViewOptions<T, I>);
  data: DataStore<T, I> | null;
  parentField: Extract<keyof T, string> | 'parentId';
  rootParentId: ItemId | null;
  events: EventBus<TreeDataViewEvents<T, I>>;
  readonly destroyed: boolean;
  all(): T[];
  entries(): TreeDataViewEntry<T, I>[];
  get(id: I): T | undefined;
  getEntry(id: I): TreeDataViewEntry<T, I> | null;
  has(id: I): boolean;
  idOf(item: T, index?: number): I;
  parentIdOf(item: T): unknown;
  hasChildren(id: I): boolean;
  isExpanded(idOrItem: I | T): boolean;
  getExpandedIds(): I[];
  /** Global predicate shared with an attached TreeGrid, excluding its local conditions. */
  getFilter(): TreeDataViewFilter<T> | null;
  getSort(): TreeDataViewSort<T> | null;
  setFilter(filter: TreeDataViewFilter<T> | null, options?: MutationMetadataOptions): boolean;
  setSort(sort: TreeDataViewSort<T> | null, options?: MutationMetadataOptions): boolean;
  expand(idOrItem: I | T, options?: MutationMetadataOptions): boolean;
  collapse(idOrItem: I | T, options?: MutationMetadataOptions): boolean;
  toggle(idOrItem: I | T, options?: MutationMetadataOptions): boolean;
  expandAll(options?: MutationMetadataOptions): boolean;
  collapseAll(options?: MutationMetadataOptions): boolean;
  refresh(options?: MutationMetadataOptions): boolean;
  destroy(): void;
}
