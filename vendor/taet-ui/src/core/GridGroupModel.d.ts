import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, ItemId, MutationOptions } from './contracts.js';

export interface GridGroupSummary<C extends ItemId = string> {
  columnId: C;
  kind?: 'sum' | 'total' | 'count' | 'min' | 'max' | 'average';
  label?: string;
}
export interface GridGroupRule<C extends ItemId = string> {
  columnId: C;
  label?: string | null;
  summaries?: readonly GridGroupSummary<C>[];
}
export type GridGroupRuleInput<C extends ItemId = string> = Extract<C, string> | GridGroupRule<C> |
  (Omit<GridGroupRule<C>, 'columnId'> & { column: C });
export interface GridGroupState<C extends ItemId = string> { rules: GridGroupRule<C>[]; collapsed: string[] }
export interface GridGroupOptions<C extends ItemId = string> {
  rules?: readonly GridGroupRuleInput<C>[];
  collapsed?: Iterable<string>;
}
export interface GridGroupItemEntry<T> { type: 'item'; item: T; rowIndex: number }
export interface GridGroupHeaderEntry<T, C extends ItemId = string> {
  type: 'group';
  level: number;
  key: string;
  path: string;
  columnId: C;
  label: string;
  count: number;
  collapsed: boolean;
  items: T[];
  summaries: (GridGroupSummary<C> & { value: number | null })[];
}
export type GridGroupEntry<T, C extends ItemId = string> = GridGroupItemEntry<T> | GridGroupHeaderEntry<T, C>;
export type GridGroupValueResolver<T, C extends ItemId = string> = (item: T, columnId: C, rowIndex: number) => unknown;
export interface GridGroupInvalidation<T, C extends ItemId = string> {
  source: GridGroupModel<T, C>;
  operation: 'rules' | 'toggle' | 'restore';
}
export interface GridGroupChange<T, C extends ItemId = string> extends GridGroupInvalidation<T, C> {
  state: GridGroupState<C>;
  origin: ChangeOrigin;
  userAction: boolean;
}
export interface GridGroupEvents<T, C extends ItemId = string> {
  invalidate: GridGroupInvalidation<T, C>;
  change: GridGroupChange<T, C>;
}
/** Experimental grouping projection; does not own input records. */
export declare class GridGroupModel<T = Record<string, unknown>, C extends ItemId = string> {
  constructor(options?: GridGroupOptions<C>);
  readonly events: EventBus<GridGroupEvents<T, C>>;
  readonly destroyed: boolean;
  get(): GridGroupRule<C>[];
  hasAny(): boolean;
  set(rules: readonly GridGroupRuleInput<C>[], options?: MutationOptions): boolean;
  clear(options?: MutationOptions): boolean;
  /** Returns the new expanded state, not whether a change occurred. */
  toggle(path: string, options?: MutationOptions): boolean;
  entries(items: readonly T[], getValue: GridGroupValueResolver<T, C>): GridGroupEntry<T, C>[];
  getState(): GridGroupState<C>;
  restoreState(state?: GridGroupOptions<C> | null, options?: MutationOptions): void;
  destroy(): void;
}
