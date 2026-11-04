import { Panel } from './container-contracts.js';
import type { PanelOptions } from './container-contracts.js';
import type { BaseControl, ControlEvent, MutationOptions } from '../core/index.js';
export interface SidePanelPlacement { side: 'left' | 'right'; tabPosition: number }
export interface HidingSidePanelOptions extends PanelOptions<HidingSidePanel> {
  title?: string; closeLabel?: string; resizeLabel?: string; tabHint?: string;
  side?: 'left' | 'right'; tabPosition?: number; panelWidth?: number; opened?: boolean; content?: BaseControl;
}
export interface SidePanelMutationOptions extends MutationOptions { restoreFocus?: boolean }
export interface HidingSidePanelEvents {
  openChange: ControlEvent<HidingSidePanel> & { oldValue: boolean; value: boolean };
  placementChange: ControlEvent<HidingSidePanel> & { oldValue: SidePanelPlacement; value: SidePanelPlacement };
  widthChange: ControlEvent<HidingSidePanel> & { oldValue: number; value: number };
}
export declare class HidingSidePanel extends Panel<HidingSidePanelEvents> {
  constructor(options?: HidingSidePanelOptions);
  constructor(container: HTMLElement | string, options?: HidingSidePanelOptions);
  readonly side: 'left' | 'right'; readonly tabPosition: number; readonly panelWidth: number; readonly opened: boolean; readonly title: string;
  setOpen(opened: boolean, options?: SidePanelMutationOptions): this;
  toggle(options?: SidePanelMutationOptions): this;
  setPlacement(side: 'left' | 'right', tabPosition: number, options?: MutationOptions): this;
  setPanelWidth(width: number, options?: MutationOptions): this;
}
