import type { DefaultItemId, ItemId, DataViewContext } from '../core/index.js';
import type { GridEditorColumn } from './grid-editor-contracts.js';
import type { Grid } from './Grid.js';

export type GridSummaryKind = 'count' | 'total' | 'min' | 'max' | 'average' | 'custom';
export type GridSummaryScope = 'page' | 'filtered' | 'all' | 'selection';
export type GridSummaryValue<T extends object, I extends ItemId = DefaultItemId<T>> =
  string | number | boolean | Node | null | ((rows: T[], column: GridColumn<T, I>, grid: Grid<T, I>) => unknown);
export type GridSummary<T extends object, I extends ItemId = DefaultItemId<T>> =
  | { kind: Exclude<GridSummaryKind, 'custom'>; scope?: GridSummaryScope }
  | { kind: 'custom'; value: GridSummaryValue<T, I>; scope?: GridSummaryScope };
export type GridSummaryInput<T extends object, I extends ItemId = DefaultItemId<T>> =
  Exclude<GridSummaryKind, 'custom'> | 'none' | false | null | GridSummary<T, I>;
export type GridNormalizedSummary<T extends object, I extends ItemId = DefaultItemId<T>> = GridSummary<T, I> & { scope: GridSummaryScope };
export interface GridSortRule { columnId: string; direction: 'asc' | 'desc' }
export type GridSortDirection = 'asc' | 'desc' | 'ascending' | 'descending' | 'none' | null | false;
export interface GridSortInput { columnId: string; direction: GridSortDirection }

/** Column options consumed by Grid, including the shared editing contract. */
export interface GridColumn<T extends object, I extends ItemId = DefaultItemId<T>> extends GridEditorColumn<T, I> {
  dataType?: 'text' | 'number' | 'boolean' | 'date';
  searchable?: boolean;
  filterable?: boolean;
  filterType?: 'values' | 'text' | 'number' | 'boolean' | 'date';
  conditionFilterType?: 'text' | 'number' | 'date';
  filterText?: (value: unknown, column: GridColumn<T, I>) => unknown;
  sort?: (left: T, right: T, context: DataViewContext<T, I> & {
    column: GridColumn<T, I>; columnId: string; direction: 'asc' | 'desc'; grid: Grid<T, I>
  }) => number;
  summary?: GridSummaryInput<T, I>;
  footer?: GridSummaryValue<T, I>;
  summaryFormat?: (value: number, context: { source: Grid<T, I>; grid: Grid<T, I>;
    column: GridColumn<T, I>; columnId: string; kind: Exclude<GridSummaryKind, 'custom'> }) => unknown;
}
export type GridNormalizedColumn<T extends object, I extends ItemId = DefaultItemId<T>> =
  Omit<GridColumn<T, I>, 'summary'> & { summary: GridNormalizedSummary<T, I> | null;
    minWidth: number; maxWidth: number | null; resizable: boolean };
/** TreeGrid uses its own simple sort/filter implementation, without Grid summaries. */
export interface TreeGridColumn<T extends object, I extends ItemId = DefaultItemId<T>> extends GridEditorColumn<T, I> {
  filterable?: boolean;
  /** Tree sorting/filtering call value without an index; rendering/edit creation supply it. */
  value?: (item: T, rowIndex?: number) => unknown;
}
export type TreeGridNormalizedColumn<T extends object, I extends ItemId = DefaultItemId<T>> =
  TreeGridColumn<T, I> & { minWidth: number; maxWidth: number | null; resizable: boolean };
