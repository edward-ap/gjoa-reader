import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions, BaseControlEvents, ControlDimension, ControlEvent, ControlResizeEvent, FocusOptions } from '../core/BaseControl.js';
import type { EventBus, EventHandler, MutationOptions } from '../core/index.js';
import type { CommandRegistry } from '../core/CommandRegistry.js';
export type ControlChild = BaseControl | readonly BaseControl[];
export type PanelScrollMode = 'visible' | 'hidden' | 'auto' | 'x' | 'y';
export interface PanelOptions<S = Panel> extends BaseControlOptions<S> {
  css?: string; className?: string; bordered?: boolean; border?: boolean;
  scroll?: PanelScrollMode; autoScroll?: boolean; padding?: ControlDimension;
}
export interface AttachOptions extends MutationOptions { container?: HTMLElement; replace?: boolean }
export interface PanelChildEvent<S = Panel> extends ControlEvent<S> { control: BaseControl; controlId: string; controlName: string | null; index: number }
export interface PanelEvents<S = Panel> {
  beforeChildAdd: PanelChildEvent<S> & { cancel: boolean }; childAdd: PanelChildEvent<S>;
  beforeChildRemove: PanelChildEvent<S> & { cancel: boolean }; childRemove: PanelChildEvent<S>;
  appearanceChange: ControlEvent<S> & { name: string; oldValue: unknown; value: unknown };
}
export declare class Panel<E extends { [K in keyof E]: object } = {}> extends BaseControl<E, HTMLElement> {
  constructor(options?: PanelOptions);
  constructor(container: HTMLElement | string, options?: PanelOptions);
  readonly events: EventBus<BaseControlEvents<this> & PanelEvents<this> & E>;
  controls: Record<string, BaseControl>; items: BaseControl[]; css: string; className: string;
  bordered: boolean; scroll: PanelScrollMode; padding: ControlDimension;
  getContentElement(): HTMLElement | null;
  add(...controls: ControlChild[]): this;
  attach<T extends BaseControl>(control: T, options?: AttachOptions): T | null;
  addControl<T extends BaseControl>(control: T): T;
  getItem(name: string): BaseControl | null; getItems(): BaseControl[]; getItemAt(index: number): BaseControl | null;
  hasItem(controlOrName: BaseControl | string): boolean; indexOf(controlOrName: BaseControl | string): number; isEmpty(): boolean;
  isBordered(): boolean; setBordered(bordered: boolean, options?: MutationOptions): this;
  getScrollMode(): PanelScrollMode; setScrollMode(scroll: PanelScrollMode, options?: MutationOptions): this;
  getPadding(): ControlDimension; setPadding(padding: ControlDimension, options?: MutationOptions): this;
  remove(controlOrName: BaseControl | string, options?: MutationOptions): BaseControl | null; clear(): this;
}
export interface FormField extends BaseControl { value: { get(): unknown; set(value: unknown, options?: MutationOptions): unknown; clear(options?: MutationOptions): unknown } }
export interface FormError { control: BaseControl; path: string; severity: 'error' | 'warning'; message: string; code?: string }
export interface FormValidationResult { source: Form; ok: boolean; errors: FormError[]; value: Record<string, unknown> }
export interface FormFieldChange { control?: BaseControl; path: string; oldValue: unknown; newValue: unknown; origin: string; userAction: boolean }
export interface FormChange extends ControlEvent<Form> { control?: BaseControl; path?: string; oldValue: unknown; newValue: unknown; value: Record<string, unknown>; changes: FormFieldChange[] }
export interface FormValueChange extends ControlEvent<Form> { oldValue: Record<string, unknown>; newValue: Record<string, unknown>; changes: FormFieldChange[] }
export interface FormEvents {
  beforeValueSet: Omit<FormValueChange, 'changes'> & { values: Record<string, unknown>; cancel: boolean };
  valueSet: FormValueChange & { values: Record<string, unknown> };
  change: FormChange; validate: FormValidationResult;
  validationFail: ControlEvent<Form> & { errors: FormError[]; value: Record<string, unknown> };
  validationClear: ControlEvent<Form>;
  beforeClear: ControlEvent<Form> & { oldValue: Record<string, unknown>; cancel: boolean };
  clear: FormValueChange; afterClear: FormValueChange;
  beforeReset: Omit<FormValueChange, 'changes'> & { cancel: boolean };
  reset: FormValueChange; afterReset: FormValueChange;
  beforeSubmit: ControlEvent<Form> & { value: Record<string, unknown>; cancel: boolean };
  submit: ControlEvent<Form> & { value: Record<string, unknown>; validation: FormValidationResult };
  afterSubmit: FormEvents['submit'];
  readOnlyChange: ControlEvent<Form> & { value: boolean };
  dirtyChange: ControlEvent<Form> & { oldValue: boolean; newValue: boolean; value: Record<string, unknown> };
}
export interface FormOptions extends PanelOptions<Form> {
  layout?: string; labelPosition?: 'left' | 'top'; labelWidth?: ControlDimension; fieldIndent?: ControlDimension; leftIndent?: ControlDimension;
  commands?: CommandRegistry; initialValue?: Record<string, unknown>; value?: Record<string, unknown>;
  onBeforeSubmit?: EventHandler<FormEvents['beforeSubmit']>; onSubmit?: EventHandler<FormEvents['submit']>; onAfterSubmit?: EventHandler<FormEvents['afterSubmit']>;
  onValidationFail?: EventHandler<FormEvents['validationFail']>; onChange?: EventHandler<FormEvents['change']>;
  onClear?: EventHandler<FormEvents['clear']>; onReset?: EventHandler<FormEvents['reset']>;
}
export declare class Form extends Panel<FormEvents> {
  enable(): this; disable(): this;
  constructor(options?: FormOptions, context?: { commands?: CommandRegistry });
  constructor(container: HTMLElement | string, options?: FormOptions, context?: { commands?: CommandRegistry });
  layout: string; labelPosition: 'left' | 'top'; labelWidth: ControlDimension; fieldIndent: ControlDimension; commands: CommandRegistry | null;
  readonly value: { get(): Record<string, unknown>; set(values?: Record<string, unknown>, options?: MutationOptions): boolean; clear(options?: MutationOptions): boolean; reset(options?: MutationOptions): boolean };
  row(...controls: ControlChild[]): this; col(...controls: ControlChild[]): this;
  columns(...columns: (readonly BaseControl[] | BaseControl)[]): this;
  static column(...controls: ControlChild[]): BaseControl[];
  validate(context?: Record<string, unknown>): FormValidationResult; isValid(): boolean; clearValidation(options?: MutationOptions): void;
  getFields(): FormField[]; forEach(callback: (control: FormField, name: string, index: number, form: this) => void): this;
  getValue(): Record<string, unknown>; getValues(): Record<string, unknown>;
  setValue(values?: Record<string, unknown>, options?: MutationOptions): boolean; setValues(values?: Record<string, unknown>, options?: MutationOptions): boolean;
  clearValues(options?: MutationOptions): boolean; resetValues(options?: MutationOptions): boolean; reset(options?: MutationOptions): boolean;
  setInitialValue(value?: Record<string, unknown>): this; setCleanValue(value?: Record<string, unknown>, options?: MutationOptions): this;
  isDirty(): boolean; submit(options?: MutationOptions & { focusInvalid?: boolean }): boolean;
  focusFirstInvalid(options?: FocusOptions): boolean; setReadOnly(readOnly: boolean, options?: MutationOptions): this; isReadOnly(): boolean;
}
export type LayoutDirection = 'rows' | 'cols';
export interface LayoutCellOptions extends PanelOptions<LayoutCell> { flex?: number; gravity?: number; minSize?: number; minWidth?: number; minHeight?: number; maxSize?: number | null; resizable?: boolean; collapsible?: boolean; collapsed?: boolean }
export interface LayoutOptions extends PanelOptions<Layout> { direction?: LayoutDirection; rows?: readonly LayoutCellOptions[]; cols?: readonly LayoutCellOptions[]; cells?: readonly LayoutCellOptions[]; title?: string; headerText?: string; header?: boolean; showHeader?: boolean; resizable?: boolean }
export interface LayoutState { direction: LayoutDirection; title: string; headerVisible: boolean; bordered: boolean; cells: { id: string; width: ControlDimension; height: ControlDimension; flex: number; collapsed: boolean }[] }
export interface LayoutCellEvent extends ControlEvent<Layout> { cell: LayoutCell; cellId: string }
export interface LayoutSplitterEvent extends ControlEvent<Layout> { beforeCell: LayoutCell; afterCell: LayoutCell; beforeCellId: string; afterCellId: string; beforeSize?: ControlDimension; afterSize?: ControlDimension }
export interface LayoutEvents {
  resize: ControlResizeEvent<Layout> & Partial<LayoutSplitterEvent>;
  beforeCellAdd: ControlEvent<Layout> & { config: LayoutCellOptions; cancel: boolean }; cellAdd: LayoutCellEvent;
  beforeCellRemove: LayoutCellEvent & { cancel: boolean }; cellRemove: LayoutCellEvent;
  cellResize: LayoutCellEvent & { oldSize: ControlDimension; size: ControlDimension };
  beforeCellCollapse: LayoutCellEvent & { cancel: boolean }; cellCollapse: LayoutCellEvent;
  beforeCellExpand: LayoutCellEvent & { cancel: boolean }; cellExpand: LayoutCellEvent;
  resizableChange: ControlEvent<Layout> & { oldValue: boolean; newValue: boolean };
  stateRestore: ControlEvent<Layout> & { state: Partial<LayoutState> };
  beforeResizeStart: LayoutSplitterEvent & { cancel: boolean }; resizeStart: LayoutSplitterEvent; resizeEnd: LayoutSplitterEvent;
}
export declare class Layout extends Panel<LayoutEvents> {
  constructor(options?: LayoutOptions); constructor(container: HTMLElement | string, options?: LayoutOptions);
  direction: LayoutDirection; title: string; headerVisible: boolean; cells: Record<string, LayoutCell>; resizable: boolean;
  getTitle(): string; setTitle(title: string | null, options?: MutationOptions): this;
  isHeaderVisible(): boolean; setHeaderVisible(visible: boolean, options?: MutationOptions): this;
  addCell(config?: LayoutCellOptions): LayoutCell | null; removeCell(idOrCell: string | LayoutCell, options?: MutationOptions): LayoutCell | null;
  getCell(id: string): LayoutCell | null; cell(id: string): LayoutCell; cellItems(): LayoutCell[];
  forEachCell(callback: (cell: LayoutCell, index: number, layout: this) => void): this; getCellId(index: number): string | null;
  isResizable(): boolean; isResizeable(): boolean; setResizable(resizable: boolean, options?: MutationOptions): this;
  setCellSize(id: string, size: number, options?: MutationOptions): this;
  collapseCell(id: string, options?: MutationOptions): boolean; expandCell(id: string, options?: MutationOptions): boolean; toggleCell(id: string, options?: MutationOptions): boolean;
  serializeState(): LayoutState; restoreState(state: Partial<LayoutState>, options?: MutationOptions): this;
}
export declare class LayoutCell extends Panel<{ resizableChange: ControlEvent<LayoutCell> & { oldValue: boolean; newValue: boolean } }> {
  constructor(options?: LayoutCellOptions);
  flex: number; minSize: number; maxSize: number | null; resizable: boolean; collapsible: boolean; collapsed: boolean;
  setLayoutSize(size: number, options?: { direction?: LayoutDirection }): this; getLayoutSize(): ControlDimension;
  isResizable(): boolean; isResizeable(): boolean; setResizable(resizable: boolean, options?: MutationOptions): this;
  isCollapsed(): boolean; setCollapsed(collapsed: boolean, options?: { direction?: LayoutDirection }): this;
}
