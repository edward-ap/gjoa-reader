import { RadioGroup } from './RadioGroup.js';
import type { RadioGroupOptions } from './RadioGroup.js';
export interface RadioLetterOptions<R = unknown, C extends object = object> extends Omit<RadioGroupOptions<R, C>, 'markerStyle'> {
  markerStyle?: 'letter';
}
/** Stable RadioGroup variant; markerField defaults to letter, markerStyle is fixed. */
export declare class RadioLetter<R = unknown, C extends object = object> extends RadioGroup<R, C> {
  constructor(options?: RadioLetterOptions<R, C>);
  constructor(container: HTMLElement | string, options?: RadioLetterOptions<R, C>);
}
