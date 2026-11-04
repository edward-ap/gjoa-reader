import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions, ControlEvent, EventHandler, MutationOptions } from '../core/index.js';
export interface StepContentBlock { caption: string; description: string; image?: string }
export interface StepContentBlockInput {
  caption?: string; text?: string; description?: string; details?: string; image?: string;
}
export interface StepProgressItemOptions {
  [key: string]: unknown;
  id?: string | number; name?: string; caption?: string; text?: string; label?: string;
  description?: string; caption2?: string; description2?: string;
  contentBlock1?: string | StepContentBlockInput; block1?: string | StepContentBlockInput;
  contentBlock2?: string | StepContentBlockInput; block2?: string | StepContentBlockInput;
  enabled?: boolean; disabled?: boolean; allowUserInteraction?: boolean;
  progress?: number; state?: 'default' | 'active' | 'inactive' | 'error';
  icon?: string; tooltip?: string; title?: string;
}
export type StepProgressItemInput = StepProgressItemOptions | string | number | boolean | null | undefined;
export interface StepProgressItem {
  [key: string]: unknown;
  id: string | number; caption: string; description: string;
  contentBlock1: StepContentBlock; contentBlock2: StepContentBlock;
  enabled: boolean; allowUserInteraction: boolean; progress: number;
  state: 'default' | 'active' | 'inactive' | 'error'; icon: string; tooltip: string;
}
export type StepLayoutMode = 'compact' | 'fixed' | 'fullSize';
export type StepContentAlignment = 'start' | 'center' | 'end';
export interface StepProgressEvents {
  itemClick: ControlEvent<StepProgressBar> & { item: StepProgressItem; index: number; nativeEvent: MouseEvent | KeyboardEvent; cancel: boolean; handled: boolean };
  selectedItemChanged: ControlEvent<StepProgressBar> & { oldValue: number; newValue: number; selectedItem: StepProgressItem | null; selectedItems: StepProgressItem[] };
  itemsChange: ControlEvent<StepProgressBar> & { oldValue: StepProgressItem[]; newValue: StepProgressItem[] };
  itemProgressChange: ControlEvent<StepProgressBar> & { item: StepProgressItem; index: number; oldValue: number; newValue: number };
}
export interface StepProgressBarOptions extends BaseControlOptions<StepProgressBar> {
  items?: readonly StepProgressItemInput[];
  selectedItemIndex?: number; selectedIndex?: number;
  orientation?: 'horizontal' | 'vertical'; layoutMode?: StepLayoutMode; layout?: StepLayoutMode;
  contentAlignment?: StepContentAlignment;
  inverse?: boolean; reverse?: boolean; drawConnectors?: boolean;
  allowUserInteraction?: boolean; interactive?: boolean;
  css?: string; className?: string;
  indicatorWidth?: number; indicatorSize?: number; indicatorLineThickness?: number;
  connectorLineThickness?: number; indentBetweenItems?: number; connectorOffset?: number;
  showIndex?: boolean;
  onItemClick?: EventHandler<StepProgressEvents['itemClick']>;
  onSelectedItemChanged?: EventHandler<StepProgressEvents['selectedItemChanged']>;
}
/** Experimental workflow indicator; selection is an index, not an EditorControl value. */
export declare class StepProgressBar extends BaseControl<StepProgressEvents, HTMLElement> {
  constructor(options?: StepProgressBarOptions);
  constructor(container: HTMLElement | string, options?: StepProgressBarOptions);
  items: StepProgressItem[]; selectedItemIndex: number;
  orientation: 'horizontal' | 'vertical'; layoutMode: StepLayoutMode; contentAlignment: StepContentAlignment;
  inverse: boolean; drawConnectors: boolean; allowUserInteraction: boolean;
  css: string; className: string; indicatorWidth: number; indicatorLineThickness: number;
  connectorLineThickness: number; indentBetweenItems: number; connectorOffset: number; showIndex: boolean;
  refresh(): this;
  setItems(items?: readonly StepProgressItemInput[], options?: MutationOptions): this;
  getItems(): StepProgressItem[];
  getSelectedItemIndex(): number;
  getSelectedItems(): StepProgressItem[];
  selectItem(itemOrIndex: StepProgressItem | number, options?: MutationOptions): boolean;
  setSelectedItemIndex(index: number, options?: MutationOptions): boolean;
  selectAll(options?: MutationOptions): boolean;
  unselectAll(options?: MutationOptions): boolean;
  selectNext(options?: MutationOptions): boolean;
  selectPrevious(options?: MutationOptions): boolean;
  setItemProgress(itemOrIndex: StepProgressItem | number, progress: number, options?: MutationOptions): boolean;
  scrollToItem(itemOrIndex: StepProgressItem | number): boolean;
}
