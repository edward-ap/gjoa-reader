import { List } from './List.js';
import type { ListOptions } from './List.js';
import type { ControlEvent, DefaultItemId, ItemId, MutationOptions } from '../core/index.js';
export type OptionListValue<I extends ItemId> = I | I[] | null;
export interface OptionListWriteOptions extends MutationOptions { keepPending?: boolean }
export interface OptionListValueApi<I extends ItemId> {
  get(): OptionListValue<I>;
  set(value: I | readonly I[] | null | undefined, options?: OptionListWriteOptions): boolean;
  clear(options?: OptionListWriteOptions): boolean;
}
export interface OptionListEvents<T extends object, I extends ItemId> {
  change: ControlEvent<OptionList<T, I>> & { oldValue: OptionListValue<I>; newValue: OptionListValue<I>; oldItems: T[]; items: T[] };
  afterChange: OptionListEvents<T, I>['change'];
}
export interface OptionListOptions<T extends object, I extends ItemId = DefaultItemId<T>> extends ListOptions<T, I, OptionList<T, I>> {
  multiple?: boolean;
  value?: I | readonly I[] | null;
}
/** Experimental list selection facade, not an EditorControl. Multiple writes require arrays at runtime. */
export declare class OptionList<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> extends List<T, I, OptionListEvents<T, I>> {
  constructor(options?: OptionListOptions<T, I>);
  constructor(container: HTMLElement | string, options?: OptionListOptions<T, I>);
  readonly value: Readonly<OptionListValueApi<I>>;
  emptyValue: null | I[];
}
