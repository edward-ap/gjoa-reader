import type {BaseControl} from '../core/index.js';
export type ThemeRole = 'primary' | 'secondary' | 'tertiary' | 'accent';
export interface ThemeColors {
  tokens: Record<string, string>;
  families?: Partial<Record<ThemeRole, {tokens: Record<string, string>}>>;
}
export interface ThemeScopeBinding {
  /** Trusted CSS selector relative to the root. Matches future descendants too. */
  selector: string;
  role?: ThemeRole;
  parts?: Array<'surface' | 'fieldGroup' | 'dialog' | 'sidePanel' | 'progress'>;
}
/** Applies colors only; foundation classes, persistence and confirmation belong to the host. */
export declare class ThemeApplicator {
  constructor(root: HTMLElement | BaseControl, options?: {scopes?: ThemeScopeBinding[]});
  readonly destroyed: boolean;
  apply(theme: ThemeColors | null): this;
  clear(): this;
  destroy(): void;
}
