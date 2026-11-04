import type { MutationMetadataOptions, NormalizedMutationOptions } from './contracts.js';
export declare function normalizeMutationOptions(options?: MutationMetadataOptions | null): NormalizedMutationOptions;
export declare function isUserOrigin(options?: MutationMetadataOptions | null): boolean;
