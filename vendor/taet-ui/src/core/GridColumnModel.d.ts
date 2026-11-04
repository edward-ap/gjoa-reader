import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, ItemId, MutationOptions } from './contracts.js';

/** Layout fields managed by the model, not the complete Grid column schema. */
export interface GridModelColumn<C extends ItemId = ItemId> {
  id: C;
  width?: number | string | null;
  hidden?: boolean;
  frozen?: 'left' | 'right' | null;
}
/** Other column properties are preserved; layout properties can change after construction. */
export type GridManagedColumn<T extends GridModelColumn> = Omit<T, 'width' | 'hidden' | 'frozen'> &
  Pick<GridModelColumn, 'width' | 'hidden' | 'frozen'>;
export interface GridColumnState<C extends ItemId = ItemId> {
  id: C;
  order: number;
  width: number | string | null;
  hidden: boolean;
  frozen: 'left' | 'right' | null;
}
export type GridColumnRestoreEntry<C extends ItemId = ItemId> = Pick<GridColumnState<C>, 'id'> & Partial<Omit<GridColumnState<C>, 'id'>>;
export interface GridColumnChange<T extends GridModelColumn = GridModelColumn> {
  source: GridColumnModel<T>;
  operation: 'replace' | 'move' | 'visibility' | 'freeze' | 'width' | 'restore';
  oldState: GridColumnState<T['id']>[];
  state: GridColumnState<T['id']>[];
  origin: ChangeOrigin;
  userAction: boolean;
}
export interface GridColumnEvents<T extends GridModelColumn = GridModelColumn> {
  invalidate: GridColumnChange<T> & { silent: boolean };
  change: GridColumnChange<T>;
}
/** Experimental. Retains and mutates the input array and column objects. */
export declare class GridColumnModel<T extends GridModelColumn = GridModelColumn> {
  constructor(columns?: T[]);
  readonly events: EventBus<GridColumnEvents<T>>;
  readonly destroyed: boolean;
  all(): GridManagedColumn<T>[];
  visible(): GridManagedColumn<T>[];
  get(id: T['id']): GridManagedColumn<T> | null;
  replace(columns: T[], options?: MutationOptions): void;
  replace(columns: GridManagedColumn<T>[], options?: MutationOptions): void;
  move(id: T['id'], targetIndex: number, options?: MutationOptions): boolean;
  setHidden(id: T['id'], hidden: boolean, options?: MutationOptions): boolean;
  setFrozen(id: T['id'], frozen: 'left' | 'right' | null | false, options?: MutationOptions): boolean;
  setWidth(id: T['id'], width: number | string | null, options?: MutationOptions): boolean;
  getState(): GridColumnState<T['id']>[];
  restoreState(state: readonly GridColumnRestoreEntry<T['id']>[], options?: MutationOptions): boolean;
  /** Idempotent. Releases columns/subscriptions; later reads and mutations throw. */
  destroy(): void;
}
