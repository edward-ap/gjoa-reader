// Viewport rectangles use rendered CSS pixels; positioned offsets live in the
// overlay's local coordinate system. Native browser zoom needs no conversion,
// but CSS zoom on an ancestor does.
export function overlayScale(element) {
  let scale = 1;
  for (let current = element; current; current = current.parentElement) {
    const zoom = getComputedStyle(current).zoom;
    const value = Number.parseFloat(zoom);
    if (Number.isFinite(value) && value > 0) scale *= zoom.endsWith('%') ? value / 100 : value;
  }
  return scale;
}
