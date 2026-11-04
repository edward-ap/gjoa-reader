import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions } from '../core/index.js';
import type { CommandRegistry } from '../core/CommandRegistry.js';
import type { Panel } from './container-contracts.js';
export type ActionEdge = 'left' | 'right' | 'top' | 'bottom';
export interface EdgeActivationEvent { source: EdgeActionLayer; edge: ActionEdge; origin: 'user'; userAction: true; nativeEvent: PointerEvent }
export interface EdgeActionConfig {
  /** Fraction 0..1, nonnegative px, or 0..100%. Default .25. */
  size?: number | string;
  action?: (event: EdgeActivationEvent) => unknown | Promise<unknown>;
  command?: string;
  enabled?: boolean;
  /** Decorative. Controls are owned; nodes must be detached. */
  indicator?: string | HTMLElement | BaseControl;
}
export interface EdgeActionLayerOptions extends Omit<BaseControlOptions, 'width' | 'height' | 'tabIndex'> {
  parent?: string | HTMLElement | Panel;
  commands?: CommandRegistry;
  left?: EdgeActionConfig; right?: EdgeActionConfig; top?: EdgeActionConfig; bottom?: EdgeActionConfig;
  dragThreshold?: number;
  /** Observe host gestures without intercepting underlying hit targets. */
  observe?: boolean;
  onActivate?: (event: EdgeActivationEvent) => void;
}
export interface EdgeActionLayerEvents {
  activate: EdgeActivationEvent; enter: EdgeActivationEvent; leave: EdgeActivationEvent;
  actionError: EdgeActivationEvent & { error: unknown };
}
export declare class EdgeActionLayer extends BaseControl<EdgeActionLayerEvents> {
  constructor(options?: EdgeActionLayerOptions);
  constructor(parent: string | HTMLElement | Panel, options?: EdgeActionLayerOptions);
  readonly commands: CommandRegistry | null;
  readonly dragThreshold: number;
  mount(parent: string | HTMLElement | Panel): this;
  setEdgeEnabled(edge: ActionEdge, enabled: boolean): this;
  setEdgeSize(edge: ActionEdge, size: number | string): this;
  isEdgeEnabled(edge: ActionEdge): boolean;
  refresh(): this;
  destroy(): void;
}
