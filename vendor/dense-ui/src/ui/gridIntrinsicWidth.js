// Measure rendered content, not the grid track that currently contains it.
// A detached clone has no styles; keep this probe beside the real cell so theme,
// font, renderer markup, tree indentation and header buttons are preserved.
export function gridIntrinsicWidth(cell) {
  if (!cell?.parentElement) return 0;
  const probe = cell.cloneNode(true);
  probe.removeAttribute("id");
  probe.setAttribute("aria-hidden", "true");
  probe.inert = true;
  Object.assign(probe.style, {
    position: "absolute", visibility: "hidden", pointerEvents: "none",
    width: "max-content", minWidth: "0", maxWidth: "none",
    left: "0", right: "auto", top: "0", flex: "none",
    gridColumn: "auto", overflow: "visible"
  });
  // The tree label normally fills its track with minmax(0, 1fr). Resolve that
  // track intrinsically during measurement, including its level padding.
  for (const content of probe.querySelectorAll('.dui-tree-grid__content')) {
    content.style.width = 'max-content';
    content.style.flexShrink = '0';
    content.style.gridTemplateColumns = content.classList.contains('dui-tree-grid__content--has-icon')
      ? 'var(--dui-icon-size-compact) var(--dui-icon-size-md) max-content'
      : '14px max-content';
  }
  cell.parentElement.appendChild(probe);
  try {
    const style = getComputedStyle(probe);
    const borders = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
    return Math.ceil(Math.max(probe.getBoundingClientRect().width, probe.scrollWidth + borders));
  } finally {
    probe.remove();
  }
}
