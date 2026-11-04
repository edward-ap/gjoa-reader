import type { DefaultItemId, ItemId, MutationMetadataOptions } from '../core/index.js';
import type { GridColumn } from './grid-columns.js';
import type { Grid } from './Grid.js';

export interface GridExportOptions extends MutationMetadataOptions { includeHidden?: boolean; scope?: 'selection' | 'page' | 'filtered' }
export interface GridExportContext<T extends object, I extends ItemId = DefaultItemId<T>> {
  source: Grid<T, I>; grid: Grid<T, I>; columns: GridColumn<T, I>[]; rows: T[];
  getValue: (item: T, column: GridColumn<T, I>) => unknown;
  options: GridExportOptions;
}
export interface GridExporter<T extends object, I extends ItemId = DefaultItemId<T>, R = unknown> {
  export(context: GridExportContext<T, I>): R;
}
export interface DelimitedExporterOptions {
  delimiter?: string; includeHeaders?: boolean;
  /** Prefix formula-like strings with an apostrophe for spreadsheet-oriented export. Default false. */
  escapeFormulas?: boolean;
}
export interface GridWorkbook {
  type: 'workbook';
  sheets: { name: string; columns: { id: string; title: string }[]; rows: unknown[][] }[];
}
/** A generic built-in exporter can consume any record schema without a cast. */
export interface GenericGridExporter<R> {
  export<T extends object, I extends ItemId = DefaultItemId<T>>(context: GridExportContext<T, I>): R;
}
export declare function createDelimitedExporter(options?: DelimitedExporterOptions): GenericGridExporter<string>;
export declare const gridExporters: Readonly<{
  csv(options?: DelimitedExporterOptions): GenericGridExporter<string>;
  tsv(options?: DelimitedExporterOptions): GenericGridExporter<string>;
  workbook(options?: { sheetName?: string }): GenericGridExporter<GridWorkbook>;
}>;
