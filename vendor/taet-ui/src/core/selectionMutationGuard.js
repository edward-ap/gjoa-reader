// Internal table-to-model guard. It is intentionally absent from package exports
// and public MutationOptions: standalone selection models do not own data views.
export const selectionMutationGuard = Symbol("selectionMutationGuard");
