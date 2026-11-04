// Client-coordinate snapshots shared by collection controls and connector adapters.
export function itemGeometry(id, anchorId, row, viewport, collapsed = false) {
  const bounds = viewport?.getBoundingClientRect();
  const rect = row?.getBoundingClientRect();
  if (!bounds || !rect || !viewport.isConnected || bounds.width <= 0 || bounds.height <= 0 || rect.height <= 0) {
    return { id, anchorId, status:"hidden", rect:null, viewport:null };
  }
  const status = collapsed ? "collapsed" : rect.bottom <= bounds.top ? "above" : rect.top >= bounds.bottom ? "below" : "visible";
  return { id, anchorId, status, rect, viewport:bounds };
}

// Filtered and missing nodes must not attach to an unrelated visible row.
export function treeAnchor(view, id) {
  if (!view || view.destroyed || view.data.destroyed) return null;
  if (view.has(id)) return id;
  let item = view.data.get(id);
  const seen = new Set([id]);
  while (item) {
    const parentId = view.parentIdOf(item);
    if (parentId == null || seen.has(parentId)) return null;
    seen.add(parentId);
    if (view.has(parentId)) return view.getEntry(parentId).expanded ? null : parentId;
    item = view.data.get(parentId);
  }
  return null;
}

export function portPosition(geometry, side, portElements) {
  if (!geometry?.rect || !geometry.viewport) return null;
  const { rect, viewport } = geometry;
  const rail = portElements?.[side]?.getBoundingClientRect();
  const above = rect.bottom <= viewport.top;
  const below = rect.top >= viewport.bottom;
  return {
    x:rail ? rail.left + rail.width / 2 : side === "left" ? viewport.left : side === "right" ? viewport.right : rect.left + rect.width / 2,
    y:above ? viewport.top + 3 : below ? viewport.bottom - 3 :
      Math.max(viewport.top, Math.min(viewport.bottom, side === "top" ? rect.top : side === "bottom" ? rect.bottom : rect.top + rect.height / 2)),
    status:above ? "above" : below ? "below" : geometry.status,
    proxyItemId:geometry.status === "collapsed" ? geometry.anchorId : undefined
  };
}
