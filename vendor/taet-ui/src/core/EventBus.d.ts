import type { Subscription } from './contracts.js';

export type EventHandler<TPayload extends object> = (event: TPayload & { type: string }) => void;
/** Standalone buses add type, not source; payloads are supplied by the emitter. */
export declare class EventBus<TEvents extends { [K in keyof TEvents]: object } = Record<string, Record<string, unknown>>> {
  constructor();
  readonly destroyed: boolean;
  on<K extends Extract<keyof TEvents, string>>(eventName: K, handler: EventHandler<TEvents[K]>): Subscription;
  once<K extends Extract<keyof TEvents, string>>(eventName: K, handler: EventHandler<TEvents[K]>): Subscription;
  off<K extends Extract<keyof TEvents, string>>(eventName: K, handler: EventHandler<TEvents[K]>): void;
  emit<K extends Extract<keyof TEvents, string>>(
    eventName: K,
    ...payload: {} extends TEvents[K] ? [event?: TEvents[K] & { type?: string }] : [event: TEvents[K] & { type?: string }]
  ): TEvents[K] & { type: string };
  clear(): void;
  destroy(): void;
}
