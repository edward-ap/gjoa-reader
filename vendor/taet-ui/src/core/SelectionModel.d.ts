import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, MutationOptions } from './contracts.js';

export interface SelectionModelOptions { multiple?: boolean }
export interface SelectionChange<T> {
  source: SelectionModel<T>;
  oldItems: T[];
  items: T[];
  oldValue: T[];
  newValue: T[];
  origin: ChangeOrigin;
  userAction: boolean;
}
export interface SelectionEvents<T> {
  /** Technical synchronization after each accepted write, including silent writes. */
  invalidate: SelectionChange<T> & { silent: boolean };
  beforeChange: SelectionChange<T> & { cancel: boolean };
  change: SelectionChange<T>;
  afterChange: SelectionChange<T>;
}
export declare class SelectionModel<T = unknown> {
  constructor(options?: SelectionModelOptions);
  events: EventBus<SelectionEvents<T>>;
  multiple: boolean;
  readonly destroyed: boolean;
  get(): T[];
  set(items: readonly T[], options?: MutationOptions): boolean;
  clear(options?: MutationOptions): boolean;
  hasAny(): boolean;
  destroy(): void;
}
