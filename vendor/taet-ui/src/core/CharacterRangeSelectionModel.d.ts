import type { EventBus } from './EventBus.js';
import type { MutationOptions } from './contracts.js';
import type { ControlEvent } from './BaseControl.js';
export type CharacterRangeInput = { anchor: number; focus: number } | { start: number; end: number };
export interface CharacterRange { anchor: number; focus: number; start: number; end: number; length: number; collapsed: boolean }
export interface CharacterRangeChange<S = CharacterRangeSelectionModel> extends ControlEvent<S> {
  oldRange: CharacterRange | null; range: CharacterRange | null;
  oldValue: CharacterRange | null; newValue: CharacterRange | null;
}
export interface CharacterRangeEvents {
  beforeChange: CharacterRangeChange & { cancel: boolean };
  change: CharacterRangeChange; afterChange: CharacterRangeChange;
}
/** Half-open character positions; direction is preserved in anchor/focus. */
export declare class CharacterRangeSelectionModel {
  constructor(options?: { minimum?: number; maximum?: number; range?: CharacterRangeInput | null });
  readonly events: EventBus<CharacterRangeEvents>;
  readonly destroyed: boolean;
  readonly bounds: { minimum: number; maximum: number };
  get(): CharacterRange | null;
  set(range: CharacterRangeInput | null, options?: MutationOptions): boolean;
  clear(options?: MutationOptions): boolean;
  collapse(position: number, options?: MutationOptions): boolean;
  hasSelection(): boolean;
  setBounds(minimum: number, maximum: number, options?: MutationOptions): boolean;
  destroy(): void;
}
