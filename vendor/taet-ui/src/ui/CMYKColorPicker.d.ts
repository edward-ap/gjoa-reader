import { ColorPicker } from './ColorPicker.js';
import type { MutationOptions } from '../core/index.js';
export interface CmykColor { cyan:number; magenta:number; yellow:number; black:number }
/** CMYK percentages; approximate RGB preview without ICC profiles. Value is #rrggbb. */
export declare class CMYKColorPicker<C extends object = object> extends ColorPicker<C> {
 getCmyk(): CmykColor;
 setCmyk(cyan:number,magenta:number,yellow:number,black:number,options?:MutationOptions): boolean;
}
