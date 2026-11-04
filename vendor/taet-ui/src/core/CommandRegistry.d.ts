import type { EventBus } from './EventBus.js';
import type { MutationOptions } from './contracts.js';
export type CommandContext = Record<string, unknown>;
export interface CommandContextProvider { getContext(): CommandContext; events?: { on(name: 'contextChange', handler: (event: object) => void): { dispose(): void } } }
export interface CommandRunOptions extends MutationOptions { force?: boolean }
export interface CommandResult { ok: boolean; value?: unknown; message?: string; error?: unknown; [key: string]: unknown }
export interface CommandDefinition {
  label?: string; description?: string; icon?: string; shortcut?: string;
  enabled?: boolean | ((context: CommandContext) => boolean);
  visible?: boolean | ((context: CommandContext) => boolean);
  checked?: boolean | ((context: CommandContext) => boolean);
  scope?: string; allowInTextInput?: boolean; when?: (context: CommandContext) => boolean;
  run(context: CommandContext, options: CommandRunOptions): unknown | Promise<unknown>;
}
export interface RegisteredCommand extends CommandDefinition { id: string }
export interface CommandState { id: string; label: string; description: string | undefined; icon: string | undefined; shortcut: string | undefined; enabled: boolean; visible: boolean; checked: boolean }
export interface CommandEvents {
  register: { source: CommandRegistry; commandId: string; command: RegisteredCommand };
  unregister: CommandEvents['register'];
  stateChange: { source: CommandRegistry; commandId: string; oldState: CommandState | undefined; state: CommandState };
  beforeExecute: { source: CommandRegistry; commandId: string; context: CommandContext; origin: string; userAction: boolean; cancel: boolean };
  afterExecute: Omit<CommandEvents['beforeExecute'], 'cancel'> & { result: CommandResult };
  error: Omit<CommandEvents['beforeExecute'], 'cancel'> & { error: unknown };
}
export declare class CommandRegistry {
  constructor(options?: { contextProvider?: CommandContextProvider | null });
  readonly destroyed: boolean; events: EventBus<CommandEvents>;
  register(id: string, command: CommandDefinition): { dispose(): void; off(): void };
  unregister(id: string): boolean; get(id: string): RegisteredCommand | undefined; list(): RegisteredCommand[];
  setContextProvider(provider: CommandContextProvider | null): void;
  canExecute(id: string, context?: CommandContext): boolean; state(id: string, context?: CommandContext): CommandState;
  refreshState(): void; execute(id: string, context?: CommandContext, options?: CommandRunOptions): Promise<CommandResult>;
  destroy(): void;
}
