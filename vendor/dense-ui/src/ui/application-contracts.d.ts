import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlEvents, BaseControlOptions, ControlEvent, MutationOptions, EventBus, VisibilityOptions } from '../core/index.js';
import type { CommandRegistry } from '../core/CommandRegistry.js';
import type { OverlayManager } from '../core/OverlayManager.js';
import { Panel } from './container-contracts.js';
import type { PanelOptions, LayoutState } from './container-contracts.js';
import type { Button } from './display-contracts.js';
export type OverlayAnchor = HTMLElement | BaseControl | string;
export type OverlayContent = BaseControl | Node | string | null;
export type PopupPlacement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
export interface PopupOptions<S = Popup> extends BaseControlOptions<S> {
  anchor?: OverlayAnchor | null; content?: OverlayContent; placement?: PopupPlacement; offset?: number;
  destroyContent?: boolean;
  matchAnchorWidth?: boolean; modal?: boolean; closeOnOutsideClick?: boolean; closeOnEscape?: boolean;
  restoreFocus?: boolean; manager?: OverlayManager; className?: string; role?: string;
}
export interface PopupCloseOptions extends MutationOptions { result?: unknown; reason?: string }
export interface PopupEvents<S> {
  beforeOpen: ControlEvent<S> & { anchor: HTMLElement | null; cancel: boolean };
  open: ControlEvent<S> & { anchor: HTMLElement | null; cancel: undefined };
  beforeClose: ControlEvent<S> & { cancel: boolean; reason: string; result: unknown };
  close: PopupEvents<S>['beforeClose'];
}
export declare class Popup extends BaseControl<PopupEvents<Popup>, HTMLElement> {
  constructor(options?: PopupOptions);
  anchor: OverlayAnchor | null; content: OverlayContent; placement: PopupPlacement; offset: number; matchAnchorWidth: boolean;
  modal: boolean; closeOnOutsideClick: boolean; closeOnEscape: boolean; restoreFocus: boolean; manager: OverlayManager; className: string; role: string; opened: boolean;
  open(anchor?: OverlayAnchor | null, options?: VisibilityOptions): boolean;
  close(options?: PopupCloseOptions): boolean; isOpen(): boolean; reposition(): boolean;
}
export interface TooltipOptions extends PopupOptions<Tooltip> { showDelay?: number; hideDelay?: number; openOnHover?: boolean; openOnFocus?: boolean }
export declare class Tooltip extends Popup {
  constructor(options?: TooltipOptions); showDelay: number; hideDelay: number; openOnHover: boolean; openOnFocus: boolean;
  attach(anchor?: OverlayAnchor): this; detach(): this; scheduleOpen(origin?: string, nativeEvent?: Event | null): this; scheduleClose(origin?: string): this;
}
export interface DialogButton { text?: string; label?: string; result?: unknown; /** Enabled primary action also receives unhandled Enter from single-line fields. */ primary?: boolean; disabled?: boolean }
export interface DialogOptions extends Omit<PopupOptions<Dialog>, 'anchor' | 'modal' | 'role'> {
  translate?: (text: string, params: Record<string, unknown>) => string;
  title?: string; buttons?: readonly (DialogButton | Button)[]; closeable?: boolean; draggable?: boolean;
  defaultResult?: unknown; cancelResult?: unknown; ariaLabel?: string;
}
/** Dialog.open accepts options, while Popup.open accepts an anchor. */
export declare class Dialog extends BaseControl<PopupEvents<Dialog>, HTMLElement> {
  constructor(options?: DialogOptions);
  title: string; content: OverlayContent; buttons: (DialogButton | { control: Button; result: unknown })[];
  closeable: boolean; draggable: boolean; defaultResult: unknown; cancelResult: unknown; ariaLabel: string;
  anchor: null; placement: PopupPlacement; offset: number; matchAnchorWidth: boolean; modal: boolean;
  closeOnOutsideClick: boolean; closeOnEscape: boolean; restoreFocus: boolean; manager: OverlayManager; className: string; role: string; opened: boolean;
  open(options?: VisibilityOptions): boolean; showModal(options?: VisibilityOptions): Promise<unknown>;
  close(resultOrOptions?: unknown, options?: PopupCloseOptions): boolean; isOpen(): boolean; reposition(): boolean;
}
export interface MessageBoxOptions { title?: string; message?: OverlayContent; content?: OverlayContent; buttons?: readonly (DialogButton | Button)[]; cancelResult?: unknown; closeable?: boolean; origin?: string; okText?: string; cancelText?: string }
export declare class MessageBox { static show(options?: MessageBoxOptions): Promise<unknown>; static confirm(message: OverlayContent, options?: MessageBoxOptions): Promise<unknown>; static alert(message: OverlayContent, options?: MessageBoxOptions): Promise<unknown> }
export interface MenuItemInput {
  id?: string; name?: string; type?: 'item' | 'separator'; separator?: boolean; text?: string; label?: string;
  icon?: string; shortcut?: string; command?: string; disabled?: boolean; enabled?: boolean; hidden?: boolean; visible?: boolean; checked?: boolean;
  closeOnClick?: boolean;
  items?: readonly (MenuItemInput | '-')[]; onClick?: (event: ControlEvent<Menu> & { item: MenuItem; id: string }) => void;
}
export interface MenuItem extends Omit<MenuItemInput, 'id' | 'type' | 'items'> { id: string; type: 'item' | 'separator'; items?: MenuItem[] | null }
export type MenuOpenEvent<S> = ControlEvent<S> & ({ item: MenuItem; id: string } | { x: number; y: number });
export interface MenuEvents<S> {
  beforeOpen: MenuOpenEvent<S> & { cancel: boolean }; open: MenuOpenEvent<S>;
  beforeClose: ControlEvent<S> & { cancel: boolean }; close: ControlEvent<S>;
  itemClick: ControlEvent<S> & { item: MenuItem; id: string; commandId: string | null };
}
export interface MenuOptions<S = Menu> extends BaseControlOptions<S> { commands?: CommandRegistry; css?: string; className?: string; items?: readonly (MenuItemInput | '-')[]; overlayManager?: OverlayManager }
export declare class Menu extends BaseControl<MenuEvents<Menu>, HTMLElement> {
  refresh(): this;
  constructor(options?: MenuOptions); constructor(container: HTMLElement | string, options?: MenuOptions);
  commands: CommandRegistry | null; css: string; className: string; items: MenuItem[]; overlayManager: OverlayManager;
  setItems(items: readonly (MenuItemInput | '-')[]): this; addItem(item: MenuItemInput | '-'): this;
  addCommand(commandId: string, options?: MenuItemInput): this; addSeparator(): this; close(options?: MutationOptions): boolean;
}
export interface ContextMenuOptions extends MenuOptions<ContextMenu> { attachTo?: HTMLElement | string }
export declare class ContextMenu extends Menu {
  constructor(options?: ContextMenuOptions); constructor(container: HTMLElement | string, options?: ContextMenuOptions);
  attachTo: HTMLElement | string | null; openAt(x: number, y: number, options?: VisibilityOptions): boolean;
  openForEvent(event: MouseEvent, options?: VisibilityOptions): boolean; attach(target: HTMLElement | string): this;
}
export type TabOrientation = 'top' | 'bottom' | 'left' | 'right';
export interface TabInput { id?: string; name?: string; text?: string; label?: string; title?: string; panelId?: string | null; disabled?: boolean; closeable?: boolean; data?: unknown }
export interface TabItem { id: string; text: string; label: string; title: string; panelId: string | null; disabled: boolean; closeable: boolean; data: unknown }
export interface TabEvent extends ControlEvent<TabBar> { tab: TabItem; id: string }
export interface TabChange extends TabEvent { oldId: string | null; oldTab: TabItem | null }
export interface TabBarEvents {
  appearanceChange: ControlEvent<TabBar> & { name: 'bordered' | 'orientation'; oldValue: boolean | TabOrientation; value: boolean | TabOrientation };
  add: TabEvent; update: TabEvent & { patch: Partial<TabItem> };
  beforeClose: TabEvent & { cancel: boolean }; close: TabEvent & { activeId: string | null }; afterClose: TabBarEvents['close'];
  clear: ControlEvent<TabBar> & { tabs: TabItem[] }; beforeChange: TabChange & { cancel: boolean }; change: TabChange; afterChange: TabChange;
  tabClick: TabEvent & { nativeEvent: MouseEvent };
}
export interface TabBarOptions extends BaseControlOptions<TabBar> { css?: string; className?: string; closable?: boolean; allowCloseLast?: boolean; bordered?: boolean; orientation?: TabOrientation; overflowNavigation?: boolean; scrollStep?: number; tabs?: readonly TabInput[]; items?: readonly TabInput[]; activeId?: string | null; value?: string | null }
export declare class TabBar extends BaseControl<TabBarEvents, HTMLElement> {
  refresh(): this; enable(): this; disable(): this;
  constructor(options?: TabBarOptions); constructor(container: HTMLElement | string, options?: TabBarOptions);
  css: string; className: string; closable: boolean; allowCloseLast: boolean; bordered: boolean; orientation: TabOrientation; overflowNavigation: boolean; scrollStep: number; tabs: TabItem[]; activeId: string | null;
  isBordered(): boolean; setBordered(bordered: boolean, options?: MutationOptions): this; getOrientation(): TabOrientation; setOrientation(orientation: TabOrientation, options?: MutationOptions): this;
  addTab(tab: TabInput, options?: MutationOptions): this; updateTab(id: string, patch: Partial<TabItem>, options?: MutationOptions): boolean;
  removeTab(id: string, options?: MutationOptions & { force?: boolean }): boolean; clear(options?: MutationOptions): this;
  setActive(id: string, options?: MutationOptions): boolean; getActive(): TabItem | null; getTab(id: string): TabItem | null; all(): TabItem[];
}
export type HeaderAction = 'close' | 'minimize' | 'collapse' | 'pin' | 'unpin' | 'dock' | 'undock' | 'maximize' | 'restore';
export interface HeaderActionOptions { className?: string; command?: string; label?: string; tooltip?: string; pressed?: boolean | null; active?: boolean }
export declare function createHeaderAction(action: HeaderAction, options?: HeaderActionOptions): HTMLButtonElement;
export declare function setHeaderAction<T extends HTMLElement>(button: T, action: HeaderAction, options?: HeaderActionOptions): T;
export declare function headerActionLabel(action: HeaderAction): string;
export interface DockPanelOptions extends PanelOptions<DockPanel> {
  translate?: (text: string, params: Record<string, unknown>) => string; title?: string; label?: string; area?: string; closeable?: boolean; collapsible?: boolean; movable?: boolean; pinnable?: boolean; pinned?: boolean; autoHide?: boolean; collapsed?: boolean }
