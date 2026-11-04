import { BaseControl } from '../core/BaseControl.js';
import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueEvent } from './EditorControl.js';
import type { TextFieldPresentationOptions } from './TextInput.js';
import type { BaseControlOptions, BaseControlEvents, ControlEvent, MutationOptions, EventBus, EventHandler } from '../core/index.js';
import type { CommandRegistry } from '../core/CommandRegistry.js';
import type { IconRegistry } from '../core/IconRegistry.js';
import { Panel, Form } from './container-contracts.js';
import type { PanelOptions, FormOptions, ControlChild } from './container-contracts.js';
export interface IconOptions { registry?: IconRegistry; className?: string; label?: string }
export declare const icons: IconRegistry;
export declare function createIcon(name: string, options?: IconOptions): SVGSVGElement;
export declare function renderIcon<T extends HTMLElement>(host: T, name: string | null | undefined, options?: IconOptions): T;
export interface ButtonEvents<S> { click: ControlEvent<S> & { nativeEvent: MouseEvent } }
export interface ButtonOptions<S = Button> extends BaseControlOptions<S> {
  label?: string; text?: string; value?: string; icon?: string; iconPosition?: 'left' | 'right'; css?: string;
  command?: string; commands?: CommandRegistry; onClick?: EventHandler<ButtonEvents<S>['click']>;
}
export declare class Button<E extends { [K in keyof E]: object } = {}> extends BaseControl<E, HTMLElement> {
  constructor(options?: ButtonOptions); constructor(container: HTMLElement | string, options?: ButtonOptions);
  readonly events: EventBus<BaseControlEvents<this> & ButtonEvents<this> & E>;
  label: string; icon: string; iconPosition: 'left' | 'right'; css: string; command: string | null; commands: CommandRegistry | null;
  setLabel(label: string | null): void; setText(text: string | null): void;
  setIcon(icon: string | null): this; setIconPosition(position: 'left' | 'right'): this;
  bindCommand(commands: CommandRegistry, commandId?: string | null): this;
  static createCellAction(text: string, options?: { className?: string; action?: string; disabled?: boolean; ariaLabel?: string; icon?: string }): HTMLButtonElement;
}
export interface ToolButtonOptions extends ButtonOptions<ToolButton> { showText?: boolean; tooltip?: string; title?: string; shape?: 'square' | 'rounded' }
export declare class ToolButton extends Button {
  constructor(options?: ToolButtonOptions); constructor(container: HTMLElement | string, options?: ToolButtonOptions);
  showText: boolean; tooltip: string; shape: 'square' | 'rounded'; setShape(shape: 'square' | 'rounded'): this;
}
export interface IconButtonOptions extends ButtonOptions<IconButton> {
  pressed?: boolean | null;
  tooltip?: string; title?: string; shape?: 'square' | 'rounded';
}
export declare class IconButton extends ToolButton {
  readonly pressed: boolean | null;
  setPressed(value: boolean | null): this;
  constructor(options?: IconButtonOptions); constructor(container: HTMLElement | string, options?: IconButtonOptions);
}
export interface CheckButtonOptions extends Omit<EditorControlOptions<boolean, object, CheckButton>, 'emptyValue'> {
  emptyValue?: false; checked?: boolean; text?: string; caption?: string; checkedText?: string | null; uncheckedText?: string | null;
  icon?: string; checkedIcon?: string | null; uncheckedIcon?: string | null; checkedIconColor?: string | null; uncheckedIconColor?: string | null;
  groupName?: string | null; group?: string | null; groupIndex?: number | null; allowAllUnchecked?: boolean;
}
export declare class CheckButton extends EditorControl<boolean, object, { textChange: EditorValueEvent<string, CheckButton>; iconChange: EditorValueEvent<string, CheckButton> }> {
  constructor(options?: CheckButtonOptions); constructor(container: HTMLElement | string, options?: CheckButtonOptions);
  text: string; checkedText: string | null; uncheckedText: string | null; icon: string; checkedIcon: string | null; uncheckedIcon: string | null;
  checkedIconColor: string | null; uncheckedIconColor: string | null; groupName: string | null; groupIndex: number | null; allowAllUnchecked: boolean;
  isChecked(): boolean; setChecked(checked: boolean, options?: MutationOptions): boolean; toggle(options?: MutationOptions): boolean;
  setText(text: string | null, options?: MutationOptions): this; getText(): string; setIcon(icon: string | null, options?: MutationOptions): this;
}
export interface ToolbarOptions extends PanelOptions<Toolbar> { commands?: CommandRegistry }
export interface ToggleIconButtonOptions extends Omit<EditorControlOptions<boolean, object, ToggleIconButton>, 'emptyValue'> {
  emptyValue?: false; checked?: boolean; text?: string; caption?: string; checkedText?: string | null; uncheckedText?: string | null;
  icon?: string; checkedIcon?: string | null; uncheckedIcon?: string | null; checkedIconColor?: string | null; uncheckedIconColor?: string | null;
  groupName?: string | null; group?: string | null; groupIndex?: number | null; allowAllUnchecked?: boolean;
}
export declare class ToggleIconButton extends CheckButton {
  constructor(options?: ToggleIconButtonOptions); constructor(container: HTMLElement | string, options?: ToggleIconButtonOptions);
}
export declare class Toolbar extends Panel {
  constructor(options?: ToolbarOptions); constructor(container: HTMLElement | string, options?: ToolbarOptions);
  commands: CommandRegistry | null;
  addCommand(commandId: string, options?: Omit<ToolButtonOptions, 'command' | 'commands' | 'onClick'>): this;
  addButton(options?: ButtonOptions): this; addToolButton(options?: ToolButtonOptions): this;
  addSeparator(options?: BaseControlOptions): this; addSpacer(options?: BaseControlOptions & { css?: string; className?: string }): this;
}
export declare class ToolbarSeparator extends BaseControl<{}, HTMLElement> {}
export declare class ToolbarSpacer extends BaseControl<{}, HTMLElement> { constructor(options?: BaseControlOptions & { css?: string; className?: string }); css: string }
export interface LabelTextOptions<S = LabelText> extends BaseControlOptions<S> { text?: string | number | (() => string | number); role?: string; ariaRole?: 'status' | 'alert'; ariaLive?: 'off' | 'polite' | 'assertive'; ariaAtomic?: boolean; className?: string; css?: string; onTextChange?: EventHandler<EditorValueEvent<string, S>> }
export declare class LabelText extends BaseControl<{ textChange: EditorValueEvent<string, LabelText> }, HTMLElement> {
  constructor(options?: LabelTextOptions); constructor(container: HTMLElement | string, options?: LabelTextOptions);
  text: string; role: string; className: string; getText(): string; setText(text: string | number | null, options?: MutationOptions): this;
}
export declare class ReadonlyText extends LabelText {}
export declare class StatusText extends LabelText {}
export declare class LogPanel extends BaseControl<{}, HTMLElement> {
  constructor(options?: BaseControlOptions<LogPanel> & { css?: string }); constructor(container: HTMLElement | string, options?: BaseControlOptions<LogPanel> & { css?: string });
  css: string; write(message: string): void; clear(): void;
}
export interface CodeBlockOptions extends BaseControlOptions<CodeBlock> { code?: string; value?: string; language?: string; copyButton?: boolean }
export declare class CodeBlock extends BaseControl<{ change: EditorValueEvent<string, CodeBlock>; copy: ControlEvent<CodeBlock> & { value: string }; copyError: ControlEvent<CodeBlock> & { error: unknown } }, HTMLElement> {
  constructor(options?: CodeBlockOptions); constructor(container: HTMLElement | string, options?: CodeBlockOptions);
  language: string; copyButton: boolean; readonly value: { get(): string; set(value: string | null, options?: MutationOptions): boolean; clear(options?: MutationOptions): boolean };
  setCode(code: string | null, options?: MutationOptions): boolean; copy(options?: MutationOptions): Promise<boolean>;
}
export interface TextFieldOptions<C extends object = object> extends EditorControlOptions<string, C, TextField<C>>, TextFieldPresentationOptions {}
export declare class TextField<C extends object = object> extends EditorControl<string, C, { passwordVisibilityChange: EditorValueEvent<boolean, TextField<C>> }> {
  constructor(options?: TextFieldOptions<C>); constructor(container: HTMLElement | string, options?: TextFieldOptions<C>);
  inputType: string; isPassword: boolean; showRevealButton: boolean; mask: string | null; placeholder: string; unmaskValue: boolean; placeholderChar: string;
  maxLength: number | null; spellcheck: boolean | undefined; autocomplete: string | null;
  setPasswordVisible(visible: boolean, options?: MutationOptions): boolean; togglePasswordVisible(visible?: boolean | null, options?: MutationOptions): boolean;
  getDisplayValue(): string; getRawValue(): string;
}
export interface FieldGroupOptions extends FormOptions { title?: string; label?: string }
export declare class FieldGroup extends Form {
  constructor(options?: FieldGroupOptions, context?: { commands?: CommandRegistry }); constructor(container: HTMLElement | string, options?: FieldGroupOptions, context?: { commands?: CommandRegistry });
  title: string; setTitle(title: string | null): this;
}
export type TextTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type TextSpacing = 'compact' | 'normal' | 'comfortable';
export type TextBlock = { type?: 'paragraph'; text: string } | { type: 'heading'; text: string; level?: 2 | 3 | 4 } |
  { type: 'list'; items: readonly string[]; ordered?: boolean } | { type: 'keyValue'; label: string; value: string } |
  { type: 'definitionList'; items: readonly { term?: string; label?: string; definition?: string; value?: string }[] };
