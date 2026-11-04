import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { MutationOptions } from '../core/index.js';

export interface TextInputEvents<C extends object = object> { passwordVisibilityChange: EditorValueEvent<boolean, TextInput<C>> }
export interface TextFieldPresentationOptions {
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
export interface TextInputOptions<C extends object = object>
  extends EditorControlOptions<string, C, TextInput<C>>, TextFieldPresentationOptions {}
/** Existing TextInput constructor; includes inherited TextField presentation methods. */
export declare class TextInput<C extends object = object> extends EditorControl<string, C, TextInputEvents<C>> {
  constructor(options?: TextInputOptions<C>);
  constructor(container: HTMLElement | string, options?: TextInputOptions<C>);
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
  setPasswordVisible(visible: boolean, options?: MutationOptions): boolean;
  togglePasswordVisible(visible?: boolean | null, options?: MutationOptions): boolean;
  getDisplayValue(): string;
  getRawValue(): string;
}
