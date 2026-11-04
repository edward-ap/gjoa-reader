import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { MutationOptions, ControlEvent } from '../core/index.js';

export type RadioLayout = 'column' | 'flow';
/** Normalization retains raw input and replaces these six fields. Copies are shallow. */
export type RadioItem<R = unknown> = (R extends object ? Omit<R, 'key' | 'value' | 'text' | 'marker' | 'disabled' | 'raw'> : {}) & {
  key: string; value: unknown; text: string; marker: string; disabled: boolean; raw: R;
};
export interface RadioGroupEvents<R = unknown, C extends object = object> {
  itemsChange: EditorValueEvent<RadioItem<R>[], RadioGroup<R, C>>;
  appearanceChange: ControlEvent<RadioGroup<R, C>> & (
    { name: 'layout'; oldValue: RadioLayout; value: RadioLayout } |
    { name: 'columns'; oldValue: number | null; value: number | null });
}
export interface RadioGroupOptions<R = unknown, C extends object = object> extends EditorControlOptions<unknown, C, RadioGroup<R, C>> {
  items?: readonly R[];
  options?: readonly R[];
  textField?: string;
  descriptionField?: string;
  valueField?: string;
  disabledField?: string;
  markerField?: string;
  markerStyle?: 'default' | 'letter';
  layout?: RadioLayout;
  itemsLayout?: RadioLayout;
  columns?: number | null;
}
export declare class RadioGroup<R = unknown, C extends object = object> extends EditorControl<unknown, C, RadioGroupEvents<R, C>> {
  constructor(options?: RadioGroupOptions<R, C>);
  constructor(container: HTMLElement | string, options?: RadioGroupOptions<R, C>);
  items: RadioItem<R>[];
  textField: string;
  descriptionField: string;
  valueField: string;
  disabledField: string;
  markerField: string;
  markerStyle: 'default' | 'letter';
  layout: RadioLayout;
  columns: number | null;
  setItems(items?: readonly R[], options?: MutationOptions): this;
  getItems(): RadioItem<R>[];
  getLayout(): RadioLayout;
  setLayout(layout: RadioLayout | null, options?: MutationOptions): this;
  getColumns(): number | null;
  setColumns(columns: number | null, options?: MutationOptions): this;
  getSelectedItem(): RadioItem<R> | null;
  getSelectedIndex(): number;
  setSelectedIndex(index: number, options?: MutationOptions): boolean;
}
