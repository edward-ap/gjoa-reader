import type { EventBus } from './EventBus.js';
import type { ChangeOrigin, MutationOptions } from './contracts.js';

export type GridSearchMode = 'highlight' | 'filter';
export interface GridSearchState { query: string; mode: GridSearchMode; columns: string[] | null }
export interface GridSearchOptions {
  query?: string | null;
  mode?: GridSearchMode;
  /** Numeric IDs are normalized to strings and duplicates removed. */
  columns?: readonly (string | number)[] | null;
}
export interface GridSearchChange {
  source: GridSearchModel;
  oldState: GridSearchState;
  state: GridSearchState;
  origin: ChangeOrigin;
  userAction: boolean;
}
export interface GridSearchEvents {
  invalidate: GridSearchChange & { silent: boolean };
  beforeChange: GridSearchChange & { cancel: boolean };
  change: GridSearchChange;
  afterChange: GridSearchChange;
}
/** Experimental state model. Searching/highlighting is performed by Grid. */
export declare class GridSearchModel {
  constructor(options?: GridSearchOptions);
  readonly events: EventBus<GridSearchEvents>;
  readonly destroyed: boolean;
  readonly query: string;
  readonly mode: GridSearchMode;
  readonly columns: string[] | null;
  getState(): GridSearchState;
  set(query: string | null, options?: MutationOptions): boolean;
  setMode(mode: GridSearchMode, options?: MutationOptions): boolean;
  setColumns(columns: readonly (string | number)[] | null, options?: MutationOptions): boolean;
  /** Missing fields reset to defaults, rather than retaining the previous state. */
  restoreState(state: GridSearchOptions, options?: MutationOptions): boolean;
  clear(options?: MutationOptions): boolean;
  hasQuery(): boolean;
  destroy(): void;
}
