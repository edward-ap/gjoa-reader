/** Mutation provenance accepted by the existing runtime. */
export type ChangeOrigin = 'user' | 'api' | 'command' | 'import' | 'restore' | 'undo' | 'redo' | 'host' | 'system';
export interface MutationOptions {
  silent?: boolean;
  userAction?: boolean;
  origin?: ChangeOrigin;
}
export interface MutationMetadataOptions extends MutationOptions {
  reason?: string | undefined;
  operation?: string | undefined;
}
export interface NormalizedMutationOptions {
  silent: boolean;
  userAction: boolean;
  origin: ChangeOrigin;
  reason: string | undefined;
  operation: string | undefined;
}
/** Structural value protocol, not a constructor or a declaration of every UI control. */
export interface ValueApi<TValue> {
  get(): TValue;
  set(value: TValue, options?: MutationOptions): boolean;
  clear(options?: MutationOptions): boolean;
}
export interface Subscription {
  off(): void;
  dispose(): void;
}
export type Disposable = (() => void) | { dispose(): void } | { off(): void };
export type ItemId = string | number;
