import { TrackBar } from './TrackBar.js';
import type { TrackBarOptions } from './TrackBar.js';
export type CircularSliderOptions<C extends object = object> = Omit<TrackBarOptions<C>,
  'orientation' | 'invert' | 'invertLayout' | 'scale' | 'showScale' | 'showTickLabels' | 'tickFrequency' | 'thumbShape' | 'showValue' | 'valuePosition'>;
/** Experimental. Fixed clockwise circular presentation, starting at six o'clock. */
export declare class CircularSlider<C extends object = object> extends TrackBar<C> {
  constructor(options?: CircularSliderOptions<C>);
  constructor(container: HTMLElement | string, options?: CircularSliderOptions<C>);
}
