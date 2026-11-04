import type { DefaultItemId, ItemId } from '../core/index.js';
import type { CellEditor, CellEditorValidation, GridCellEditorContext, GridEditorFactory,
  GridEditorFactoryOptions, GridEditorValidationContext, GridValueControl } from './grid-editor-contracts.js';
import type { TextGridEditorOptions, NumberGridEditorOptions, SelectGridEditorOptions, RadioGridEditorOptions,
  BooleanGridEditorOptions, SwitchGridEditorOptions, DateGridEditorOptions, TimeGridEditorOptions } from './grid-editor-options.js';
import type { PropertyEditorContext, PropertyEditorFactory } from './collection-contracts.js';
export type * from './grid-editor-contracts.js';
export type * from './grid-editor-options.js';

export declare class ControlCellEditor<TValue = unknown, TItem extends object = Record<string, unknown>,
  TId extends ItemId = DefaultItemId<TItem>> implements CellEditor<TValue, GridEditorValidationContext<TItem, TId>> {
  constructor(control: GridValueControl<TValue, GridEditorValidationContext<TItem, TId>>, context: GridCellEditorContext<TItem, TId>);
  control: GridValueControl<TValue, GridEditorValidationContext<TItem, TId>>;
  context: GridCellEditorContext<TItem, TId> | null;
  element: HTMLElement | null | undefined;
  destroyed: boolean;
  /** Failed mount disposes the adapter/control; teardown during mount does not install listeners afterward. */
  mount(container: HTMLElement): this;
  getValue(): TValue;
  validate(context?: GridEditorValidationContext<TItem, TId>): CellEditorValidation<TValue>;
  focus(): unknown;
  /** Idempotent, including recursive calls from the owned control's destroy hook. */
  destroy(): void;
}
export declare function createGridEditorFactory<TItem extends object = Record<string, unknown>,
  TId extends ItemId = DefaultItemId<TItem>, TValue = unknown>(
  createControl: (context: GridCellEditorContext<TItem, TId>) =>
    GridValueControl<TValue, GridEditorValidationContext<TItem, TId>> | CellEditor<TValue, GridEditorValidationContext<TItem, TId>>,
  options?: GridEditorFactoryOptions
): GridEditorFactory<TItem, TId, TValue>;
/** PropertyGrid supplies its own context. Annotate the callback parameter to select this overload. */
export declare function createGridEditorFactory(
  createControl: (context: PropertyEditorContext) => GridValueControl | CellEditor,
  options?: GridEditorFactoryOptions
): PropertyEditorFactory;
export declare function isGridEditorFactory(value: unknown): value is GridEditorFactory;
export type GridEditorOptionsResolver<TOptions, TItem extends object, TId extends ItemId = DefaultItemId<TItem>> =
  TOptions | null | ((context: GridCellEditorContext<TItem, TId>) => TOptions | null | undefined);

export declare const gridEditors: Readonly<{
  text<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>(
    options?: GridEditorOptionsResolver<TextGridEditorOptions<T, I>, T, I>): GridEditorFactory<T, I, string>;
  number<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>(
    options?: GridEditorOptionsResolver<NumberGridEditorOptions<T, I>, T, I>): GridEditorFactory<T, I, number | null>;
  select<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>,
    C extends object = Record<string, unknown>, CI extends ItemId = DefaultItemId<C>>(
    options?: GridEditorOptionsResolver<SelectGridEditorOptions<T, I, C, CI>, T, I>): GridEditorFactory<T, I>;
  radio<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>(
    options?: GridEditorOptionsResolver<RadioGridEditorOptions<T, I>, T, I>): GridEditorFactory<T, I>;
  checkbox<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>(
    options?: GridEditorOptionsResolver<BooleanGridEditorOptions<T, I>, T, I>): GridEditorFactory<T, I, boolean>;
  switch<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>(
    options?: GridEditorOptionsResolver<SwitchGridEditorOptions<T, I>, T, I>): GridEditorFactory<T, I, boolean>;
  date<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>(
    options?: GridEditorOptionsResolver<DateGridEditorOptions<T, I>, T, I>): GridEditorFactory<T, I, string>;
  time<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>(
    options?: GridEditorOptionsResolver<TimeGridEditorOptions<T, I>, T, I>): GridEditorFactory<T, I, string>;
  dateTime<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>>(
    options?: GridEditorOptionsResolver<TimeGridEditorOptions<T, I>, T, I>): GridEditorFactory<T, I, string>;
  custom<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>, V = unknown>(
    createControl: (context: GridCellEditorContext<T, I>) =>
      GridValueControl<V, GridEditorValidationContext<T, I>> | CellEditor<V, GridEditorValidationContext<T, I>>
  ): GridEditorFactory<T, I, V>;
  custom(createControl: (context: PropertyEditorContext) => GridValueControl | CellEditor): PropertyEditorFactory;
}>;
