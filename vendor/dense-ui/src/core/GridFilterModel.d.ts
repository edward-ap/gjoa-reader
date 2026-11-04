import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, MutationMetadataOptions } from './contracts.js';

export type TextFilterOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty';
export type NumberFilterOperator = 'equals' | 'notEquals' | 'greater' | 'greaterOrEqual' | 'less' | 'lessOrEqual' | 'between';
export type DateFilterOperator = 'on' | 'before' | 'after' | 'between' | 'empty' | 'notEmpty';
export type DateFilterValue = string | number | Date;
export type ColumnFilterInput =
  | { kind: 'values'; values: readonly unknown[]; includeEmpty?: boolean }
  | { kind: 'text'; operator: TextFilterOperator; value?: string; caseSensitive?: boolean }
  | { kind: 'number'; operator: Exclude<NumberFilterOperator, 'between'>; value: number | string }
  | { kind: 'number'; operator: 'between'; value: number | string; valueTo: number | string }
  | { kind: 'date'; operator: 'empty' | 'notEmpty'; value?: string }
  | { kind: 'date'; operator: 'on' | 'before' | 'after'; value: DateFilterValue }
  | { kind: 'date'; operator: 'between'; value: DateFilterValue; valueTo: DateFilterValue }
  | { kind: 'boolean'; value: boolean };
/** Normalized filters returned in snapshots and events. */
export type ColumnFilter =
  | { kind: 'values'; values: unknown[]; includeEmpty: boolean }
  | { kind: 'text'; operator: TextFilterOperator; value: string; caseSensitive: boolean }
  | { kind: 'number'; operator: Exclude<NumberFilterOperator, 'between'>; value: number }
  | { kind: 'number'; operator: 'between'; value: number; valueTo: number }
  | { kind: 'date'; operator: 'empty' | 'notEmpty'; value: string }
  | { kind: 'date'; operator: 'on' | 'before' | 'after'; value: string }
  | { kind: 'date'; operator: 'between'; value: string; valueTo: string }
  | { kind: 'boolean'; value: boolean };
export interface GridFilterOptions<C extends string = string> {
  filters?: ReadonlyMap<C, ColumnFilterInput> | Partial<Record<C, ColumnFilterInput>>;
}
export type GridFilterMutation<C extends string = string> =
  | { operation: 'set'; columnId: C; oldFilter: ColumnFilter | null; filter: ColumnFilter }
  | { operation: 'clear'; columnId: C; oldFilter: ColumnFilter; filter: null }
  | { operation: 'clearAll'; columnId: null; oldFilter: null; filter: null;
      oldFilters: Map<C, ColumnFilter>; filters: Map<C, ColumnFilter> };
export type GridFilterChange<T, C extends string = string> = GridFilterMutation<C> & {
  source: GridFilterModel<T, C>;
  origin: ChangeOrigin;
  reason: string | undefined;
  userAction: boolean;
};
export interface GridFilterEvents<T, C extends string = string> {
  beforeChange: GridFilterChange<T, C> & { cancel: boolean };
  change: GridFilterChange<T, C> & { activeColumns: C[] };
  afterChange: GridFilterChange<T, C> & { activeColumns: C[] };
  invalidate: GridFilterChange<T, C> & { activeColumns: C[]; silent: boolean };
}
export type GridFilterValueResolver<T, C extends string = string> = (item: T, columnId: C) => unknown;
/** Experimental AND-composed column filters; snapshots clone wrappers, not value objects. */
export declare class GridFilterModel<T = Record<string, unknown>, C extends string = string> {
  constructor(options?: GridFilterOptions<C>);
  readonly events: EventBus<GridFilterEvents<T, C>>;
  readonly destroyed: boolean;
  get(columnId: C): ColumnFilter | null;
  all(): Map<C, ColumnFilter>;
  activeColumns(): C[];
  hasAny(): boolean;
  set(columnId: C, filter: ColumnFilterInput, options?: MutationMetadataOptions): boolean;
  clear(columnId: C, options?: MutationMetadataOptions): boolean;
  clearAll(options?: MutationMetadataOptions): boolean;
  matches(item: T, getValue: GridFilterValueResolver<T, C>): boolean;
  /** A live predicate over current filters, or null when no filter exists at creation. */
  createPredicate(getValue: GridFilterValueResolver<T, C>): ((item: T) => boolean) | null;
  destroy(): void;
}
