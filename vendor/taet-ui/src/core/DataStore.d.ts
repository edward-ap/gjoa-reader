import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, ItemId, MutationOptions } from './contracts.js';

export type DefaultItemId<TItem> = TItem extends { id: infer TId extends ItemId } ? TId : ItemId;
export interface DataStoreOptions<TItem extends object, TId extends ItemId> {
  idField?: Extract<keyof TItem, string>;
  getId?: ((item: TItem, index: number) => TId) | null;
}
export interface DataStoreTransferOptions<TSource extends object, TTarget extends object> extends Omit<MutationOptions, 'silent'> {
  mode?: 'move' | 'copy';
  /** Complete target record, including its explicit ID. Synchronous; no deep clone. */
  mapItem?: (item: Readonly<TSource>, index: number) => TTarget;
}
export type DataStoreTransferArguments<S extends object, T extends object> = [S] extends [T]
  ? [options?: DataStoreTransferOptions<S,T>]
  : [options: DataStoreTransferOptions<S,T> & {mapItem:(item:Readonly<S>,index:number)=>T}];
export interface DataStoreTransferResult<I extends ItemId = ItemId, S extends ItemId = ItemId> {
  accepted: boolean;
  mode: 'move' | 'copy';
  ids: I[];
  sourceIds: S[];
  reason: string | null;
  /** Committed results remain accepted when an observer throws. Never blindly retry. */
  notificationErrors: unknown[];
}
export interface DataStoreWriteOptions extends MutationOptions { strict?: boolean }
export interface DataStoreBatchOptions extends MutationOptions { history?: boolean }

interface StoreEventBase<TItem extends object, TId extends ItemId> {
  source: DataStore<TItem, TId>;
  origin: ChangeOrigin;
  userAction: boolean;
  /** EventBus preserves an existing type; do not assume it equals the subscription name. */
  type?: string;
}
export type DataStoreMutation<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> =
  StoreEventBase<TItem, TId> & { cancel: boolean } & (
    | { operation: 'parse' | 'clear'; oldItems: TItem[]; items: TItem[] }
    | { operation: 'add' | 'remove'; id: TId; item: TItem }
    | { operation: 'update'; id: TId; item: TItem; oldItem: TItem; newItem: TItem; patch: Partial<TItem>; newId?: TId }
  );
export type DataStoreBatch<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> =
  StoreEventBase<TItem, TId> & { operation: 'batch'; oldItems: TItem[]; items: TItem[]; changes: DataStoreMutation<TItem, TId>[] };
export type DataStoreChange<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> =
  DataStoreMutation<TItem, TId> | DataStoreBatch<TItem, TId>;
export interface DataStoreEvents<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> {
  beforeChange: DataStoreMutation<TItem, TId> & { silent: boolean };
  change: DataStoreChange<TItem, TId>;
  afterChange: DataStoreChange<TItem, TId>;
  /** Dependency notification; emitted even for silent mutations. */
  invalidate: DataStoreChange<TItem, TId> & { silent: boolean };
}

export declare class DataStore<TItem extends object = Record<string, unknown>, TId extends ItemId = DefaultItemId<TItem>> {
  constructor(options?: DataStoreOptions<TItem, TId>);
  idField: Extract<keyof TItem, string> | 'id';
  getId: ((item: TItem, index: number) => TId) | null;
  events: EventBus<DataStoreEvents<TItem, TId>>;
  readonly destroyed: boolean;
  parse(items: readonly TItem[], options?: MutationOptions): boolean;
  all(): TItem[];
  get(id: TId): TItem | undefined;
  add(item: TItem, options?: MutationOptions): boolean;
  update(id: TId, patch: Partial<TItem>, options?: DataStoreWriteOptions): boolean;
  remove(id: TId, options?: DataStoreWriteOptions): boolean;
  clear(options?: MutationOptions): boolean;
  /** Synchronous transaction; nested batches share it. Returned promises are not awaited. */
  batch<TResult>(callback: (store: this) => TResult, options?: DataStoreBatchOptions): TResult;
  /** Atomic local store-pair write; same-store/transactions reject, successful move clears both histories. */
  transferTo<U extends object, J extends ItemId>(target: DataStore<U, J>, ids: readonly TId[], ...options: DataStoreTransferArguments<TItem, NoInfer<U>>): DataStoreTransferResult<J, TId>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Returns false during an active batch or if a nested write invalidates this replay. */
  undo(options?: MutationOptions): boolean;
  /** Returns false during an active batch or if a nested write invalidates this replay. */
  redo(options?: MutationOptions): boolean;
  idOf(item: TItem, index?: number): TId;
  destroy(): void;
}
