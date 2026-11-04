import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { MutationOptions } from '../core/index.js';

export interface SwitchStateText { onText: string; offText: string }
export interface SwitchEvents<C extends object = object> {
  textChange: EditorValueEvent<string, Switch<C>>;
  stateTextChange: EditorValueEvent<SwitchStateText, Switch<C>>;
}
export interface SwitchOptions<C extends object = object> extends EditorControlOptions<boolean, C, Switch<C>> {
  text?: string;
  checked?: boolean;
  emptyValue?: false;
  onText?: string;
  offText?: string;
  onIcon?: string | null;
  offIcon?: string | null;
}
export interface SwitchIndicatorOptions { className?: string; ariaLabel?: string }
export declare class Switch<C extends object = object> extends EditorControl<boolean, C, SwitchEvents<C>> {
  constructor(options?: SwitchOptions<C>);
  constructor(container: HTMLElement | string, options?: SwitchOptions<C>);
  text: string;
  onText: string;
  offText: string;
  onIcon: string | null;
  offIcon: string | null;
  setText(text: string | null | undefined, options?: MutationOptions): this;
  getText(): string;
  setStateText(onText: string | null | undefined, offText: string | null | undefined, options?: MutationOptions): this;
  /** A static visual helper, not a live Control or input. */
  static createIndicator(value: boolean, options?: SwitchIndicatorOptions): HTMLSpanElement;
}
