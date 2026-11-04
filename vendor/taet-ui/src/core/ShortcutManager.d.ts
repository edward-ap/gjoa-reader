import type { CommandRegistry, CommandContext, CommandContextProvider } from './CommandRegistry.js';
import type { EventBus } from './EventBus.js';
export interface ShortcutBindingOptions { scope?: string; when?: (context: CommandContext) => boolean; allowInTextInput?: boolean }
export interface ShortcutManagerOptions { commands?: CommandRegistry; contextProvider?: CommandContextProvider; target?: Document | HTMLElement | Window; autoListen?: boolean }
export interface ShortcutEvents {
  conflict: { source: ShortcutManager; shortcut: string; normalizedShortcut: string; commandId: string; existingCommandId: string; cancel: boolean };
  execute: { source: ShortcutManager; commandId: string; shortcut: string; normalizedShortcut: string; nativeEvent: KeyboardEvent; origin: 'user'; userAction: true };
}
export declare class ShortcutManager {
  constructor(options?: ShortcutManagerOptions);
  readonly destroyed: boolean; events: EventBus<ShortcutEvents>;
  commands: CommandRegistry | null; contextProvider: CommandContextProvider | null; target: Document | HTMLElement | Window | null;
  listen(target?: Document | HTMLElement | Window): this;
  bind(commandId: string, shortcut: string, options?: ShortcutBindingOptions): { dispose(): void; off(): void };
  unbind(commandId: string): void;
  bindCommands(commands?: CommandRegistry): { dispose(): void };
  handleKeyboardEvent(event: KeyboardEvent): boolean;
  destroy(): void;
}
