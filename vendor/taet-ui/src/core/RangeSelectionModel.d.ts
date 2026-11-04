import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, ItemId, MutationOptions } from './contracts.js';

export interface RangeCell<I extends ItemId = ItemId, C extends ItemId = string> { rowId: I; columnId: C }
export interface CellRange<I extends ItemId = ItemId, C extends ItemId = string> {
  anchor: RangeCell<I, C>;
  focus: RangeCell<I, C>;
}
/** Anchor/from is required; omitted focus/to defaults to the anchor. */
export type CellRangeInput<I extends ItemId = ItemId, C extends ItemId = string> =
  ({ anchor: RangeCell<I, C>; from?: RangeCell<I, C> } | { from: RangeCell<I, C>; anchor?: RangeCell<I, C> }) &
  { focus?: RangeCell<I, C>; to?: RangeCell<I, C> };
export interface RangeSelectionOptions { multiple?: boolean }
export interface RangeSelectionChange<I extends ItemId = ItemId, C extends ItemId = string> {
  source: RangeSelectionModel<I, C>;
  oldRanges: CellRange<I, C>[];
  ranges: CellRange<I, C>[];
  origin: ChangeOrigin;
  userAction: boolean;
}
export interface RangeSelectionEvents<I extends ItemId = ItemId, C extends ItemId = string> {
  /** Technical synchronization after each accepted write, including silent writes. */
  invalidate: RangeSelectionChange<I, C> & { silent: boolean };
  beforeChange: RangeSelectionChange<I, C> & { cancel: boolean };
  change: RangeSelectionChange<I, C>;
  afterChange: RangeSelectionChange<I, C>;
}
/** Experimental: ranges record endpoints; the owning Grid resolves visible coordinates. */
export declare class RangeSelectionModel<I extends ItemId = ItemId, C extends ItemId = string> {
  constructor(options?: RangeSelectionOptions);
  events: EventBus<RangeSelectionEvents<I, C>>;
  multiple: boolean;
  readonly destroyed: boolean;
  get(): CellRange<I, C>[];
  primary(): CellRange<I, C> | null;
  set(ranges: CellRangeInput<I, C> | readonly (CellRangeInput<I, C> | null | false | undefined)[] | null | false,
    options?: MutationOptions): boolean;
  add(range: CellRangeInput<I, C>, options?: MutationOptions): boolean;
  clear(options?: MutationOptions): boolean;
  hasAny(): boolean;
  destroy(): void;
}
