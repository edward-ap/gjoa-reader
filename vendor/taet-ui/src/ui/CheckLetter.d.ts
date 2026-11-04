import { CheckBox } from './CheckBox.js';
import type { CheckBoxOptions } from './CheckBox.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { MutationOptions } from '../core/index.js';
export interface CheckLetterEvents<C extends object = object> {
  letterChange: EditorValueEvent<string, CheckLetter<C>>;
  textChange: EditorValueEvent<string, CheckLetter<C>>;
}
export interface CheckLetterOptions<C extends object = object>
  extends Omit<CheckBoxOptions<C>, keyof EditorControlOptions>, EditorControlOptions<boolean, C, CheckLetter<C>> {
  emptyValue?: false;
  letter?: string | number | null;
  marker?: string | number | null;
}
export declare class CheckLetter<C extends object = object> extends CheckBox<C, CheckLetterEvents<C>> {
  constructor(options?: CheckLetterOptions<C>);
  constructor(container: HTMLElement | string, options?: CheckLetterOptions<C>);
  letter: string;
  setLetter(letter: string | number | null | undefined, options?: MutationOptions): this;
  getLetter(): string;
}
