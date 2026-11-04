import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions, BaseControlEvents, ControlDimension, ControlEvent } from '../core/BaseControl.js';
import type { EventBus, EventHandler, MutationOptions, ValueApi } from '../core/index.js';

export type EditorValidatorResult = null | undefined | boolean | string |
  { ok?: boolean; message?: string; severity?: 'error' | 'warning'; code?: string };
export interface EditorValidationError<S = EditorControl> {
  control: S;
  path: string;
  severity: 'error' | 'warning';
  message: string;
  code?: string | undefined;
}
export interface EditorValidationResult<V = unknown, S = EditorControl<V>> {
  source: S;
  ok: boolean;
  errors: EditorValidationError<S>[];
  value: V;
}
export type EditorValidator<V, C extends object = object, S = EditorControl<V, C>> =
  (value: V, context: C & { control: S; value: V }) => EditorValidatorResult;
export interface EditorValueApi<V> extends ValueApi<V> {
  reset(options?: MutationOptions): boolean;
}
export interface EditorValidationApi<S> {
  getErrors(): EditorValidationError<S>[];
  clear(options?: MutationOptions): S;
}
export interface EditorValueEvent<V, S = EditorControl<V>> extends ControlEvent<S> {
  readonly oldValue: V;
  readonly newValue: V;
}
export interface EditorControlEvents<V = unknown, S = EditorControl<V>> {
  beforeChange: EditorValueEvent<V, S> & { cancel: boolean };
  change: EditorValueEvent<V, S>;
  afterChange: EditorValueEvent<V, S>;
  dirtyChange: EditorValueEvent<boolean, S>;
  labelChange: EditorValueEvent<string, S>;
  validate: EditorValidationResult<V, S>;
  validationClear: ControlEvent<S>;
}
export interface EditorControlOptions<V = unknown, C extends object = object, S = EditorControl<V, C>>
  extends BaseControlOptions<S> {
  label?: string;
  labelPosition?: 'left' | 'top' | null;
  labelWidth?: ControlDimension;
  indent?: ControlDimension;
  leftIndent?: ControlDimension;
  css?: string;
  value?: V;
  emptyValue?: V;
  readOnly?: boolean;
  readonly?: boolean;
  required?: boolean;
  validators?: readonly EditorValidator<V, C, S>[];
  onBeforeChange?: EventHandler<EditorControlEvents<V, S>['beforeChange']>;
  onChange?: EventHandler<EditorControlEvents<V, S>['change']>;
  onAfterChange?: EventHandler<EditorControlEvents<V, S>['afterChange']>;
  onDirtyChange?: EventHandler<EditorControlEvents<V, S>['dirtyChange']>;
  onValidate?: EventHandler<EditorControlEvents<V, S>['validate']>;
  onValidationClear?: EventHandler<EditorControlEvents<V, S>['validationClear']>;
}
/** Generic value base; its default empty value is ''. It has no concrete input DOM. */
export declare class EditorControl<V = unknown, C extends object = object,
  E extends { [K in keyof E]: object } = {}> extends BaseControl<E, HTMLElement> {
  constructor(...args: '' extends V ? [options?: EditorControlOptions<V, C>] :
    [options: EditorControlOptions<V, C> & { emptyValue: V }]);
  readonly events: EventBus<BaseControlEvents<this> & EditorControlEvents<V, this> & E>;
  readonly value: Readonly<EditorValueApi<V>>;
  readonly validation: Readonly<EditorValidationApi<this>>;
  label: string;
  labelPosition: 'left' | 'top' | null;
  labelWidth: ControlDimension;
  indent: ControlDimension;
  css: string;
  validators: EditorValidator<V, C, this>[];
  mount(container: HTMLElement | string): this;
  refresh(): void;
  enable(): this;
  disable(): this;
  destroy(): void;
  getName(): string;
  getLabel(): string;
  setLabel(label: string | null | undefined, options?: MutationOptions): this;
  setLabelPosition(position: 'left' | 'top' | null): this;
  setLabelWidth(width: ControlDimension): this;
  setIndent(indent: ControlDimension): this;
  isReadOnly(): boolean;
  setReadOnly(readOnly: boolean, options?: MutationOptions): this;
  isRequired(): boolean;
  setRequired(required: boolean, options?: MutationOptions): this;
  getErrors(): EditorValidationError<this>[];
  setValidators(validators?: readonly EditorValidator<V, C, this>[]): this;
  addValidator(validator: EditorValidator<V, C, this>): this;
  validate(context?: C): EditorValidationResult<V, this>;
  isValid(): boolean;
  clearValidation(options?: MutationOptions): this;
  isDirty(): boolean;
  setCleanValue(value?: V): this;
  reset(options?: MutationOptions): boolean;
  protected _getValue(): V;
  protected _getValidationValue(): V;
  /** Storage can differ from the public value (NumberInput stores text). */
  protected _normalizeValue(value: unknown): unknown;
  protected _cloneValue(value: V): V;
  protected _setValue(value: V, options?: MutationOptions): boolean;
  protected _valueToEventValue(value: unknown): V;
  protected _syncInput(value: unknown): void;
  protected _syncStateToInput(): void;
  protected _renderLabel(): void;
}
/** Helper export from the implementation module; not an inputs entry-point value export. */
export declare function normalizeValidationResult<S extends { name: string | null; id: string }>(
  result: EditorValidatorResult, control: S): EditorValidationError<S> | null;
