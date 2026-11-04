// Internal composition bridge. Views retain a public global predicate while a
// table adds its column/search conditions to the effective projection.
const supported = new WeakSet();
const bindings = new WeakMap();

export function registerFilterView(view) { supported.add(view); }

export function assertFilterViewAvailable(view) {
  if (view && bindings.has(view)) throw new Error('A data view can have only one table filter owner. Create a separate view over the same DataStore.');
}

export function bindViewFilter(view, filter, compose, unchanged) {
  // Preserve the legacy contract for custom structural view implementations.
  if (!supported.has(view)) return null;
  assertFilterViewAvailable(view);
  const binding = { filter, compose, unchanged };
  bindings.set(view, binding);
  return {
    dispose({ refresh = true } = {}) {
      if (bindings.get(view) !== binding) return;
      bindings.delete(view);
      if (refresh && !view.destroyed) view.setFilter(binding.filter, {
        silent: true, keepPage: true, origin: 'system', reason: 'filter-owner-destroy'
      });
    }
  };
}

export function composeViewFilter(view, filter) {
  const binding = bindings.get(view);
  if (!binding) return filter;
  const effective = binding.compose(filter);
  binding.filter = filter;
  return effective;
}

export function getViewFilter(view, effective) {
  const binding = bindings.get(view);
  return binding ? binding.filter : effective;
}

export function getViewFilterReceiver(view, effective) {
  // A table's global predicate was historically called as a plain function.
  // Standalone view predicates retain the view as their receiver.
  return bindings.get(view)?.filter === effective ? undefined : view;
}

export function finishViewFilterChange(view, changed) {
  // Changed projections already notify their renderer through invalidate.
  if (!changed && !view.destroyed && !view._buildingProjection) bindings.get(view)?.unchanged();
  return changed;
}

export function releaseViewFilter(view) { bindings.delete(view); }
