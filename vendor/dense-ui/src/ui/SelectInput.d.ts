import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { TextFieldPresentationOptions } from './TextInput.js';
import type { InputOverlayService } from './input-choice-contracts.js';
import type { DataStore, DataStoreChange, DefaultItemId, ItemId, MutationOptions, MutationMetadataOptions, EventHandler,
  ControlEvent, VisibilityOptions } from '../core/index.js';

export type SelectField<T> = string | ((item: T) => unknown);
export interface SelectItemRenderContext<T extends object, I extends ItemId, S = SelectInput<T, I>> {
  source: S;
  id: I;
  index: number;
  selected: boolean;
  active: boolean;
}
export interface SelectValueEvent<T extends object, S> extends EditorValueEvent<unknown, S> {
  readonly oldItem: T | null;
  readonly newItem: T | null;
}
export interface SelectInputEvents<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>,
  C extends object = object> {
  beforeChange: SelectValueEvent<T, SelectInput<T, I, C>> & { cancel: boolean };
  change: SelectValueEvent<T, SelectInput<T, I, C>>;
  afterChange: SelectValueEvent<T, SelectInput<T, I, C>>;
  dataChange: ControlEvent<SelectInput<T, I, C>> & { dataEvent: DataStoreChange<T, I> & { type: string } };
  open: ControlEvent<SelectInput<T, I, C>>;
  close: ControlEvent<SelectInput<T, I, C>> & { reason: string };
  filterChange: EditorValueEvent<string, SelectInput<T, I, C>>;
  passwordVisibilityChange: EditorValueEvent<boolean, SelectInput<T, I, C>>;
}
export interface SelectPopupCloseOptions extends MutationMetadataOptions { restoreFocus?: boolean }
/** Standalone Select loads choices through data.parse or borrowed data, not items/options. */
export interface SelectInputOptions<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>,
  C extends object = object> extends Omit<EditorControlOptions<unknown, C, SelectInput<T, I, C>>,
    'onBeforeChange' | 'onChange' | 'onAfterChange'>, TextFieldPresentationOptions {
  data?: DataStore<T, I>;
  valueField?: string;
  idField?: string;
  getId?: ((item: T, index: number) => I) | null;
  textField?: SelectField<T>;
  descriptionField?: SelectField<T>;
  detailsField?: SelectField<T>;
  imageField?: SelectField<T>;
  iconField?: SelectField<T>;
  emptyText?: string;
  searchable?: boolean;
  search?: boolean;
  filter?: boolean;
  searchPlaceholder?: string;
  filterMode?: 'contains' | 'startsWith';
  filterPredicate?: ((item: T, query: string, source: SelectInput<T, I, C>) => boolean) | null;
  renderItem?: ((item: T, context: SelectItemRenderContext<T, I, SelectInput<T, I, C>>) => Node | string | number | boolean | null | undefined) | null;
  itemHeight?: number | null;
  popupWidth?: number | string | null;
  popupHeight?: number;
  clearValueOnMissingData?: boolean;
  overlayManager?: InputOverlayService;
  onBeforeChange?: EventHandler<SelectInputEvents<T, I, C>['beforeChange']>;
  onChange?: EventHandler<SelectInputEvents<T, I, C>['change']>;
  onAfterChange?: EventHandler<SelectInputEvents<T, I, C>['afterChange']>;
}
/** Values remain unknown: empty and unmatched application values need not be choice IDs. */
export declare class SelectInput<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>,
  C extends object = object> extends EditorControl<unknown, C, SelectInputEvents<T, I, C>> {
  constructor(options?: SelectInputOptions<T, I, C>);
  constructor(container: HTMLElement | string, options?: SelectInputOptions<T, I, C>);
  readonly data: DataStore<T, I>;
  inputType: string;
  isPassword: boolean;
  showRevealButton: boolean;
  mask: string | null;
  unmaskValue: boolean;
  placeholderChar: string;
  maxLength: number | null;
  spellcheck: boolean | undefined;
  autocomplete: string | null;
  valueField: string;
  textField: SelectField<T>;
  descriptionField: SelectField<T>;
  imageField: SelectField<T>;
  iconField: SelectField<T>;
  placeholder: string;
  searchable: boolean;
  searchPlaceholder: string;
  filterMode: 'contains' | 'startsWith';
  filterPredicate: NonNullable<SelectInputOptions<T, I, C>['filterPredicate']> | null;
  renderItem: NonNullable<SelectInputOptions<T, I, C>['renderItem']> | null;
  itemHeight: number | null;
  popupWidth: number | string | null;
  popupHeight: number;
  clearValueOnMissingData: boolean;
  overlayManager: InputOverlayService;
  openPopup(options?: VisibilityOptions): this;
  closePopup(options?: SelectPopupCloseOptions): this;
  togglePopup(): this;
  setFilter(query?: string, options?: MutationOptions): this;
  getSelectedItem(): T | null;
  getDisplayValue(): string;
  getRawValue(): unknown;
  setPasswordVisible(visible: boolean, options?: MutationOptions): boolean;
  togglePasswordVisible(visible?: boolean | null, options?: MutationOptions): boolean;
}
