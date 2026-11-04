import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { TextFieldPresentationOptions } from './TextInput.js';
import type { MutationOptions } from '../core/index.js';

export interface NumberInputEvents<C extends object = object> {
  passwordVisibilityChange: EditorValueEvent<boolean, NumberInput<C>>;
}
export interface NumberInputOptions<C extends object = object>
  extends EditorControlOptions<number | null, C, NumberInput<C>>, TextFieldPresentationOptions {
  /** Numeric clear is always null; the internal empty text is ''. */
  emptyValue?: null;
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
/** A TextField sibling of TextInput: numeric public values, string display/raw values. */
export declare class NumberInput<C extends object = object> extends EditorControl<number | null, C, NumberInputEvents<C>> {
  constructor(options?: NumberInputOptions<C>);
  constructor(container: HTMLElement | string, options?: NumberInputOptions<C>);
  min: number | null;
  max: number | null;
  step: number | 'any' | null;
  increment: number;
  precision: number | null;
  isInteger: boolean;
  clamp: boolean;
  allowSpinOnMouseWheel: boolean;
  inputType: string;
  isPassword: boolean;
  showRevealButton: boolean;
  mask: string | null;
  placeholder: string;
  unmaskValue: boolean;
  placeholderChar: string;
  maxLength: number | null;
  spellcheck: boolean | undefined;
  autocomplete: string | null;
  spinUp(options?: MutationOptions): boolean;
  spinDown(options?: MutationOptions): boolean;
  spin(direction?: number, options?: MutationOptions): boolean;
  setPasswordVisible(visible: boolean, options?: MutationOptions): boolean;
  togglePasswordVisible(visible?: boolean | null, options?: MutationOptions): boolean;
  getDisplayValue(): string;
  getRawValue(): string;
}
