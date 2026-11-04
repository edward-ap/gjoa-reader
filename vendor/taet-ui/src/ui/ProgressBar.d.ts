import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { MutationOptions } from '../core/index.js';
export type ProgressTextMode = 'percent' | 'value' | 'custom';
export interface ProgressFormatContext<C extends object = object> {
  source: ProgressBar<C>; percent: number; min: number; max: number;
}
export interface ProgressBarEvents<C extends object = object> {
  textChange: EditorValueEvent<string, ProgressBar<C>>;
}
export interface ProgressBarOptions<C extends object = object> extends Omit<EditorControlOptions<number, C, ProgressBar<C>>, 'emptyValue'> {
  min?: number; minimum?: number; max?: number; maximum?: number;
  orientation?: 'horizontal' | 'vertical';
  showText?: boolean;
  textMode?: ProgressTextMode; percentView?: ProgressTextMode;
  text?: string;
  valueFormatter?: ((value: number, context: ProgressFormatContext<C>) => string | number) | null;
}
/** Experimental numeric indicator with the shared editor value/validation contract. */
export declare class ProgressBar<C extends object = object> extends EditorControl<number, C, ProgressBarEvents<C>> {
  constructor(options?: ProgressBarOptions<C>);
  constructor(container: HTMLElement | string, options?: ProgressBarOptions<C>);
  min: number; max: number;
  orientation: 'horizontal' | 'vertical';
  showText: boolean; textMode: ProgressTextMode; text: string;
  valueFormatter: ((value: number, context: ProgressFormatContext<C>) => string | number) | null;
  setRange(min: number, max: number, options?: MutationOptions): boolean;
  setText(text: string | null | undefined, options?: MutationOptions): this;
}
