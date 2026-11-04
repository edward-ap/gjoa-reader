// Internal viewport geometry: fixed data/group rows and measured detail rows.
export function rowOffsets(heights) {
  const offsets = [0];
  for (const height of heights) offsets.push(offsets.at(-1) + height);
  return offsets;
}

export function rowAtOffset(offsets, value) {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (offsets[mid] <= value) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, Math.max(0, offsets.length - 2));
}

export function windowRange(offsets, top, height, overscan, virtual = true) {
  const count = offsets.length - 1;
  if (!virtual || !count) return { start: 0, end: count, topHeight: 0, bottomHeight: 0 };
  const first = rowAtOffset(offsets, top);
  const last = height > 0 ? rowAtOffset(offsets, top + height) + 1 : Math.min(count, first + 40);
  const start = Math.max(0, first - overscan), end = Math.min(count, last + overscan);
  return { start, end, topHeight: offsets[start], bottomHeight: offsets[count] - offsets[end] };
}

export function columnWindow(columns, widths, left, width, overscan = 1, virtual = true) {
  let offset = 0, frozenLeft = 0, frozenRight = 0;
  const tracks = columns.map((column, index) => {
    const track = { column, index, left: offset, width: widths[index] };
    offset += track.width;
    if (column.frozen === "left") frozenLeft += track.width;
    if (column.frozen === "right") frozenRight += track.width;
    return track;
  });
  let first = tracks.findIndex(track => track.left + track.width > left);
  if (first < 0) first = Math.max(0, tracks.length - 1);
  let last = first;
  while (last < tracks.length && tracks[last].left < left + width) last++;
  const start = Math.max(0, first - overscan), end = Math.min(tracks.length, last + overscan);
  const visible = tracks.filter(track => !virtual || width <= 0 || track.column.frozen || (track.index >= start && track.index < end));
  return { tracks, visible, totalWidth: offset, frozenLeft, frozenRight };
}

// Retain DOM nodes by identity; only moves/inserts/removes changed children.
export function reconcileChildren(parent, children) {
  // Remove departed nodes first. Leaving one as the insertion cursor would
  // move every retained sibling in front of it when a window advances.
  const wanted = new Set(children);
  for (let node = parent.firstChild; node;) {
    const next = node.nextSibling;
    if (!wanted.has(node)) node.remove();
    node = next;
  }
  let cursor = parent.firstChild;
  for (const child of children) {
    if (cursor === child) cursor = cursor.nextSibling;
    else parent.insertBefore(child, cursor);
  }
}
