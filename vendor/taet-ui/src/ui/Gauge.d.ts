import { ProgressBar } from './ProgressBar.js';
import type { ProgressBarOptions } from './ProgressBar.js';
export type GaugeOptions<C extends object = object> = Omit<ProgressBarOptions<C>, 'orientation'>;
/** Read-only display; shares ProgressBar's value, range and formatting API. */
export declare class Gauge<C extends object = object> extends ProgressBar<C> {
  constructor(options?: GaugeOptions<C>);
  constructor(container: HTMLElement | string, options?: GaugeOptions<C>);
}
