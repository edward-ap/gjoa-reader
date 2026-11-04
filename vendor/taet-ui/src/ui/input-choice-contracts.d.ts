/** Borrowed overlay protocol used by Select and date/time controls. */
export interface InputOverlayService {
  getRoot(): HTMLElement;
  open(overlay: object, options: {
    element: HTMLElement;
    anchor: HTMLElement | null;
    modal: boolean;
    closeOnOutsideClick: boolean;
    closeOnEscape: boolean;
    restoreFocus: boolean;
    requestClose: (request: { reason: string; nativeEvent?: Event }) => void;
  }): unknown;
  close(overlay: object, options: { silent?: boolean | undefined; restoreFocus: boolean }): unknown;
}
