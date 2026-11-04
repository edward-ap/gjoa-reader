import type { DefaultItemId, ItemId, MutationOptions } from '../core/index.js';
import type { Grid } from './Grid.js';
import type { TreeGrid } from './TreeGrid.js';
import type { GridCore } from './GridCore.js';
import type { GridEditorColumn } from './grid-editor-contracts.js';

export type GridControllerOwner<T extends object, I extends ItemId> = Grid<T, I> | TreeGrid<T, I>;
export interface GridNavigationOptions<T, R = T> {
  rows?: readonly R[]; itemOf?: (row: R) => T; activeIndex?: number;
  onLeft?: (options: MutationOptions) => boolean;
  onRight?: (options: MutationOptions) => boolean;
}
export declare class GridKeyboardController<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> {
  constructor(grid: GridControllerOwner<T, I>);
  readonly grid: GridControllerOwner<T, I> | null;
  handleNavigation<R = T>(event: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>>, options?: GridNavigationOptions<T, R>): boolean;
  destroy(): void;
}
export declare class GridSelectionController<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> {
  constructor(grid: GridControllerOwner<T, I>);
  readonly grid: GridControllerOwner<T, I> | null;
  selectFromUser(item: T, nativeEvent?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): boolean;
  selectOnly(item: T, options?: MutationOptions): boolean;
  selectActive<R = T>(rows: readonly R[], options?: MutationOptions & { itemOf?: (row: R) => T }): boolean;
  destroy(): void;
}
export declare class GridColumnReorderController<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> {
  constructor(grid: GridCore<T, I> | GridControllerOwner<T, I>);
  readonly grid: GridCore<T, I> | GridControllerOwner<T, I> | null;
  readonly state: { columnId: string; side: 'left' | 'right' | null; targetId?: string; after?: boolean } | null;
  attach(cell: HTMLElement, column: GridEditorColumn<T, I>): void;
  start(event: DragEvent, column: GridEditorColumn<T, I>): boolean;
  over(event: DragEvent, targetColumn: GridEditorColumn<T, I>, cell: HTMLElement): boolean;
  drop(event: DragEvent, targetColumn: GridEditorColumn<T, I>): boolean;
  clearMarkers(): void;
  finish(): void;
  destroy(): void;
}
export declare class GridColumnResizer<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> {
  constructor(grid: GridCore<T, I> | GridControllerOwner<T, I>);
  readonly grid: GridCore<T, I> | GridControllerOwner<T, I> | null;
  readonly state: { column: GridEditorColumn<T, I>; startX: number; startWidth: number;
    adjacentColumn: GridEditorColumn<T, I> | null; adjacentWidth: number | null } | null;
  readonly tracking: { dispose(): void } | null;
  start(event: PointerEvent, column: GridEditorColumn<T, I>): boolean;
  update(event: Pick<PointerEvent, 'clientX'>): boolean;
  finish(): boolean;
  destroy(): void;
}
export interface GridRenderRange { start: number; end: number; topHeight: number; bottomHeight: number; rowHeight: number }
export declare class GridVirtualRenderer<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> {
  constructor(grid: GridCore<T, I> | GridControllerOwner<T, I>);
  readonly grid: GridCore<T, I> | GridControllerOwner<T, I> | null;
  readonly lastScrollTop: number;
  getRange(rowCount: number, virtualRows?: boolean): GridRenderRange;
  getRowHeight(): number;
  createSpacer(height: number, position: string): HTMLDivElement;
  handleScroll(callback?: () => void): boolean;
  resetScroll(): void;
  scrollIndexIntoView(rowIndex: number): boolean;
  destroy(): void;
}
