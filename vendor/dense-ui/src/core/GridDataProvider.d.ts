import type { EventBus } from './EventBus.js';
import type { MutationMetadataOptions } from './contracts.js';

/** Base paging envelope; extend it with your backend's typed query fields. */
export interface DataProviderRequest { page?: number; pageSize?: number | null }
export interface DataProviderOptions extends MutationMetadataOptions { signal?: AbortSignal }
export interface DataProviderResult<T extends object> {
  items: readonly T[];
  totalCount?: number;
  page?: number | null;
  pageSize?: number | null;
}
export interface DataProviderResponse<T extends object> {
  /** The provider preserves the loader's array; it does not clone records or validate their schema. */
  items: readonly T[];
  totalCount: number;
  page: number;
  pageSize: number | null;
}
export type DataProviderLoader<T extends object, Q extends DataProviderRequest = DataProviderRequest> =
  (request: Q, options: DataProviderOptions & { signal: AbortSignal }) => DataProviderResult<T> | PromiseLike<DataProviderResult<T>>;
export interface DataProviderEvents<T extends object, Q extends DataProviderRequest = DataProviderRequest> {
  loading: { source: GridDataProvider<T, Q>; request: Q };
  load: { source: GridDataProvider<T, Q>; request: Q; response: DataProviderResponse<T> };
  error: { source: GridDataProvider<T, Q>; request: Q; error: unknown };
}
/** Experimental; each request supersedes the previous one. Creator owns destroy(). */
export declare class GridDataProvider<T extends object = Record<string, unknown>, Q extends DataProviderRequest = DataProviderRequest> {
  constructor(load: DataProviderLoader<T, Q>);
  events: EventBus<DataProviderEvents<T, Q>>;
  loading: boolean;
  destroyed: boolean;
  request(request: Q, options?: DataProviderOptions): Promise<DataProviderResponse<T>>;
  destroy(): void;
}
