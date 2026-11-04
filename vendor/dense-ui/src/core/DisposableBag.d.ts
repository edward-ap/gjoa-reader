import type { Disposable } from './contracts.js';

export declare class DisposableBag {
  constructor();
  readonly disposed: boolean;
  add<T extends Disposable | null | undefined | false>(disposable: T): T;
  addEventListener<K extends keyof WindowEventMap>(target: Window, type: K,
    handler: (this: Window, event: WindowEventMap[K]) => void, options?: boolean | AddEventListenerOptions): { dispose(): void };
  addEventListener<K extends keyof DocumentEventMap>(target: Document, type: K,
    handler: (this: Document, event: DocumentEventMap[K]) => void, options?: boolean | AddEventListenerOptions): { dispose(): void };
  addEventListener<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K,
    handler: (this: HTMLElement, event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions): { dispose(): void };
  addEventListener(target: EventTarget, type: string, handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions): { dispose(): void };
  clear(): void;
  dispose(): void;
}
