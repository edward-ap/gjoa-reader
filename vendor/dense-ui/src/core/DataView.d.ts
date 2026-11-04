import type { DataStore, DefaultItemId } from './DataStore.js';
import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, ItemId, MutationMetadataOptions } from './contracts.js';

export interface DataViewPageState {
  enabled: boolean;
  page: number;
  pageSize: number | null;
  pageCount: number;
  filteredCount: number;
  pageItemCount: number;
  from: number;
  to: number;
  canGoFirst: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  canGoLast: boolean;
}
export interface DataViewProjectionOptions extends MutationMetadataOptions { keepPage?: boolean }
export interface DataViewContext<T extends object, I extends ItemId = DefaultItemId<T>> {
  data: DataStore<T, I>;
  view: DataView<T, I>;
}
export type DataViewFilter<T extends object, I extends ItemId = DefaultItemId<T>> =
  (item: T, context: DataViewContext<T, I> & { index: number; id: I }) => boolean;
export type DataViewSort<T extends object, I extends ItemId = DefaultItemId<T>> =
  (left: T, right: T, context: DataViewContext<T, I>) => number;
export interface DataViewOptions<T extends object, I extends ItemId = DefaultItemId<T>> {
  data: DataStore<T, I>;
  filter?: DataViewFilter<T, I> | null;
  sort?: DataViewSort<T, I> | null;
  page?: number;
  pageSize?: number | null | false;
}
export interface DataViewChange<T extends object, I extends ItemId = DefaultItemId<T>> {
  source: DataView<T, I>;
  oldItems: T[];
  items: T[];
  oldIds: I[];
  ids: I[];
  oldPageState: DataViewPageState;
  pageState: DataViewPageState;
  origin: ChangeOrigin;
  userAction: boolean;
  reason: string | undefined;
  operation: string | undefined;
}
export interface DataViewEvents<T extends object, I extends ItemId = DefaultItemId<T>> {
  change: DataViewChange<T, I>;
  afterChange: DataViewChange<T, I>;
  invalidate: DataViewChange<T, I> & { silent: boolean };
}
export declare class DataView<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> {
  constructor(options: DataViewOptions<T, I>);
  /** Released on destroy; the external store is not destroyed. */
  data: DataStore<T, I> | null;
  events: EventBus<DataViewEvents<T, I>>;
  readonly destroyed: boolean;
  /** Current page. projectedAll() returns the filtered/sorted projection before paging. */
  all(): T[];
  projectedAll(): T[];
  get(id: I): T | undefined;
  has(id: I): boolean;
  idOf(item: T, index?: number): I;
  indexOf(idOrItem: I | T): number;
  setFilter(filter: DataViewFilter<T, I> | null, options?: DataViewProjectionOptions): boolean;
  clearFilter(options?: DataViewProjectionOptions): boolean;
  /** Global predicate; an attached Grid's column/search composition remains internal. */
  getFilter(): DataViewFilter<T, I> | null;
  setSort(sort: DataViewSort<T, I> | null, options?: DataViewProjectionOptions): boolean;
  clearSort(options?: DataViewProjectionOptions): boolean;
  getSort(): DataViewSort<T, I> | null;
  setPage(page: number, options?: MutationMetadataOptions): boolean;
  setPageSize(pageSize: number | null | false, options?: DataViewProjectionOptions): boolean;
  clearPaging(options?: DataViewProjectionOptions): boolean;
  getPageState(): DataViewPageState;
  refresh(options?: MutationMetadataOptions): boolean;
  destroy(): void;
}
