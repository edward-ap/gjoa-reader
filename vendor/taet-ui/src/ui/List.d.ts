import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlEvents, BaseControlOptions, ControlEvent, ControlDimension, DataStore, DataStoreChange, DefaultItemId, EventBus, ItemId, SelectionModel } from '../core/index.js';
export interface ItemGeometry<I extends ItemId = ItemId> {
  id: I; anchorId: I | null;
  status: 'visible' | 'above' | 'below' | 'collapsed' | 'filtered' | 'missing' | 'hidden';
  rect: DOMRectReadOnly | null; viewport: DOMRectReadOnly | null;
}
export interface ListRenderContext<T extends object, I extends ItemId, S> {
  source: S; id: I; index: number; selected: boolean; active: boolean;
  /** Present for TreeList. */
  level?: number; hasChildren?: boolean; expanded?: boolean;
}
export interface ListEvents<T extends object, I extends ItemId, S> {
  /** Technical synchronization, also emitted after silent updates. */
  itemGeometryChange: { source: S };
  dataChange: ControlEvent<S> & { dataEvent: DataStoreChange<T, I> };
  selectionChange: ControlEvent<S> & { items: T[]; oldItems: T[] };
  itemClick: ControlEvent<S> & { item: T; id: I; nativeEvent: MouseEvent };
  itemDblClick: ControlEvent<S> & { item: T; id: I; nativeEvent: MouseEvent };
  activeChange: ControlEvent<S> & { oldId: I | null; id: I; item: T };
}
export interface ListOptions<T extends object, I extends ItemId = DefaultItemId<T>, S = List<T, I>> extends BaseControlOptions<S> {
  label?: string; css?: string; className?: string;
  textField?: Extract<keyof T, string> | ((item: T) => string | number);
  iconField?: Extract<keyof T, string>;
  itemHeight?: ControlDimension;
  renderItem?: ((item: T, context: ListRenderContext<T, I, S>) => Node | string | number | null | undefined) | null;
  multiSelect?: boolean;
  data?: DataStore<T, I>; selection?: SelectionModel<T>;
  idField?: Extract<keyof T, string>; getId?: ((item: T, index: number) => I) | null;
}
/** Experimental standalone collection; exported by taet-ui/experimental and taet-ui/all. */
export declare class List<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>, E extends { [K in keyof E]: object } = {}> extends BaseControl<E, HTMLElement> {
  constructor(options?: ListOptions<T, I>);
  constructor(container: HTMLElement | string, options?: ListOptions<T, I>);
  readonly events: EventBus<BaseControlEvents<this> & ListEvents<T, I, this> & E>;
  data: DataStore<T, I>; selection: SelectionModel<T>;
  css: string; className: string; multiSelect: boolean;
  textField: string | ((item: T) => string | number); iconField: string;
  itemHeight: ControlDimension;
  renderItem: ((item: T, context: ListRenderContext<T, I, this>) => Node | string | number | null | undefined) | null;
  getItemGeometry(id: I): ItemGeometry<I>;
  getVisibleItemGeometries(): ItemGeometry<I>[];
  refresh(): this;
}
