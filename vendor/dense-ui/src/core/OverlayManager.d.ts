import type { EventBus } from './EventBus.js';
export interface OverlayOpenOptions {
  silent?: boolean;
  element?: HTMLElement; anchor?: HTMLElement | null; modal?: boolean; closeOnOutsideClick?: boolean; closeOnEscape?: boolean; restoreFocus?: boolean;
  requestClose?: (request: { reason: string; nativeEvent: Event }) => void; containsTarget?: (target: EventTarget | null) => boolean;
}
export interface OverlayEntry {
  overlay: object; element: HTMLElement; anchor: HTMLElement | null; modal: boolean;
  closeOnOutsideClick: boolean; closeOnEscape: boolean; restoreFocus: boolean; previousFocus: HTMLElement | null;
  requestClose: OverlayOpenOptions['requestClose']; containsTarget: OverlayOpenOptions['containsTarget'] | null; backdrop?: HTMLElement;
}
export declare class OverlayManager {
  constructor(options?: { baseZIndex?: number }); baseZIndex: number;
  events: EventBus<{ open: { source: OverlayManager; overlay: object; modal: boolean }; close: { source: OverlayManager; overlay: object; modal: boolean } }>;
  getRoot(): HTMLElement; all(): object[]; top(): object | null; has(overlay: object): boolean;
  open(overlay: object, options?: OverlayOpenOptions): OverlayEntry;
  close(overlay: object, options?: { silent?: boolean | undefined; restoreFocus?: boolean }): boolean;
  destroy(): void;
}
export declare const overlayManager: OverlayManager;
