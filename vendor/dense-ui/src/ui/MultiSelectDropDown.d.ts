import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueApi, EditorValueEvent } from './EditorControl.js';
import type { SelectInput, SelectInputOptions, SelectItemRenderContext, SelectPopupCloseOptions } from './SelectInput.js';
import type { ControlEvent, DataStoreChange, DefaultItemId, EventHandler, ItemId, MutationOptions, VisibilityOptions } from '../core/index.js';

export interface MultiSelectValueApi extends EditorValueApi<unknown[]> {
  set(value: readonly unknown[] | null | undefined | '', options?: MutationOptions): boolean;
}
export interface MultiSelectValueEvent<T extends object, S> extends EditorValueEvent<unknown[], S> {
  readonly oldItems: T[];
  readonly newItems: T[];
}
export interface MultiSelectDropDownEvents<T extends object, I extends ItemId, C extends object> {
  beforeChange: MultiSelectValueEvent<T, MultiSelectDropDown<T, I, C>> & { cancel: boolean };
  change: MultiSelectValueEvent<T, MultiSelectDropDown<T, I, C>>;
  afterChange: MultiSelectValueEvent<T, MultiSelectDropDown<T, I, C>>;
  open: ControlEvent<MultiSelectDropDown<T, I, C>>;
  close: ControlEvent<MultiSelectDropDown<T, I, C>> & { reason: string };
  filterChange: EditorValueEvent<string, MultiSelectDropDown<T, I, C>>;
  dataChange: ControlEvent<MultiSelectDropDown<T, I, C>> & { dataEvent: DataStoreChange<T, I> & { type: string } };
  passwordVisibilityChange: EditorValueEvent<boolean, MultiSelectDropDown<T, I, C>>;
}
export interface MultiSelectDropDownOptions<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>, C extends object = object>
  extends Omit<SelectInputOptions<T, I, C>, keyof EditorControlOptions | 'filterPredicate' | 'renderItem'>,
    Omit<EditorControlOptions<unknown[], C, MultiSelectDropDown<T, I, C>>, 'value' | 'emptyValue' | 'onBeforeChange' | 'onChange' | 'onAfterChange'> {
  value?: readonly unknown[] | null | '';
  emptyValue?: readonly [];
  closeOnSelect?: boolean;
  filterPredicate?: ((item: T, query: string, source: MultiSelectDropDown<T, I, C>) => boolean) | null;
  renderItem?: ((item: T, context: SelectItemRenderContext<T, I, MultiSelectDropDown<T, I, C>>) => Node | string | number | boolean | null | undefined) | null;
  onBeforeChange?: EventHandler<MultiSelectDropDownEvents<T, I, C>['beforeChange']>;
  onChange?: EventHandler<MultiSelectDropDownEvents<T, I, C>['change']>;
  onAfterChange?: EventHandler<MultiSelectDropDownEvents<T, I, C>['afterChange']>;
}
type SelectPresentation<T extends object, I extends ItemId, C extends object> = Omit<SelectInput<T, I, C>,
  keyof EditorControl | 'filterPredicate' | 'renderItem' | 'openPopup' | 'closePopup' | 'togglePopup' | 'setFilter'>;
export interface MultiSelectDropDown<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>, C extends object = object>
  extends SelectPresentation<T, I, C> {}
/** Experimental array-valued popup; values may include unmatched IDs and are shallow-copied. */
export declare class MultiSelectDropDown<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>, C extends object = object>
  extends EditorControl<unknown[], C, MultiSelectDropDownEvents<T, I, C>> {
  constructor(options?: MultiSelectDropDownOptions<T, I, C>);
  constructor(container: HTMLElement | string, options?: MultiSelectDropDownOptions<T, I, C>);
  readonly value: Readonly<MultiSelectValueApi>;
  closeOnSelect: boolean;
  filterPredicate: NonNullable<MultiSelectDropDownOptions<T, I, C>['filterPredicate']> | null;
  renderItem: NonNullable<MultiSelectDropDownOptions<T, I, C>['renderItem']> | null;
  openPopup(options?: VisibilityOptions): this;
  closePopup(options?: SelectPopupCloseOptions): this;
  togglePopup(): this;
  setFilter(query?: string, options?: MutationOptions): this;
  getSelectedItem(): T | null;
  getSelectedItems(): T[];
  addValue(id: unknown, options?: MutationOptions): boolean;
  removeValue(id: unknown, options?: MutationOptions): boolean;
}
