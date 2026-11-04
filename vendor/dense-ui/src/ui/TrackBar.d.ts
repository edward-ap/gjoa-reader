import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions } from './EditorControl.js';
import type { MutationOptions } from '../core/index.js';
export type TrackBarValuePosition = 'left' | 'right' | 'top' | 'bottom';
export type TrackBarThumbShape = 'circle' | 'ring' | 'grip' | 'line';
export type TrackBarScale = 'none' | 'range' | 'ticks';
export interface TrackBarOptions<C extends object = object> extends Omit<EditorControlOptions<number, C, TrackBar<C>>, 'emptyValue'> {
  min?: number;
  max?: number;
  step?: number;
  smallChange?: number;
  largeChange?: number;
  orientation?: 'horizontal' | 'vertical';
  invert?: boolean;
  invertLayout?: boolean;
  scale?: TrackBarScale | 'labels' | 'minmax' | boolean;
  showScale?: TrackBarScale | 'labels' | 'minmax' | boolean;
  tickFrequency?: number;
  showTickLabels?: boolean;
  showValue?: boolean;
  valuePosition?: TrackBarValuePosition;
  thumbShape?: TrackBarThumbShape;
  valueFormatter?: ((value: number) => string | number) | null;
}
/** Experimental. Values clamp and snap relative to min; clear targets the current min. */
export declare class TrackBar<C extends object = object> extends EditorControl<number, C> {
  constructor(options?: TrackBarOptions<C>);
  constructor(container: HTMLElement | string, options?: TrackBarOptions<C>);
  min: number;
  max: number;
  step: number;
  smallChange: number;
  largeChange: number;
  orientation: 'horizontal' | 'vertical';
  invert: boolean;
  scale: TrackBarScale;
  tickFrequency: number;
  showTickLabels: boolean;
  showValue: boolean;
  valuePosition: TrackBarValuePosition;
  thumbShape: TrackBarThumbShape;
  setValuePosition(position: TrackBarValuePosition): this;
  setThumbShape(shape: TrackBarThumbShape): this;
  setShowValue(show: boolean): this;
  valueFormatter: ((value: number) => string | number) | null;
  setRange(min: number, max: number, options?: MutationOptions): boolean;
  setStep(step: number, options?: MutationOptions): boolean;
  moveBegin(options?: MutationOptions): boolean;
  moveEnd(options?: MutationOptions): boolean;
  moveLeft(options?: MutationOptions): boolean;
  moveRight(options?: MutationOptions): boolean;
  moveUp(options?: MutationOptions): boolean;
  moveDown(options?: MutationOptions): boolean;
}
