// Decorative SVG indicators owned by EdgeActionLayer; they never intercept input.
export function edgeHint(direction) {
  const host = document.createElement('span');
  host.className = `reader-edge-hint reader-edge-hint--${direction}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 36');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', direction === 'left' ? 'M19 3 L4 18 L19 33' : 'M5 3 L20 18 L5 33');
  svg.append(path); host.append(svg);
  return host;
}

export function observeEdgeHints(workspace, layer) {
  const host = workspace.getContentElement();
  const clear = () => { layer.element.dataset.hoverEdge = ''; };
  workspace.disposables.addEventListener(host, 'pointermove', event => {
    if (event.buttons || event.pointerType === 'touch') { clear(); return; }
    const rect = host.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    layer.element.dataset.hoverEdge = x >= 0 && x < .25 ? 'left' : x >= .75 && x < 1 ? 'right' : '';
  }, { passive: true });
  for (const event of ['pointerleave', 'pointerdown', 'pointercancel']) {
    workspace.disposables.addEventListener(host, event, clear, { passive: true });
  }
  workspace.disposables.addEventListener(window, 'blur', clear);
}
