import { BaseControl } from '../core/BaseControl.js';
import { List } from './List.js';
import { Panel } from './container-contracts.js';
import type { ListOptions } from './List.js';
import type { PanelOptions } from './container-contracts.js';
import type { BaseControlOptions, ControlEvent, DataStore, SelectionModel, TreeDataView, TreeDataViewEntry, TreeDataViewChange, DefaultItemId, ItemId, MutationOptions, EventHandler } from '../core/index.js';
import type { GridEditorFactory, CellEditor } from './grid-editor-contracts.js';
export type NodeDropPosition = 'before' | 'inside' | 'after';
export interface NodeMove<T extends object, I extends ItemId> { id: I; item: T; targetId: I; targetItem: T; position: NodeDropPosition; oldParentId: unknown; parentId: unknown; oldIndex: number; index: number }
export interface TreeListEvents<T extends object, I extends ItemId> {
  treeViewChange: ControlEvent<TreeList<T, I>> & { viewEvent: TreeDataViewChange<T, I>; reason: string | undefined };
  expand: ControlEvent<TreeList<T, I>> & { id: I; item: T | null }; collapse: TreeListEvents<T, I>['expand'];
  expandAll: ControlEvent<TreeList<T, I>>; collapseAll: ControlEvent<TreeList<T, I>>;
  beforeNodeMove: ControlEvent<TreeList<T, I>> & NodeMove<T, I> & { cancel: boolean; nativeEvent: Event | null };
  nodeMove: Omit<TreeListEvents<T, I>['beforeNodeMove'], 'cancel' | 'item' | 'targetItem'> & { cancel: undefined; item: T | undefined; targetItem: T | undefined };
  nodeDragStart: ControlEvent<TreeList<T, I>> & { id: I; item: T; nativeEvent: DragEvent };
  nodeDragEnd: ControlEvent<TreeList<T, I>> & { id: I; item: T | null };
}
export interface TreeListOptions<T extends object, I extends ItemId = DefaultItemId<T>> extends ListOptions<T, I, TreeList<T, I>> {
  parentField?: Extract<keyof T, string>; rootParentId?: ItemId | null; treeView?: TreeDataView<T, I>; expandedIds?: Iterable<I>; expandAll?: boolean;
  expandOnClick?: boolean; nodeReorder?: boolean; canDropNode?: (move: NodeMove<T, I> & { source: TreeList<T, I> }) => boolean;
  onBeforeNodeMove?: EventHandler<TreeListEvents<T, I>['beforeNodeMove']>; onNodeMove?: EventHandler<TreeListEvents<T, I>['nodeMove']>;
  onNodeDragStart?: EventHandler<TreeListEvents<T, I>['nodeDragStart']>; onNodeDragEnd?: EventHandler<TreeListEvents<T, I>['nodeDragEnd']>;
}
export declare class TreeList<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> extends List<T, I, TreeListEvents<T, I>> {
  constructor(options?: TreeListOptions<T, I>); constructor(container: HTMLElement | string, options?: TreeListOptions<T, I>);
  parentField: string; rootParentId: ItemId | null; treeView: TreeDataView<T, I>; expandOnClick: boolean; nodeReorderEnabled: boolean;
  nodeDropValidator: TreeListOptions<T, I>['canDropNode'] | null;
  expand(idOrItem: I | T, options?: MutationOptions): boolean; collapse(idOrItem: I | T, options?: MutationOptions): boolean; toggle(idOrItem: I | T, options?: MutationOptions): boolean;
  expandAll(options?: MutationOptions): this; collapseAll(options?: MutationOptions): this; isExpanded(idOrItem: I | T): boolean;
  canMoveNode(sourceIdOrItem: I | T, targetIdOrItem: I | T, position?: NodeDropPosition): boolean;
  moveNode(sourceIdOrItem: I | T, targetIdOrItem: I | T, position?: NodeDropPosition, options?: MutationOptions & { nativeEvent?: Event; expandTarget?: boolean }): boolean;
}
export declare class TreeNodeDragController<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>> {
  constructor(tree: TreeList<T, I>); tree: TreeList<T, I> | null; state: { sourceId: I; targetId: I | null; position: NodeDropPosition | null } | null;
  attach(row: HTMLElement, entry: TreeDataViewEntry<T, I>): void; start(event: DragEvent, entry: TreeDataViewEntry<T, I>, row: HTMLElement): boolean;
  over(event: DragEvent, targetEntry: TreeDataViewEntry<T, I>, row: HTMLElement): boolean; leave(event: DragEvent, row: HTMLElement): void;
  drop(event: DragEvent, targetEntry: TreeDataViewEntry<T, I>): boolean; clearMarkers(): void; finish(): void; destroy(): void;
}
export type PropertySortMode = 'categorized' | 'alphabetical' | 'none';
export interface PropertyDefinition {
  name: string; type: string; path?: string; label?: string; value?: unknown; readOnly?: boolean; description?: string; help?: string;
  min?: number | string; max?: number | string; step?: number; onText?: string; offText?: string; layout?: 'column' | 'flow';
  options?: readonly (string | number | { id?: unknown; value?: unknown; text?: string; label?: string })[];
  children?: PropertyDefinition[]; editor?: PropertyEditor;
  set?: (value: unknown, event: PropertyChange) => void;
}
export interface PropertyGroupInput { id?: string; name?: string; title?: string; properties?: PropertyDefinition[] }
export interface PropertyGroup { id: string; name: string; title: string; properties: PropertyDefinition[] }
export interface PropertyModel { source?: object; groups: PropertyGroupInput[] }
export type PropertySource = PropertyGroupInput[] | PropertyModel | { getProperties(): PropertyGroupInput[] | PropertyModel; setProperty?(name: string, value: unknown, options?: MutationOptions): unknown };
export interface PropertyRow { __duiPropertyId: string; kind: 'property'; group: PropertyGroup; categoryId: string; property: PropertyDefinition; propertyKey: string; name: string; label: string; value: unknown; level: number; expandable: boolean; expanded: boolean }
export interface PropertyCategoryRow { __duiPropertyId: string; kind: 'category'; group: PropertyGroup; categoryId: string; collapsed: boolean; title: string }
export interface PropertyEditorContext { source: PropertyGrid; grid: PropertyGrid; item: PropertyRow; row: PropertyRow; property: PropertyDefinition; value: unknown; columnId: 'value' }
/** Obtain the runtime-branded factory through createGridEditorFactory/gridEditors.custom. */
export interface PropertyEditorFactory { readonly activation?: 'edit' | 'toggle'; createCellEditor(context: PropertyEditorContext): CellEditor }
export type PropertyEditor = GridEditorFactory | PropertyEditorFactory | null | ((property: PropertyDefinition, row: PropertyRow, grid: PropertyGrid) => GridEditorFactory | PropertyEditorFactory | null);
export interface PropertyChange extends ControlEvent<PropertyGrid> { target: unknown; property: PropertyDefinition; group: PropertyGroup; name: string; oldValue: unknown; newValue: unknown; cancel?: boolean }
export interface PropertyFocusChange extends ControlEvent<PropertyGrid> { target: unknown; property: PropertyDefinition | null; group: PropertyGroup | null; oldProperty: PropertyDefinition | null; description: string }
export interface PropertyCategoryToggle extends ControlEvent<PropertyGrid> { target: unknown; categoryId: string; group: PropertyGroup; collapsed: boolean; cancel: boolean }
export interface PropertyToggle extends ControlEvent<PropertyGrid> { target: unknown; property: PropertyDefinition; group: PropertyGroup; path: string; expanded: boolean; cancel: boolean }
export interface PropertyGridEvents {
  bind: ControlEvent<PropertyGrid> & { target: unknown; groups: PropertyGroup[] }; clear: ControlEvent<PropertyGrid> & { target: unknown };
  labelWidthChange: ControlEvent<PropertyGrid> & { value: number; oldValue?: number };
  editStart: ControlEvent<PropertyGrid> & { property: PropertyDefinition; group: PropertyGroup }; editCancel: ControlEvent<PropertyGrid> & { property: PropertyDefinition };
  beforePropertyChange: PropertyChange & { cancel: boolean }; propertyChange: PropertyChange; afterPropertyChange: PropertyChange; propertyFocusChange: PropertyFocusChange;
  beforeCategoryToggle: PropertyCategoryToggle; categoryToggle: PropertyCategoryToggle; categoryCollapse: PropertyCategoryToggle; categoryExpand: PropertyCategoryToggle;
  beforePropertyToggle: PropertyToggle; propertyToggle: PropertyToggle; propertyCollapse: PropertyToggle; propertyExpand: PropertyToggle;
}
export interface PropertyGridOptions extends BaseControlOptions<PropertyGrid> {
  css?: string; className?: string; labelWidth?: number; minLabelWidth?: number; minValueWidth?: number; showCategories?: boolean; sortMode?: PropertySortMode;
  defaultEditors?: Record<string, PropertyEditor> | Map<string, PropertyEditor>; collapsedCategories?: Iterable<string>; expandedProperties?: Iterable<string>; source?: PropertySource;
}
export declare class PropertyGrid extends BaseControl<PropertyGridEvents, HTMLElement> {
  constructor(options?: PropertyGridOptions); constructor(container: HTMLElement | string, options?: PropertyGridOptions);
  css: string; className: string; labelWidth: number; minLabelWidth: number; minValueWidth: number; showCategories: boolean; sortMode: PropertySortMode;
  defaultEditors: Map<string, PropertyEditor>; data: DataStore<PropertyRow | PropertyCategoryRow, string>; selection: SelectionModel<PropertyRow>; propertyControls: Record<string, PropertyRow>;
  bind(source: PropertySource | null, options?: MutationOptions): this; clear(options?: MutationOptions): this; refresh(options?: MutationOptions): this;
  getColumn(id: string): { id: string; title: string; readOnly: boolean | ((row: PropertyRow) => boolean); editor?: (row: PropertyRow) => PropertyEditor; render?: (value: unknown, row: PropertyRow) => unknown } | null;
  getPropertyControl(name: string): PropertyRow | null; getSelectedProperty(): PropertyDefinition | null; getSelectedPropertyDescription(): string;
  selectProperty(pathOrName: string, options?: MutationOptions): boolean; clearPropertySelection(options?: MutationOptions): boolean;
  isCategoryCollapsed(id: string): boolean; getCollapsedCategories(): string[]; collapseCategory(id: string, options?: MutationOptions): boolean; expandCategory(id: string, options?: MutationOptions): boolean; toggleCategory(id: string, options?: MutationOptions): boolean;
  isPropertyExpanded(pathOrName: string): boolean; getExpandedProperties(): string[]; expandProperty(pathOrName: string, options?: MutationOptions): boolean; collapseProperty(pathOrName: string, options?: MutationOptions): boolean; toggleProperty(pathOrName: string, options?: MutationOptions): boolean;
  setSortMode(sortMode: PropertySortMode, options?: MutationOptions): boolean; setShowCategories(show: boolean, options?: MutationOptions): boolean; setLabelWidth(width: number, options?: MutationOptions): boolean;
  setDefaultEditor(type: string, editor: PropertyEditor): this; removeDefaultEditor(type: string): boolean;
  startEdit(itemOrId: PropertyRow | string, columnId?: 'value', options?: MutationOptions): boolean; commitEdit(options?: MutationOptions): boolean; cancelEdit(options?: MutationOptions): boolean;
}
export interface PropertyDescriptionOptions extends BaseControlOptions<PropertyDescription> { css?: string; className?: string; emptyText?: string; title?: string; description?: string; property?: PropertyDefinition | null }
export declare class PropertyDescription extends BaseControl<{ bind: ControlEvent<PropertyDescription> & { property: PropertyDefinition | null; oldProperty: PropertyDefinition | null; title: string; description: string }; descriptionChange: ControlEvent<PropertyDescription> & { property: PropertyDefinition | null; oldValue: string; value: string } }, HTMLElement> {
  constructor(options?: PropertyDescriptionOptions); constructor(container: HTMLElement | string, options?: PropertyDescriptionOptions);
  css: string; emptyText: string; title: string; description: string; property: PropertyDefinition | null;
  bind(property: PropertyDefinition | null, options?: MutationOptions): this; clear(options?: MutationOptions): this;
  getProperty(): PropertyDefinition | null; getTitle(): string; getDescription(): string; setDescription(description: string | null, options?: MutationOptions): this;
}
export type PropertyInspectorEvents = { [K in 'beforePropertyChange' | 'propertyChange' | 'afterPropertyChange' | 'propertyFocusChange']: Omit<PropertyGridEvents[K], 'source'> & { source: PropertyInspector; grid: PropertyGrid } };
export interface PropertyInspectorOptions extends PanelOptions<PropertyInspector> { grid?: PropertyGrid | PropertyGridOptions; propertyGrid?: PropertyGridOptions; source?: PropertySource }
export declare class PropertyInspector extends Panel<PropertyInspectorEvents> {
  refresh(options?: MutationOptions): this;
  constructor(options?: PropertyInspectorOptions); constructor(container: HTMLElement | string, options?: PropertyInspectorOptions);
  grid: PropertyGrid; bind(source: PropertySource | null, options?: MutationOptions): this;
  clear(options?: MutationOptions): this; getSelectedProperty(): PropertyDefinition | null;
  selectProperty(pathOrName: string, options?: MutationOptions): boolean; clearPropertySelection(options?: MutationOptions): boolean;
}
