// SPDX-License-Identifier: MIT
// Derived from Dense UI; copyright (c) 2026 Edward Aponasko.
// See LICENSE and provenance.json beside this local extension.
// Internal geometry in CSS viewport pixels and logical content units.
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function fitZoom(mode, content, viewport, minZoom, maxZoom) {
  if (mode === "actual") return clamp(1, minZoom, maxZoom);
  if (!content.width || !content.height || !viewport.width || !viewport.height) return null;
  const x = viewport.width / content.width;
  const y = viewport.height / content.height;
  return clamp(mode === "fit-width" ? x : mode === "fit-height" ? y : Math.min(x, y), minZoom, maxZoom);
}

export function constrainView(view, content, viewport) {
  const axis = (pan, size, available) => size <= available ? (available - size) / 2 : clamp(pan, available - size, 0);
  if (!content.width || !content.height) return { ...view, panX: 0, panY: 0 };
  return { ...view,
    panX: axis(view.panX, content.width * view.zoom, viewport.width),
    panY: axis(view.panY, content.height * view.zoom, viewport.height)
  };
}

export function centeredView(view, content, viewport) {
  return constrainView({ ...view,
    panX: (viewport.width - content.width * view.zoom) / 2,
    panY: (viewport.height - content.height * view.zoom) / 2
  }, content, viewport);
}

export function toContent(view, x, y) {
  return { x: (x - view.panX) / view.zoom, y: (y - view.panY) / view.zoom };
}

export function toViewport(view, x, y) {
  return { x: x * view.zoom + view.panX, y: y * view.zoom + view.panY };
}

export function anchoredZoom(view, zoom, anchor) {
  const point = toContent(view, anchor.x, anchor.y);
  return { zoom, panX: anchor.x - point.x * zoom, panY: anchor.y - point.y * zoom, mode: "manual" };
}

export function resizedView(view, content, previous, next, minZoom, maxZoom) {
  if (view.mode !== "manual") {
    return centeredView({ ...view, zoom: fitZoom(view.mode, content, next, minZoom, maxZoom) ?? view.zoom }, content, next);
  }
  if (!previous.width || !previous.height) return centeredView(view, content, next);
  const center = toContent(view, previous.width / 2, previous.height / 2);
  return constrainView({ ...view, panX: next.width / 2 - center.x * view.zoom, panY: next.height / 2 - center.y * view.zoom }, content, next);
}

export function rasterTarget(content, zoom, dpr, maxPixels, maxDimension) {
  const width = content.width * zoom * dpr;
  const height = content.height * zoom * dpr;
  // A subpixel short axis still needs one pixel; cap the other axis accordingly.
  const dimension = Math.min(maxDimension, maxPixels);
  const scale = Math.min(1, dimension / width, dimension / height, Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
