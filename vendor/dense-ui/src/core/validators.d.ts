import type { EditorValidatorResult } from '../ui/EditorControl.js';
export declare function required(message?: string): (value: unknown) => EditorValidatorResult;
export declare function email(message?: string): (value: unknown) => EditorValidatorResult;
export declare function valueInData(message?: string): (value: unknown, context?: { control?: { data?: { get(value: unknown): unknown } } }) => EditorValidatorResult;
