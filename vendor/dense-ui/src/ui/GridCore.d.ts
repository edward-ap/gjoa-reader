import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions, DefaultItemId, ItemId, GridColumnModel, GridColumnState, MutationOptions } from '../core/index.js';
import type { GridEditorColumn } from './grid-editor-contracts.js';
import type { GridCoreEvents } from './grid-events.js';

export interface GridCoreOptions<T extends object, I extends ItemId = DefaultItemId<T>> extends BaseControlOptions {
  columns?: readonly GridEditorColumn<T, I>[];
  css?: string;
  rowHeight?: number | string | null;
  virtualRows?: boolean;
  virtualOverscan?: number;
  /** Decorative selection gutter; not a data column. Defaults to true. */
  indicatorGutter?: boolean;
  /** Global menu; defaults to columnMenu, and is disabled when the gutter is off. */
  gridMenu?: boolean;
  columnMenu?: boolean;
  columnReorder?: boolean;
}
/** Shared renderer/control foundation. Concrete tables own their data and editing APIs. */
export declare class GridCore<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>,
  E extends { [K in keyof E]: object } = GridCoreEvents<T, I, GridEditorColumn<T, I>, GridCore<T, I, {}>>,
  C extends GridEditorColumn<T, I> = GridEditorColumn<T, I>> extends BaseControl<E, HTMLElement> {
  constructor(options?: GridCoreOptions<T, I>, coreOptions?: { columns?: C[] });
  readonly columns: C[];
  readonly columnModel: GridColumnModel<C>;
  readonly css: string;
  readonly rowHeight: number | string | null;
  readonly virtualRows: boolean;
  readonly virtualOverscan: number;
  readonly indicatorGutterEnabled: boolean;
  readonly gridMenuEnabled: boolean;
  readonly columnMenuEnabled: boolean;
  readonly columnReorderEnabled: boolean;
  getColumn(id: string | null | undefined): C | null;
  getCoreLayoutState(): { version: 1; columns: GridColumnState<string>[] };
  moveColumn(id: string, index: number, options?: MutationOptions): boolean;
  hideColumn(id: string, options?: MutationOptions): boolean;
  showColumn(id: string, options?: MutationOptions): boolean;
  freezeColumn(id: string, side?: 'left' | 'right' | null | false, options?: MutationOptions): boolean;
  unfreezeColumn(id: string, options?: MutationOptions): boolean;
  autoSizeColumn(id: string, options?: MutationOptions): boolean;
  autoSizeColumns(options?: MutationOptions): boolean;
  destroy(): void;
}
