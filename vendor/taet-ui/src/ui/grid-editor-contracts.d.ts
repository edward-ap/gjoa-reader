import type { DataStore, DefaultItemId, EventBus, ItemId, MutationMetadataOptions,
  ChangeOrigin, ValueApi } from '../core/index.js';

/** Common editing surface only; not a declaration of the entire Grid or TreeGrid. */
export interface GridEditorHost<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> {
  readonly data: DataStore<TItem, TId>;
  readonly destroyed: boolean;
  readonly events: EventBus<SharedGridEditingEvents<TItem, TId>>;
  /** True only while this activation's mounted editor survives callbacks. Unmounted/recursive starts return false. */
  startEdit(itemOrId?: TItem | TId, columnId?: string, options?: MutationMetadataOptions): boolean;
  /** Attempt metadata defaults to api/false. Silent commits still validate and synchronize UI. */
  commitEdit(options?: MutationMetadataOptions): boolean;
  /** Cancellation provenance belongs to this action; defaults to api/false, not edit-start metadata. */
  cancelEdit(options?: MutationMetadataOptions): boolean;
}

/** Shared column options used by editing recipes, not the full filter/summary schema. */
export interface GridEditorColumn<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> {
  id: string;
  field?: Extract<keyof TItem, string>;
  title?: string;
  label?: string;
  width?: number | string | null;
  minWidth?: number;
  maxWidth?: number | null;
  resizable?: boolean;
  hidden?: boolean;
  frozen?: 'left' | 'right' | null;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  readOnly?: boolean | ((item: TItem, column: GridEditorColumn<TItem, TId>) => boolean);
  value?: (item: TItem, rowIndex: number) => unknown;
  render?: (value: unknown, item: TItem, column: GridEditorColumn<TItem, TId>, rowIndex: number) => unknown;
  set?: (item: TItem, value: unknown, context: GridCellWriteContext<TItem, TId>) => boolean | void;
  /** During editability checks the resolver receives null (Grid) or undefined (TreeGrid). */
  editor?: GridEditorFactory<TItem, TId> | null | false |
    ((item: TItem, column: GridEditorColumn<TItem, TId>, grid?: GridEditorHost<TItem, TId> | null) => GridEditorFactory<TItem, TId> | null | false);
}

export interface GridCellEditorContext<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> {
  source: GridEditorHost<TItem, TId>;
  grid: GridEditorHost<TItem, TId>;
  item: TItem;
  id: TId;
  /** Creation-time logical projection position, not a viewport index or stable identity. */
  rowIndex: number;
  column: GridEditorColumn<TItem, TId>;
  columnId: string;
  /** Raw field/computed value before the selected control normalizes it. */
  value: unknown;
}
export interface GridCellWriteContext<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> {
  source: GridEditorHost<TItem, TId>;
  id: TId;
  column: GridEditorColumn<TItem, TId>;
  columnId: string;
  origin: ChangeOrigin;
  userAction: boolean;
  /** Custom writers must forward silence when mutating their own data source. */
  silent?: boolean;
}
export type GridEditorValidationContext<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> =
  Partial<GridCellEditorContext<TItem, TId>> & MutationMetadataOptions;
/** Custom cell editors may return only ok; built-in controls also return errors/value/source. */
export interface CellEditorValidation<TValue = unknown> {
  ok: boolean;
  errors?: readonly unknown[];
  value?: TValue;
  source?: object;
}
export interface CellEditor<TValue = unknown, TContext extends object = object> {
  readonly element?: HTMLElement | null | undefined;
  mount(container: HTMLElement): unknown;
  getValue(): TValue;
  validate(context?: TContext): CellEditorValidation<TValue>;
  focus(): unknown;
  destroy(): void;
}
export interface GridValueControl<TValue = unknown, TContext extends object = object> {
  readonly element?: HTMLElement | null | undefined;
  readonly value: Pick<ValueApi<TValue>, 'get' | 'set'>;
  mount(container: HTMLElement): unknown;
  focus(options?: FocusOptions): unknown;
  destroy(): void;
  validate?(context?: TContext): CellEditorValidation<TValue>;
}
export type GridEditorFilterType = 'values' | 'text' | 'number' | 'boolean' | 'date';
export interface GridEditorFactoryOptions {
  activation?: 'edit' | 'toggle';
  filterType?: GridEditorFilterType;
}
export interface GridEditorFactory<TItem extends object = Record<string, unknown>,
  TId extends ItemId = DefaultItemId<TItem>, TValue = unknown> {
  readonly activation?: 'edit' | 'toggle';
  readonly filterType?: GridEditorFilterType;
  createCellEditor(context: GridCellEditorContext<TItem, TId>): CellEditor<TValue, GridEditorValidationContext<TItem, TId>>;
}

export interface GridEditEvent<TItem extends object, TId extends ItemId = DefaultItemId<TItem>>
  extends GridCellWriteContext<TItem, TId> {
  item: TItem;
}
export interface GridCellChangeEvent<TItem extends object, TId extends ItemId = DefaultItemId<TItem>>
  extends GridEditEvent<TItem, TId> {
  oldValue: unknown;
  newValue: unknown;
}
export interface SharedGridEditingEvents<TItem extends object, TId extends ItemId = DefaultItemId<TItem>> {
  beforeEditStart: GridEditEvent<TItem, TId> & { value: unknown; cancel: boolean };
  editStart: GridEditEvent<TItem, TId> & { value: unknown };
  beforeCellChange: GridCellChangeEvent<TItem, TId> & { cancel: boolean };
  cellChange: GridCellChangeEvent<TItem, TId>;
  editCommit: GridCellChangeEvent<TItem, TId> & { changed: boolean; writeResult: boolean };
  editCancel: GridEditEvent<TItem, TId> & { value: unknown; reason?: string | undefined };
  editReject: GridCellChangeEvent<TItem, TId> & {
    reason: string;
    validation?: CellEditorValidation;
    error?: unknown;
  };
}
/** Retained named interface for the common Grid editing contract. */
export interface GridEditingEvents<TItem extends object, TId extends ItemId = DefaultItemId<TItem>>
  extends SharedGridEditingEvents<TItem, TId> {
  beforeEditStart: GridEditEvent<TItem, TId> & { value: unknown; cancel: boolean };
  editCommit: GridCellChangeEvent<TItem, TId> & { changed: boolean; writeResult: boolean };
}
export interface TreeGridEditingEvents<TItem extends object, TId extends ItemId = DefaultItemId<TItem>>
  extends SharedGridEditingEvents<TItem, TId> {
  /** cancel is retained for compatibility; committed writes can only be vetoed beforeCellChange. */
  editCommit: GridCellChangeEvent<TItem, TId> & { changed: boolean; writeResult: boolean; cancel: boolean };
}
