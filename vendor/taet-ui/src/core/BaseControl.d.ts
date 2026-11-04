import type { EventBus, EventHandler } from './EventBus.js';
import type { DisposableBag } from './DisposableBag.js';
import type { ChangeOrigin, MutationOptions } from './contracts.js';

export type ControlDimension = number | string | null;
export interface ControlSize { width: ControlDimension; height: ControlDimension }
export interface VisibilityOptions { origin?: ChangeOrigin; userAction?: boolean }
export interface FocusOptions extends VisibilityOptions { preventScroll?: boolean }
export interface ResizeOptions extends VisibilityOptions { silent?: boolean }

export interface ControlEvent<TSource = BaseControl> {
  source: TSource;
  origin: ChangeOrigin;
  userAction: boolean;
}
export interface ControlVisibilityEvent<TSource = BaseControl> extends ControlEvent<TSource> {}
export interface ControlBeforeVisibilityEvent<TSource = BaseControl> extends ControlVisibilityEvent<TSource> {
  cancel: boolean;
}
export interface ControlFocusEvent<TSource = BaseControl> extends ControlEvent<TSource> {
  nativeEvent: FocusEvent | undefined;
  relatedTarget: EventTarget | null;
}
export interface ControlKeyEvent<TSource = BaseControl> extends ControlEvent<TSource> {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  origin: 'user';
  userAction: true;
  nativeEvent: KeyboardEvent;
  cancel: boolean;
}
export interface ControlResizeEvent<TSource = BaseControl> extends ControlEvent<TSource>, ControlSize {
  oldSize: ControlSize | null;
  newSize: ControlSize;
  reason: string | undefined;
}
export interface ControlParentResizeEvent<TSource = BaseControl> extends ControlEvent<TSource> {
  parent: BaseControl;
  parentEvent: ControlResizeEvent & { type: string };
  size: ControlSize;
}
export interface ControlStateChange<TSource = BaseControl> extends ControlEvent<TSource> {
  name: string;
  oldValue: unknown;
  value: unknown;
}
export interface BaseControlEvents<TSource = BaseControl> {
  beforeShow: ControlBeforeVisibilityEvent<TSource>;
  show: ControlVisibilityEvent<TSource>;
  afterShow: ControlVisibilityEvent<TSource>;
  beforeHide: ControlBeforeVisibilityEvent<TSource>;
  hide: ControlVisibilityEvent<TSource>;
  afterHide: ControlVisibilityEvent<TSource>;
  focus: ControlFocusEvent<TSource>;
  blur: ControlFocusEvent<TSource>;
  keyDown: ControlKeyEvent<TSource>;
  keyUp: ControlKeyEvent<TSource>;
  resize: ControlResizeEvent<TSource>;
  parentResize: ControlParentResizeEvent<TSource>;
  stateChange: ControlStateChange<TSource>;
}
export interface BaseControlOptions<TSource = BaseControl> {
  name?: string;
  id?: string;
  disabled?: boolean;
  visible?: boolean;
  hidden?: boolean;
  width?: ControlDimension;
  height?: ControlDimension;
  tabIndex?: number | null;
  observeResize?: boolean;
  onResize?: EventHandler<ControlResizeEvent<TSource>>;
  onParentResize?: EventHandler<ControlParentResizeEvent<TSource>>;
  onFocus?: EventHandler<ControlFocusEvent<TSource>>;
  onBlur?: EventHandler<ControlFocusEvent<TSource>>;
  onKeyDown?: EventHandler<ControlKeyEvent<TSource>>;
  onKeyUp?: EventHandler<ControlKeyEvent<TSource>>;
}
/** Values are application-defined. Built-in CSS states depend on presence, even for false. */
export interface ControlState<TOwner = BaseControl> {
  get(name: string): unknown;
  set(name: string, value?: unknown, options?: MutationOptions): TOwner;
  clear(name: string, options?: MutationOptions): TOwner;
  has(name: string): boolean;
  all(): Record<string, unknown>;
}

/** A live control. Mounting needs a DOM; construction and state/cleanup do not. */
export declare class BaseControl<TEvents extends { [K in keyof TEvents]: object } = {}, TElement extends HTMLElement | SVGSVGElement = HTMLElement | SVGSVGElement> {
  constructor(options?: BaseControlOptions);
  readonly name: string | null;
  readonly id: string;
  readonly options: BaseControlOptions;
  readonly element: TElement | null;
  readonly parent: BaseControl | null;
  readonly events: EventBus<BaseControlEvents<this> & TEvents>;
  readonly disposables: DisposableBag;
  readonly state: Readonly<ControlState<this>>;
  readonly mounted: boolean;
  readonly disabled: boolean;
  readonly visible: boolean;
  readonly destroyed: boolean;
  readonly width: ControlDimension;
  readonly height: ControlDimension;
  readonly tabIndex: number | null;
  readonly observeResize: boolean;
  mount(container: HTMLElement | string): this;
  createElement(): TElement;
  refresh(): void;
  enable(): void;
  disable(): void;
  show(options?: VisibilityOptions): this;
  hide(options?: VisibilityOptions): this;
  isVisible(): boolean;
  getParent(): BaseControl | null;
  isChildOf(parent: BaseControl): boolean;
  getSize(): ControlSize;
  setSize(size: Partial<ControlSize>, options?: ResizeOptions): this;
  setSize(width?: ControlDimension, height?: ControlDimension, options?: ResizeOptions): this;
  setSize(width: ControlDimension | undefined, options: ResizeOptions): this;
  getFocusElement(): HTMLElement | null;
  canFocus(): boolean;
  focus(options?: FocusOptions): boolean;
  blur(options?: FocusOptions): boolean;
  isFocused(): boolean;
  setTabIndex(tabIndex: number | null): this;
  getTabIndex(): number | null;
  /** Idempotent; disposes registered resources, removes DOM and clears subscriptions. */
  destroy(): void;
}
