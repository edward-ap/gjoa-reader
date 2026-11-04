import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueApi } from './EditorControl.js';
import type { MutationOptions } from '../core/index.js';
import type { InputOverlayService } from './input-choice-contracts.js';

/** Date is converted using local calendar fields; null/undefined clear to ''. */
export type DateTimeWriteValue = string | Date | null | undefined;
export interface DateTimeValueApi extends EditorValueApi<string> {
  set(value: DateTimeWriteValue, options?: MutationOptions): boolean;
}
export interface DatePickerPresentationOptions {
  placeholder?: string;
  /** Native text-input attributes only; add validators for range enforcement. */
  min?: string | null;
  max?: string | null;
  step?: number;
  overlayManager?: InputOverlayService;
}
export type TimeHourMode = '0-23' | '1-24' | '12';
export interface TimePickerPresentationOptions {
  stepMinutes?: number;
  minuteStep?: number;
  hourMode?: TimeHourMode | '24';
  mode?: TimeHourMode | '24';
  hour12?: boolean;
  hour24?: boolean;
  format?: '12' | '24';
}
interface DateValueOptions<C extends object, S> extends
  Omit<EditorControlOptions<string, C, S>, 'value' | 'emptyValue'>, DatePickerPresentationOptions {
  value?: DateTimeWriteValue;
  emptyValue?: '';
}
export interface DateInputOptions<C extends object = object> extends DateValueOptions<C, DateInput<C>> {}
export interface TimeInputOptions<C extends object = object> extends DateValueOptions<C, TimeInput<C>>, TimePickerPresentationOptions {}
export interface DateTimeInputOptions<C extends object = object> extends DateValueOptions<C, DateTimeInput<C>>, TimePickerPresentationOptions {}

/** Internal common base, not a runtime export. No public popup or spin methods. */
declare class DateTimeInputBase<C extends object> extends EditorControl<string, C> {
  readonly value: Readonly<DateTimeValueApi>;
  placeholder: string;
  min: string | null;
  max: string | null;
  step: number;
  overlayManager: InputOverlayService;
  readonly inputType: string;
  readonly inputMode: string;
  readonly pickerText: string;
  readonly pickerTitle: string;
  readonly leadingIconType: string;
  readonly defaultStep: number;
  protected _setValue(value: DateTimeWriteValue, options?: MutationOptions): boolean;
}
/** Experimental. Canonical date strings are YYYY-MM-DD; arbitrary text remains possible. */
export declare class DateInput<C extends object = object> extends DateTimeInputBase<C> {
  constructor(options?: DateInputOptions<C>);
  constructor(container: HTMLElement | string, options?: DateInputOptions<C>);
}
/** Experimental. Stored HH:mm is independent of the text/picker hour mode. */
export declare class TimeInput<C extends object = object> extends DateTimeInputBase<C> {
  constructor(options?: TimeInputOptions<C>);
  constructor(container: HTMLElement | string, options?: TimeInputOptions<C>);
  hourMode: TimeHourMode;
  hour12: boolean;
  stepMinutes: number;
}
/** Experimental. Local YYYY-MM-DDTHH:mm values; the picker stages changes until OK. */
export declare class DateTimeInput<C extends object = object> extends DateTimeInputBase<C> {
  constructor(options?: DateTimeInputOptions<C>);
  constructor(container: HTMLElement | string, options?: DateTimeInputOptions<C>);
  hourMode: TimeHourMode;
  hour12: boolean;
  stepMinutes: number;
}
