import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions, ControlEvent } from '../core/BaseControl.js';
import type { DataStore, DataStoreOptions, DefaultItemId } from '../core/DataStore.js';
import type { ItemId, MutationOptions } from '../core/contracts.js';

export type ChartType = 'line' | 'spline' | 'area' | 'candlestick' | 'ohlc' | 'column' | 'stackedColumn' | 'stackedColumn100' | 'bar';
export interface ChartSeries<T extends object = Record<string, unknown>> {
  id: string; valueField?: Extract<keyof T, string>; label?: string; color?: string | null; hidden?: boolean;
  ohlc?: {open:Extract<keyof T,string>;high:Extract<keyof T,string>;low:Extract<keyof T,string>;close:Extract<keyof T,string>};
}
export interface ChartPointEvent<T extends object, I extends ItemId = DefaultItemId<T>> extends ControlEvent<Chart<T,I>> {
  item: T; id: I; seriesId: string; value: number; category: string;
  ohlc?: {open:number;high:number;low:number;close:number};
}
export interface ChartEvents<T extends object, I extends ItemId = DefaultItemId<T>> {
  itemClick: ChartPointEvent<T,I>;
  seriesVisibilityChange: ControlEvent<Chart<T,I>> & { seriesId: string; visible: boolean };
}
export interface ChartOptions<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> extends BaseControlOptions<Chart<T,I>>, DataStoreOptions<T,I> {
  type?: ChartType; markers?: boolean; label?: string; categoryField?: Extract<keyof T,string>;
  wickCaps?: boolean; includeZero?: boolean;
  series?: readonly ChartSeries<T>[]; legend?: boolean; css?: string; data?: DataStore<T,I>;
  onItemClick?: (event: ChartPointEvent<T,I>) => void;
  onSeriesVisibilityChange?: (event: ChartEvents<T,I>['seriesVisibilityChange']) => void;
}
export declare class Chart<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> extends BaseControl<ChartEvents<T,I>, HTMLElement> {
  constructor(options?: ChartOptions<T,I>);
  constructor(container: HTMLElement | string, options?: ChartOptions<T,I>);
  readonly data: DataStore<T,I>; readonly type: ChartType; readonly markers: boolean;
  readonly wickCaps: boolean; readonly includeZero: boolean | undefined;
  readonly label: string; readonly categoryField: string; readonly legend: boolean;
  getSeries(): ChartSeries<T>[];
  setSeries(series: readonly ChartSeries<T>[]): this;
  setType(type: ChartType): this;
  setMarkers(markers: boolean): this;
  setWickCaps(caps: boolean): this;
  setSeriesVisible(id: string, visible: boolean, options?: MutationOptions): boolean;
  refresh(): this;
}
