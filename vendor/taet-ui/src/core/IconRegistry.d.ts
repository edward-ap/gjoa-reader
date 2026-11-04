export type IconNode = readonly [tagName: string, attributes: Readonly<Record<string, string | number>>];
export interface IconDefinition { viewBox?: string; nodes: readonly IconNode[] }
export interface ResolvedIconDefinition { readonly viewBox: string; readonly nodes: readonly IconNode[] }
export declare class IconRegistry {
  constructor(definitions?: Record<string, IconDefinition>);
  register(name: string, definition: IconDefinition, options?: { replace?: boolean }): this;
  registerAll(definitions: Record<string, IconDefinition>, options?: { replace?: boolean }): this;
  alias(name: string, target: string, options?: { replace?: boolean }): this;
  has(name: string): boolean; resolve(name: string): ResolvedIconDefinition | null;
  unregister(name: string): boolean; list(): string[];
}