export interface DockPanelEvent<S = DockPanel> extends ControlEvent<S> { panel: DockPanel; panelId: string; area: string }
export interface DockPanelEvents { titleChange: DockPanelEvent & { oldValue: string; value: string }; beforeCollapse: DockPanelEvent & { cancel: boolean }; collapse: DockPanelEvent; beforeExpand: DockPanelEvent & { cancel: boolean }; expand: DockPanelEvent; beforeClose: DockPanelEvent & { cancel: boolean }; close: DockPanelEvent; beforePinChange: DockPanelEvent & { cancel: boolean; oldValue: boolean; value: boolean }; pinChange: DockPanelEvent & { oldValue: boolean; value: boolean } }
export declare class DockPanel extends Panel<DockPanelEvents> {
  constructor(options?: DockPanelOptions); constructor(container: HTMLElement | string, options?: DockPanelOptions);
  title: string; area: string; closeable: boolean; collapsible: boolean; movable: boolean; pinnable: boolean; pinned: boolean; collapsed: boolean;
  setTitle(title: string | null): this; collapse(options?: MutationOptions): boolean; expand(options?: MutationOptions): boolean; close(options?: MutationOptions): boolean;
  setPinned(pinned: boolean, options?: MutationOptions): boolean; pin(options?: MutationOptions): boolean; unpin(options?: MutationOptions): boolean;
}
export interface DockGroupEvents { panelAdd: Omit<DockPanelEvent<DockGroup>, 'area'>; panelRemove: DockGroupEvents['panelAdd']; activePanelChange: ControlEvent<DockGroup> & { oldPanelId: string | null; panelId: string; oldPanel: DockPanel | null; panel: DockPanel } }
export declare class DockGroup extends Panel<DockGroupEvents> {
  constructor(options?: PanelOptions<DockGroup> & { area?: string; activePanelId?: string | null; panels?: readonly DockPanel[] }); constructor(container: HTMLElement | string, options?: PanelOptions<DockGroup> & { area?: string; activePanelId?: string | null; panels?: readonly DockPanel[] });
  area: string; activePanelId: string | null; readonly tabs: TabBar;
  addPanel<T extends DockPanel>(panel: T, options?: MutationOptions & { activate?: boolean }): T;
  removePanel(panelOrId: DockPanel | string, options?: MutationOptions & { destroy?: boolean }): DockPanel | null;
  getPanel(id: string): DockPanel | null; panels(): DockPanel[]; setActivePanel(id: string, options?: MutationOptions): boolean; sync(options?: MutationOptions): this;
}
export type DockTreeNode = { type: 'group'; area: string } | { type: 'split'; direction: 'rows' | 'cols'; side: 'left' | 'right' | 'top' | 'bottom'; children: (DockTreeNode | null)[]; size?: { first: number | null; second: number | null } };
export interface DockState { main: LayoutState | null; middle: LayoutState | null; groups: Record<string, string | null>; workspace: DockTreeNode | null; areas: Record<string, DockTreeNode | null>; panels: { id: string; title: string; area: string; collapsed: boolean; visible: boolean; pinned: boolean }[] }
export interface DockMoveOptions extends MutationOptions { dropMode?: string; splitTargetArea?: string; activate?: boolean }
export type DockEvents = { [K in 'panelAdd' | 'panelCollapse' | 'panelExpand' | 'panelMove' | 'panelAutoHideShow' | 'panelAutoHideHide' | 'panelClose' | 'panelUnpin' | 'panelPin' | 'panelDragStart']: DockPanelEvent<DockLayout> & { oldArea?: string | null; dropMode?: string | null; splitTargetArea?: string | null } } & {
  stateRestore: ControlEvent<DockLayout> & { state: Partial<DockState> };
  panelDragEnd: DockPanelEvent<DockLayout> & { targetArea: string | null; targetGroup: string | null; dropMode: string | null; nativeEvent: PointerEvent };
};
export interface DockLayoutOptions extends PanelOptions<DockLayout> { showRestoreStrips?: boolean; leftSize?: number; rightSize?: number; bottomSize?: number; areaSizes?: { left?: number; right?: number; bottom?: number }; panels?: readonly (DockPanel | (DockPanelOptions & { content?: BaseControl | null }))[] }
export declare class DockLayout extends Panel<DockEvents> {
  constructor(options?: DockLayoutOptions); constructor(container: HTMLElement | string, options?: DockLayoutOptions);
  areaSizes: { left: number; right: number; bottom: number };
  addPanel(panelOrOptions: DockPanel | (DockPanelOptions & { content?: BaseControl | null })): DockPanel | null; getPanel(id: string): DockPanel | null; panels(): DockPanel[];
  collapsePanel(idOrPanel: string | DockPanel, options?: MutationOptions): boolean; expandPanel(idOrPanel: string | DockPanel, options?: MutationOptions): boolean; togglePanel(idOrPanel: string | DockPanel, options?: MutationOptions): boolean;
  movePanel(idOrPanel: string | DockPanel, area: string, options?: DockMoveOptions): boolean;
  splitPanel(idOrPanel: string | DockPanel, targetGroupId: string, side: 'left' | 'right' | 'top' | 'bottom', options?: DockMoveOptions): boolean;
  showAutoHidePanel(idOrPanel: string | DockPanel, options?: MutationOptions): boolean; hideAutoHidePanel(options?: MutationOptions): boolean;
  serializeState(): DockState; restoreState(state: Partial<DockState> | null, options?: MutationOptions): this;
}
export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface MdiWindowOptions extends PanelOptions<MdiWindow> { title?: string; label?: string; x?: number; y?: number; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; movable?: boolean; resizable?: boolean; collapsible?: boolean; closeable?: boolean; collapsed?: boolean; content?: BaseControl | null }
export interface WindowGeometryEvent extends ControlEvent<MdiWindow> { bounds: WindowBounds; reason: string; oldBounds?: WindowBounds }
export interface MdiWindowEvents { geometryInvalidate: { source: MdiWindow }; beforeGeometryChange: ControlEvent<MdiWindow> & { oldBounds: WindowBounds; bounds: WindowBounds; cancel: boolean }; geometryChange: WindowGeometryEvent; collapse: ControlEvent<MdiWindow>; expand: ControlEvent<MdiWindow>; beforeClose: ControlEvent<MdiWindow> & { cancel: boolean }; close: MdiWindowEvents['beforeClose'] }
export interface MdiWindowState extends WindowBounds { id: string; collapsed: boolean }
export declare class MdiWindow<E extends { [K in keyof E]: object } = {}> extends Panel<MdiWindowEvents & E> {
  constructor(options?: MdiWindowOptions); title: string; x: number; y: number; windowWidth: number; windowHeight: number; minWidth: number; minHeight: number; maxWidth: number; maxHeight: number;
  movable: boolean; resizable: boolean; collapsible: boolean; closeable: boolean; collapsed: boolean; content: BaseControl | null;
  getBounds(): WindowBounds; setBounds(bounds?: Partial<WindowBounds>, options?: MutationOptions & { reason?: string }): boolean;
  moveTo(x: number, y: number, options?: MutationOptions & { reason?: string }): boolean; resizeTo(width: number, height: number, options?: MutationOptions & { reason?: string }): boolean;
  collapse(options?: MutationOptions): boolean; expand(options?: MutationOptions): boolean; close(options?: MutationOptions): boolean; serializeState(): MdiWindowState;
}
export interface MdiWorkspaceEvents { windowAdd: ControlEvent<MdiWorkspace> & { window: MdiWindow; windowId: string }; windowRemove: MdiWorkspaceEvents['windowAdd']; windowGeometryChange: Omit<WindowGeometryEvent, 'source'> & { source: MdiWorkspace; window: MdiWindow; windowId: string }; activeWindowChange: ControlEvent<MdiWorkspace> & { oldWindow: MdiWindow | null; window: MdiWindow | null; oldWindowId: string | null; windowId: string | null } }
export declare class MdiWorkspace extends Panel<MdiWorkspaceEvents> {
  constructor(options?: PanelOptions<MdiWorkspace> & { constrainWindows?: boolean }); constructor(container: HTMLElement | string, options?: PanelOptions<MdiWorkspace> & { constrainWindows?: boolean });
  constrainWindows: boolean; activeWindow: MdiWindow | null;
  addWindow(windowOrOptions: MdiWindow | MdiWindowOptions, options?: MutationOptions): MdiWindow;
  removeWindow(idOrWindow: string | MdiWindow, options?: MutationOptions): BaseControl | null; windows(): MdiWindow[];
  activateWindow(idOrWindow: string | MdiWindow | null, options?: MutationOptions): boolean;
  constrainWindowBounds(window: MdiWindow, bounds: WindowBounds): WindowBounds; arrange(mode?: 'cascade', options?: MutationOptions): this;
  serializeState(): { activeWindowId: string | null; windows: MdiWindowState[] };
}
