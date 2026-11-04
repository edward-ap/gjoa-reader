import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions, ControlEvent } from '../core/BaseControl.js';
import type { EventHandler } from '../core/EventBus.js';
import type { MutationOptions, ItemId } from '../core/contracts.js';
import type { DataStore } from '../core/DataStore.js';
import type { DefaultItemId } from '../core/DataStore.js';
import type { SelectionModel } from '../core/SelectionModel.js';
import type { List } from './List.js';
import type { TreeList } from './collection-contracts.js';
import type { Grid } from './Grid.js';
import type { TreeGrid } from './TreeGrid.js';
import { MdiWindow } from './application-contracts.js';
import type { MdiWindowOptions, MdiWorkspace } from './application-contracts.js';

export interface Point { x: number; y: number }
export type PortSide = 'left' | 'right' | 'top' | 'bottom';
export interface ConnectorEndpoint { controlId: string; itemId?: ItemId; portId?: ItemId; side?: PortSide }
export interface ConnectorInput { id: string; source: ConnectorEndpoint; target: ConnectorEndpoint; type?: string; directed?: boolean; label?: string; data?: unknown; routing?: 'curve' | 'straight' }
export interface Connector extends ConnectorInput { source: ConnectorEndpoint & { side: PortSide }; target: ConnectorEndpoint & { side: PortSide }; type: string; directed: boolean }
export declare class ConnectorModel {
  constructor(options?: { items?: readonly ConnectorInput[] });
  readonly data: DataStore<Connector, string>; readonly events: DataStore<Connector, string>['events']; readonly destroyed: boolean;
  parse(items: readonly ConnectorInput[], options?: MutationOptions): this;
  add(connector: ConnectorInput, options?: MutationOptions): Connector;
  update(id: string, patch: Partial<ConnectorInput>, options?: MutationOptions): boolean;
  remove(id: string, options?: MutationOptions): boolean;
  all(): Connector[]; get(id: string): Connector | null; destroy(): void;
}
export interface PortPosition extends Point { proxyItemId?: ItemId; status: 'visible' | 'above' | 'below' | 'collapsed' | 'missing' }
export interface ConnectorPort extends ConnectorEndpoint, Partial<PortPosition> { side: PortSide; label?: string; aggregate?: boolean; interactive?: boolean }
export interface PortSubscription { dispose(): unknown; off(): unknown }
export interface PortProvider {
  readonly controlId: string;
  readonly destroyed?: boolean;
  getPortPosition(endpoint: ConnectorEndpoint): PortPosition | null;
  getPorts?(): ConnectorPort[];
  onChange?(handler: (event: { source: PortProvider }) => void): PortSubscription;
  destroy?(): void;
}
export interface ConnectorLayerOptions extends BaseControlOptions<ConnectorLayer> {
  model?: ConnectorModel; items?: readonly ConnectorInput[]; selection?: SelectionModel<Connector>;
  workspace?: MdiWorkspace; ariaLabel?: string;
  canConnect?: ((event: { source: ConnectorLayer; connector: ConnectorInput; oldConnector: Connector | null }) => boolean) | null;
}
export interface ConnectorLayerEvents {
  connectionCreate: ControlEvent<ConnectorLayer> & { connector: Connector };
  beforeConnectionChange: ControlEvent<ConnectorLayer> & { connector: ConnectorInput; oldConnector: Connector | null; cancel: boolean };
  connectionChange: ControlEvent<ConnectorLayer> & { connector: Connector | null; oldConnector: Connector };
  beforeConnectionRemove: ControlEvent<ConnectorLayer> & { connector: Connector; cancel: boolean };
  connectionRemove: ConnectorLayerEvents['beforeConnectionRemove'];
}
export declare class ConnectorLayer extends BaseControl<ConnectorLayerEvents, SVGSVGElement> {
  constructor(options?: ConnectorLayerOptions);
  readonly model: ConnectorModel; readonly selection: SelectionModel<Connector>; readonly workspace: MdiWorkspace | null;
  readonly providers: Map<string, PortProvider>;
  registerProvider<P extends PortProvider>(provider: P): P;
  unregisterProvider(controlId: string): PortProvider | null;
  canConnect: ConnectorLayerOptions['canConnect'];
  connect(source: ConnectorEndpoint, target: ConnectorEndpoint, options?: MutationOptions): Connector | null;
  reconnect(id: string, end: 'source' | 'target', endpoint: ConnectorEndpoint, options?: MutationOptions): boolean;
  removeConnection(id: string, options?: MutationOptions): boolean;
  startReconnect(id: string, end?: 'source' | 'target'): boolean;
  cancelConnection(): void;
  requestRender(): void; render(): this;
}
export interface PortProviderOptions {
  controlId?: string; sides?: readonly PortSide[]; portElements?: Partial<Record<PortSide, HTMLElement>> | null;
  window?: MdiWindow | null; rowHeight?: number;
}
export declare class GridPortProvider<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> implements PortProvider {
  constructor(grid: Grid<T, I> | TreeGrid<T, I>, options?: PortProviderOptions);
  readonly controlId: string;
  getPortPosition(endpoint: ConnectorEndpoint): PortPosition | null;
  getPorts(): ConnectorPort[];
  onChange(handler: (event: { source: GridPortProvider<T, I> }) => void): PortSubscription;
  destroy(): void;
}
export declare class ListPortProvider<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> implements PortProvider {
  constructor(list: List<T, I>, options?: PortProviderOptions);
  readonly controlId: string; readonly destroyed: boolean;
  getPortPosition(endpoint: ConnectorEndpoint): PortPosition | null;
  getPorts(): ConnectorPort[];
  onChange(handler: (event: { source: ListPortProvider<T, I>; destroyed: boolean }) => void): PortSubscription;
  destroy(): void;
}
export declare class TreeListPortProvider<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> extends ListPortProvider<T, I> {
  constructor(tree: TreeList<T, I>, options?: PortProviderOptions);
}
export interface StaticPortInput { id: string; side: 'left' | 'right'; label?: string }
export interface StaticPort extends StaticPortInput { label: string }
export interface StaticPortProviderOptions extends PortProviderOptions { controlId: string; ports?: readonly StaticPortInput[]; portSpacing?: number }
export declare class StaticPortProvider implements PortProvider {
  constructor(options: StaticPortProviderOptions);
  readonly controlId: string;
  all(): StaticPort[]; setPorts(ports: readonly StaticPortInput[]): this;
  addPort(port: StaticPortInput): StaticPort; removePort(id: string, side?: PortSide | null): StaticPort | null;
  getPorts(): ConnectorPort[]; getPortPosition(endpoint: ConnectorEndpoint): PortPosition | null;
  onChange(handler: (event: { source: StaticPortProvider }) => void): PortSubscription;
  destroy(): void;
}
export interface MapperWindowOptions extends MdiWindowOptions {
  portSides?: readonly ('left' | 'right')[]; portDefinitions?: readonly StaticPortInput[] | null; statusText?: string;
  portProviderFactory?: (content: BaseControl | null, options: PortProviderOptions & { controlId: string; ports: readonly StaticPortInput[] | null; window: MapperWindow }) => PortProvider;
}
export declare class MapperWindow extends MdiWindow {
  constructor(options?: MapperWindowOptions);
  readonly portProvider: PortProvider | null; readonly portSides: ('left' | 'right')[];
  readonly portDefinitions: readonly StaticPortInput[] | null; readonly statusText: string;
  connect(layer: ConnectorLayer): this; setStatus(text: string | number | null): this;
}
