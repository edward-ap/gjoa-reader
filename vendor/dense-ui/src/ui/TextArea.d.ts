import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { TextFieldPresentationOptions, TextInput } from './TextInput.js';
import type { MutationOptions, ControlEvent } from '../core/index.js';

export type TextAreaScrollBars = false | 'none' | 'auto' | 'vertical' | 'horizontal' | 'both';
export type TextAreaResize = false | 'none' | 'vertical' | 'horizontal' | 'both';
export interface TextAreaSelection { start: number; end: number; text: string }
export interface TextAreaLines {
  get(): string[];
  set(lines?: readonly unknown[], options?: MutationOptions): boolean;
  append(line?: unknown, options?: MutationOptions): boolean;
}
export interface TextAreaEvents<C extends object = object> {
  enterKey: ControlEvent<TextArea<C>> & { value: string };
  tabInsert: ControlEvent<TextArea<C>> & { value: string };
  passwordVisibilityChange: EditorValueEvent<boolean, TextArea<C>>;
}
export interface TextAreaOptions<C extends object = object> extends EditorControlOptions<string, C, TextArea<C>>, TextFieldPresentationOptions {
  rows?: number;
  minRows?: number;
  maxRows?: number | null;
  linesCount?: number | null;
  resize?: TextAreaResize;
  resizable?: boolean;
  wordWrap?: boolean;
  wrap?: boolean;
  scrollBars?: TextAreaScrollBars;
  scrollbars?: TextAreaScrollBars;
  acceptsReturn?: boolean;
  acceptsTab?: boolean;
  autoHeight?: boolean;
}
type TextPresentation<C extends object> = Pick<TextInput<C>, 'inputType' | 'isPassword' | 'showRevealButton' |
  'mask' | 'placeholder' | 'unmaskValue' | 'placeholderChar' | 'maxLength' | 'spellcheck' | 'autocomplete' |
  'setPasswordVisible' | 'togglePasswordVisible' | 'getDisplayValue' | 'getRawValue'>;
export interface TextArea<C extends object = object> extends TextPresentation<C> {}
/** TextField sibling of TextInput; values remain strings, lines/selection are separate helpers. */
export declare class TextArea<C extends object = object> extends EditorControl<string, C, TextAreaEvents<C>> {
  constructor(options?: TextAreaOptions<C>);
  constructor(container: HTMLElement | string, options?: TextAreaOptions<C>);
  readonly lines: Readonly<TextAreaLines>;
  rows: number;
  minRows: number;
  maxRows: number | null;
  resize: TextAreaResize;
  wordWrap: boolean;
  scrollBars: { overflowX: 'hidden' | 'auto'; overflowY: 'hidden' | 'auto' };
  acceptsReturn: boolean;
  acceptsTab: boolean;
  autoHeight: boolean;
  getLines(): string[];
  setLines(lines?: readonly unknown[], options?: MutationOptions): boolean;
  appendLine(line?: unknown, options?: MutationOptions): boolean;
  getSelection(): TextAreaSelection;
  setSelection(start: number, end?: number): boolean;
  selectAll(): boolean;
  insertText(text: unknown, options?: MutationOptions): boolean;
  calcAutoHeight(): number | null;
}
