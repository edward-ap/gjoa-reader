import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueApi } from './EditorControl.js';
import type { ControlEvent, EventHandler, MutationMetadataOptions, MutationOptions, VisibilityOptions } from '../core/index.js';
export interface RgbColor { red: number; green: number; blue: number }
export type ColorPopupPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
export interface ColorValueApi extends EditorValueApi<string> {
  set(value: string | null | undefined, options?: MutationOptions): boolean;
}
export interface ColorPickerEvents<C extends object = object> {
  open: ControlEvent<ColorPicker<C>>;
  close: ControlEvent<ColorPicker<C>> & { reason: string };
}
export interface ColorPickerOptions<C extends object = object> extends Omit<EditorControlOptions<string, C, ColorPicker<C>>, 'value' | 'emptyValue'> {
 translate?: (text: string, params: Record<string, unknown>) => string;
  value?: string | null;
  emptyValue?: '';
  allowEmpty?: boolean;
  popupPlacement?: ColorPopupPlacement;
  onOpen?: EventHandler<ColorPickerEvents<C>['open']>;
  onClose?: EventHandler<ColorPickerEvents<C>['close']>;
}
/** Experimental RGB editor; allowEmpty controls the Clear action, not value validation. */
export declare class ColorPicker<C extends object = object> extends EditorControl<string, C, ColorPickerEvents<C>> {
  constructor(options?: ColorPickerOptions<C>);
  constructor(container: HTMLElement | string, options?: ColorPickerOptions<C>);
  readonly value: Readonly<ColorValueApi>;
  allowEmpty: boolean;
  popupPlacement: ColorPopupPlacement;
  getRgb(): RgbColor;
  setRgb(red: number, green: number, blue: number, options?: MutationOptions): boolean;
  openPopup(options?: VisibilityOptions): boolean;
  closePopup(options?: MutationMetadataOptions): boolean;
  togglePopup(options?: MutationMetadataOptions): boolean;
  protected _setValue(value: string | null | undefined, options?: MutationOptions): boolean;
}
/** Converts supported RGB strings to lowercase #rrggbb (or ''); invalid colors throw. */
export declare function normalizeHexColor(value: string | null | undefined): string;
