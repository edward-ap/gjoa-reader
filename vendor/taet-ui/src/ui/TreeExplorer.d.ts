import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions, ItemId } from '../core/index.js';
import type { CommandRegistry } from '../core/CommandRegistry.js';
import type { TreeGrid } from './TreeGrid.js';
export interface ResourceItem { id: ItemId; parentId?: ItemId | null; name: string; kind: 'folder' | 'file'; [key: string]: unknown }
export type ResourceCommand = 'open' | 'newFolder' | 'newFile' | 'importFile' | 'addExisting' | 'rename' | 'delete' | 'cut' | 'copy' | 'paste' | 'properties' | 'refresh';
export type ResourceOperation = 'create' | 'rename' | 'delete' | 'move' | 'copy' | 'open' | 'importFile' | 'addExisting' | 'properties' | 'refresh';
export interface ResourceClipboard { id: ItemId; mode: 'cut' | 'copy' }
export interface ResourceContext { id: ItemId | null; item: ResourceItem | null; parentId: ItemId | null; clipboard: ResourceClipboard | null }
export interface ResourceRequest {
  command: ResourceOperation; id: ItemId | null; parentId: ItemId | null;
  items: ResourceItem[]; signal: AbortSignal; name?: string; kind?: 'folder' | 'file'; clipboard?: ResourceClipboard | null;
}
export interface ResourceResult { items: ResourceItem[]; selectId?: ItemId | null }
export interface ResourceProvider {
  /** Pure, synchronous availability rule; checked by every presentation and execute(). */
  canExecute?(command: ResourceCommand, context: ResourceContext): boolean;
  /** Mutations must return the complete authoritative tree. null is valid for non-mutating actions. */
  execute(request: ResourceRequest): ResourceResult | null | false | Promise<ResourceResult | null | false>;
}
export declare class MemoryResourceProvider implements ResourceProvider {
  canExecute(command: ResourceCommand, context?: ResourceContext): boolean;
  execute(request: ResourceRequest): ResourceResult | null;
}
export interface TreeExplorerOptions extends BaseControlOptions {
 translate?: (text: string, params: Record<string, unknown>) => string;
  renderName?: (item: ResourceItem) => Node | string;
  renderDetail?: (item: ResourceItem) => Node | string;
  detailWidth?: number;
  dragDrop?: boolean;
  showHeader?: boolean;
  rowHeight?: number;
  nodeIcon?: (item: ResourceItem) => string | null;
  title?: string; items?: ResourceItem[]; provider?: ResourceProvider; expandAll?: boolean;
}
export interface TreeExplorerEvents {
  operation: { source: TreeExplorer; command: ResourceOperation; id: ItemId | null; result: ResourceResult | null | false };
  operationError: { source: TreeExplorer; command: ResourceOperation; id: ItemId | null; error: unknown };
}
export declare class TreeExplorer extends BaseControl<TreeExplorerEvents> {
  constructor(options?: TreeExplorerOptions);
  constructor(container: string | HTMLElement, options?: TreeExplorerOptions);
  readonly grid: TreeGrid<ResourceItem, ItemId>;
  readonly commands: CommandRegistry;
  readonly provider: ResourceProvider;
  readonly busy: boolean;
  moveResource(id: ItemId, targetId: ItemId): Promise<boolean>;
  getResources(): ResourceItem[];
  setResources(items: ResourceItem[]): void;
  canExecute(command: ResourceCommand, id?: ItemId | null): boolean;
  execute(command: ResourceCommand, id?: ItemId | null): Promise<boolean>;
  destroy(): void;
}
