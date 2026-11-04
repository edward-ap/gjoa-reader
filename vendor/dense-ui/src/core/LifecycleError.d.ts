import type { BaseControl } from './BaseControl.js';

export declare class LifecycleError extends Error {
  constructor(message: string, control?: BaseControl | null, operation?: string | null);
  readonly control: BaseControl | null | undefined;
  readonly controlId: string | null;
  readonly operation: string | null;
}
