const clamp = (value, max) => Math.max(0, Math.min(max, value));

// Coordinates are CSS pixels, independent of raster resolution and DPR.
export function scrollGeometry(content, zoom, viewport) {
  const width = Math.max(0, content.width * zoom);
  const height = Math.max(0, content.height * zoom);
  const planeWidth = width > viewport.width + 0.01 ? Math.ceil(width) : viewport.width;
  const planeHeight = height > viewport.height + 0.01 ? Math.ceil(height) : viewport.height;
  return { width, height, planeWidth, planeHeight,
    maxX: Math.max(0, width - viewport.width), maxY: Math.max(0, height - viewport.height),
    centerX: Math.max(0, (viewport.width - width) / 2),
    centerY: Math.max(0, (viewport.height - height) / 2) };
}

export function scrollToPan(geometry, left, top) {
  return { x: geometry.centerX - clamp(left, geometry.maxX), y: geometry.centerY - clamp(top, geometry.maxY) };
}

export function panToScroll(geometry, pan) {
  return { left: clamp(-pan.x, geometry.maxX), top: clamp(-pan.y, geometry.maxY) };
}
