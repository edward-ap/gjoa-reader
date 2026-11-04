import type { BaseControl, BaseControlOptions, ChangeOrigin, DataStore, DefaultItemId, ItemId } from '../core/index.js';
import type { CellEditorValidation, GridEditorValidationContext, GridValueControl } from './grid-editor-contracts.js';
import type { InputOverlayService } from './input-choice-contracts.js';
import type { DatePickerPresentationOptions, TimePickerPresentationOptions } from './DateTimeInput.js';

export type GridValidatorResult = null | undefined | boolean | string |
  { ok?: boolean; message?: string; severity?: 'error' | 'warning'; code?: string };
export type GridValidator<TValue, TItem extends object, TId extends ItemId = DefaultItemId<TItem>> =
  (value: TValue, context: GridEditorValidationContext<TItem, TId> & {
    control: GridValueControl<TValue>; value: TValue;
  }) => GridValidatorResult;
export interface GridEditorValueEvent<TValue> {
  source: GridValueControl<TValue>;
  oldValue: TValue;
  newValue: TValue;
  origin: ChangeOrigin;
  userAction: boolean;
  type: string;
}

/** Built-in editors are live BaseControls with a typed value, not their Grid host. */
export type GridBuiltinEditorControl<TValue> = BaseControl & GridValueControl<TValue>;
/** Editor recipe options, including inherited control callbacks. */
export interface BaseGridEditorOptions<TValue, TItem extends object, TId extends ItemId = DefaultItemId<TItem>>
  extends BaseControlOptions<GridBuiltinEditorControl<TValue>> {
  css?: string;
  readOnly?: boolean;
  readonly?: boolean;
  required?: boolean;
  emptyValue?: TValue;
  // Built-in grid factories override label and value with '' and context.value.
  label?: string;
  value?: unknown;
  labelPosition?: 'left' | 'top' | null;
  labelWidth?: number | string | null;
  indent?: number | string | null;
  leftIndent?: number | string | null;
  validators?: readonly GridValidator<TValue, TItem, TId>[];
  onBeforeChange?: (event: GridEditorValueEvent<TValue> & { cancel: boolean }) => void;
  onChange?: (event: GridEditorValueEvent<TValue>) => void;
  onAfterChange?: (event: GridEditorValueEvent<TValue>) => void;
  onDirtyChange?: (event: Omit<GridEditorValueEvent<boolean>, 'source'> & { source: GridValueControl<TValue> }) => void;
  onValidate?: (event: CellEditorValidation<TValue> & { type: string }) => void;
  onValidationClear?: (event: { source: GridValueControl<TValue>; origin: ChangeOrigin; userAction: boolean; type: string }) => void;
}
export interface TextGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>, V = string>
  extends BaseGridEditorOptions<V, T, I> {
  placeholder?: string;
  inputType?: string;
  type?: string;
  isPassword?: boolean;
  password?: boolean;
  showRevealButton?: boolean;
  mask?: string | null;
  unmaskValue?: boolean;
  placeholderChar?: string;
  maxLength?: number | null;
  maxlength?: number | null;
  spellcheck?: boolean;
  autocomplete?: string | null;
}
export interface NumberGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>>
  extends TextGridEditorOptions<T, I, number | null> {
  min?: number | null;
  max?: number | null;
  step?: number | 'any' | null;
  increment?: number;
  precision?: number | null;
  decimalPlaces?: number | null;
  isInteger?: boolean;
  float?: boolean;
  isFloatValue?: boolean;
  clamp?: boolean;
  clampToRange?: boolean;
  allowSpinOnMouseWheel?: boolean;
  allowWheel?: boolean;
}
export interface BooleanGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>>
  extends BaseGridEditorOptions<boolean, T, I> {
  text?: string;
  checked?: boolean;
}
export interface SwitchGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>>
  extends BooleanGridEditorOptions<T, I> {
  onText?: string;
  offText?: string;
  onIcon?: string | null;
  offIcon?: string | null;
}
/** Values stay unknown: select/radio accept application-defined values and raw initial values. */
export interface ChoiceGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>>
  extends BaseGridEditorOptions<unknown, T, I> {
  items?: readonly (object | string | number)[];
  options?: readonly (object | string | number)[];
  textField?: string;
  valueField?: string;
  descriptionField?: string;
}
export interface RadioGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>>
  extends ChoiceGridEditorOptions<T, I> {
  disabledField?: string;
  markerField?: string;
  markerStyle?: 'default' | 'letter';
  layout?: 'flow' | 'column';
  itemsLayout?: 'flow' | 'column';
  columns?: number | null;
}
/** Borrowed service protocol used by Select and date/time picker editors. */
export interface GridEditorOverlayService extends InputOverlayService {}
/** The callback source is the Select editor, with its separate choice store. */
export type GridSelectEditorControl<C extends object = Record<string, unknown>, CI extends ItemId = DefaultItemId<C>> =
  GridBuiltinEditorControl<unknown> & { data: DataStore<C, CI>; getSelectedItem(): C | null };
/** Primitive items are normalized to { id, text }; custom schemas must use records. */
export type GridSelectEditorItem<C extends object> = C |
  ({ id: string | number; text: string } extends C ? string | number : never);
export interface SelectGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>,
  C extends object = Record<string, unknown>, CI extends ItemId = DefaultItemId<C>>
  extends ChoiceGridEditorOptions<T, I> {
  items?: readonly GridSelectEditorItem<C>[];
  options?: readonly GridSelectEditorItem<C>[];
  /** Borrowed; never parsed, cleared or destroyed by the editor factory. */
  data?: DataStore<C, CI>;
  /** Used only for the internally created store. index may be -1 during lookups. */
  getId?: ((item: C, index: number) => CI) | null;
  overlayManager?: GridEditorOverlayService;
  filterPredicate?: (item: C, query: string, source: GridSelectEditorControl<C, CI>) => boolean;
  renderItem?: (item: C, context: {
    source: GridSelectEditorControl<C, CI>;
    id: CI;
    index: number;
    selected: boolean;
    active: boolean;
  }) => Node | string | number | boolean | null | undefined;
  idField?: string;
  detailsField?: string;
  imageField?: string;
  iconField?: string;
  placeholder?: string;
  emptyText?: string;
  searchable?: boolean;
  search?: boolean;
  filter?: boolean;
  searchPlaceholder?: string;
  filterMode?: 'contains' | 'startsWith';
  itemHeight?: number | null;
  popupWidth?: number | string | null;
  popupHeight?: number;
  clearValueOnMissingData?: boolean;
}
export interface DateGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>>
  extends BaseGridEditorOptions<string, T, I>, DatePickerPresentationOptions {}
export interface TimeGridEditorOptions<T extends object, I extends ItemId = DefaultItemId<T>>
  extends DateGridEditorOptions<T, I>, TimePickerPresentationOptions {}