export type TextContent = string | readonly (string | TextBlock)[];
export interface TextLayoutEvents { contentChange: EditorValueEvent<TextBlock[], TextLayout>; appearanceChange: ControlEvent<TextLayout> & { name: string; oldValue: unknown; value: unknown } }
export interface TextLayoutOptions extends BaseControlOptions<TextLayout> {
  css?: string; className?: string; title?: string; tone?: TextTone; appearance?: TextTone; background?: boolean | 'none' | 'subtle';
  bordered?: boolean; border?: boolean; spacing?: TextSpacing; icon?: string | boolean | null;
  content?: TextContent; blocks?: TextContent; text?: string;
  onContentChange?: EventHandler<TextLayoutEvents['contentChange']>; onAppearanceChange?: EventHandler<TextLayoutEvents['appearanceChange']>;
}
export declare class TextLayout extends BaseControl<TextLayoutEvents, HTMLElement> {
  constructor(options?: TextLayoutOptions); constructor(container: HTMLElement | string, options?: TextLayoutOptions);
  css: string; title: string; tone: TextTone; background: boolean; bordered: boolean; spacing: TextSpacing; icon: string;
  getTitle(): string; setTitle(title: string | null, options?: MutationOptions): this;
  getContent(): TextBlock[]; setContent(content: TextContent, options?: MutationOptions): this; setText(text: string | null, options?: MutationOptions): this;
  getTone(): TextTone; setTone(tone: TextTone, options?: MutationOptions & { keepIcon?: boolean }): this;
  hasBackground(): boolean; setBackground(background: boolean | 'none' | 'subtle', options?: MutationOptions): this;
  isBordered(): boolean; setBordered(bordered: boolean, options?: MutationOptions): this;
  setSpacing(spacing: TextSpacing, options?: MutationOptions): this; setIcon(icon: string | boolean | null, options?: MutationOptions): this;
}
export interface AccordionChange extends ControlEvent<Accordion> { name: string; expanded: boolean; oldValue: string[]; newValue: string[] }
export interface AccordionOptions extends PanelOptions<Accordion> { multiple?: boolean; onBeforeChange?: EventHandler<AccordionChange & { cancel: boolean }>; onChange?: EventHandler<AccordionChange> }
export declare class Accordion extends Panel<{ beforeChange: AccordionChange & { cancel: boolean }; change: AccordionChange }> {
  enable(): this; disable(): this;
  constructor(options?: AccordionOptions); constructor(container: HTMLElement | string, options?: AccordionOptions);
  multiple: boolean;
  addSection<T extends BaseControl>(options: { name: string; title?: string; disabled?: boolean; expanded?: boolean }, content: T): T | null;
  getSection(name: string): BaseControl | null; getExpanded(): string[]; isExpanded(name: string): boolean;
  expand(name: string, options?: MutationOptions): boolean; collapse(name: string, options?: MutationOptions): boolean; toggle(name: string, options?: MutationOptions): boolean;
  setExpanded(name: string, expanded: boolean, options?: MutationOptions): boolean; removeSection(name: string, options?: MutationOptions): BaseControl | null;
}
