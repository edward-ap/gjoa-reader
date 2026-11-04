import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { MutationOptions } from '../core/index.js';

export interface CheckBoxEvents<C extends object = object> { textChange: EditorValueEvent<string, CheckBox<C>> }
export interface CheckBoxOptions<C extends object = object> extends EditorControlOptions<boolean, C, CheckBox<C>> {
  text?: string;
  checked?: boolean;
  emptyValue?: false;
}
export declare class CheckBox<C extends object = object, E extends { [K in keyof E]: object } = {}>
  extends EditorControl<boolean, C, CheckBoxEvents<C> & E> {
  constructor(options?: CheckBoxOptions<C>);
  constructor(container: HTMLElement | string, options?: CheckBoxOptions<C>);
  text: string;
  setText(text: string | null | undefined, options?: MutationOptions): this;
  getText(): string;
}
