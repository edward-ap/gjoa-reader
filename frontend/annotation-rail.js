import { IconButton } from 'dense-ui';
import { ColorPicker } from 'dense-ui/experimental';
import { t } from './i18n/i18n.js';

// Reader-only edge palette. It is a sibling of the workspace, never page content.
export class AnnotationRail {
  constructor(parent, color, select, changeColor) {
    this.element = document.createElement('div');
    this.element.className = 'reader-annotation-rail'; this.element.hidden = true;
    this.element.style.setProperty('--annotation-color', color);
    this.tab = document.createElement('button'); this.tab.type = 'button';
    this.tab.className = 'reader-annotation-tab';
    this.tab.dataset.duiControlId = 'annotationTab';
    this.tab.setAttribute('aria-label', t('annotations.toggleTools'));
    this.tab.setAttribute('aria-expanded', 'false');
    this.tab.innerHTML = '<span class="reader-annotation-indicator"></span>';
    this.menu = document.createElement('div'); this.menu.className = 'reader-annotation-tools';
    this.menu.hidden = true; this.menu.id = 'reader-annotation-tools';
    this.menu.setAttribute('role', 'group'); this.menu.setAttribute('aria-label', t('annotations.title'));
    this.tab.setAttribute('aria-controls', this.menu.id);
    this.element.append(this.tab, this.menu); parent.append(this.element);
    this.groups = { select: ['area-select', 'eraser'], line: ['pen', 'arrow', 'dashed'], rectangle: ['square', 'circle', 'ellipse'], text: [] };
    this.secondary = new Map(); this.childButtons = new Map();
    this.buttons = new Map(['select', 'line', 'rectangle', 'text'].map((tool, index) => {
      const button = new IconButton({ name: `annotation-${tool}`, icon: `reader.${tool}`,
        text: t(`annotations.${tool}`), tooltip: t(`annotations.${tool}`), onClick: () => select(tool) });
      button.mount(this.menu); button.element.style.setProperty('--slot', index);
      this.addSubmenu(tool, index, button.element);
      for (const child of this.groups[tool]) {
        const item = new IconButton({ name: `annotation-${child}`, icon: `reader.${child}`,
          text: t(`annotations.${child}`), tooltip: t(`annotations.${child}`), onClick: () => select(child) });
        item.mount(this.secondary.get(tool)); this.childButtons.set(child, item);
      }
      return [tool, button];
    }));
    let saved;
    try { saved = JSON.parse(localStorage.getItem('reader.annotationColors.v1')); } catch { /* optional preferences */ }
    const colors = saved?.colors?.length === 3 && saved.colors.every(c => /^#[0-9a-f]{6}$/i.test(c)) ? saved.colors : [color, '#245ea8', '#278345'];
    this.colorIndex = Number.isInteger(saved?.active) && saved.active >= 0 && saved.active < 3 ? saved.active : 0;
    const persist = () => { try { localStorage.setItem('reader.annotationColors.v1', JSON.stringify({ colors: this.pickers.map(p => p.value.get()), active: this.colorIndex })); } catch { /* memory fallback */ } };
    const applyColor = index => {
      this.colorIndex = index; const value = this.pickers[index].value.get();
      this.element.style.setProperty('--annotation-color', value);
      this.pickers.forEach((p, i) => p.element.classList.toggle('reader-annotation-color-active', i === index));
      changeColor(value); persist();
    };
    this.pickers = colors.map((value, index) => {
      const picker = new ColorPicker({ name: index ? `annotationColor-${index}` : 'annotationColor',
        label: t('annotations.colorPreset', { number: index + 1 }), value, allowEmpty: false, popupPlacement: 'top-end' });
      if (index === 0) {
        picker.mount(this.menu); this.addSubmenu('color', 4, picker.element);
      } else picker.mount(this.secondary.get('color'));
      picker.element.addEventListener('click', event => {
        event.preventDefault(); event.stopImmediatePropagation(); applyColor(index); this.expand(false); this.tab.focus();
      }, { capture: true });
      picker.element.addEventListener('contextmenu', event => {
        event.preventDefault(); event.stopPropagation(); picker.openPopup({ origin: 'user', userAction: true });
      });
      picker.element.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); event.stopImmediatePropagation(); picker.openPopup({ origin: 'user', userAction: true }); }
      }, { capture: true });
      picker.events.on('change', () => applyColor(index));
      return picker;
    });
    this.picker = this.pickers[0]; applyColor(this.colorIndex); this.layoutSubmenus();
    let savedPosition;
    try { savedPosition = JSON.parse(localStorage.getItem('reader.annotationPosition.v1')); } catch { /* optional preference */ }
    this.position = typeof savedPosition === 'number' && Number.isFinite(savedPosition) && savedPosition >= 0 && savedPosition <= 1 ? savedPosition : .5;
    this.tab.addEventListener('click', () => {
      if (this.dragged) { this.dragged = false; return; }
      this.expand(!this.open);
    });
    this.tab.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.dragged = false; this.drag = { id: event.pointerId, y: event.clientY, top: this.element.offsetTop };
      this.tab.setPointerCapture(event.pointerId);
    });
    this.tab.addEventListener('pointermove', event => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const delta = event.clientY - this.drag.y;
      if (Math.abs(delta) > 5) this.dragged = true;
      if (this.dragged) {
        const height = parent.clientHeight;
        this.position = (this.drag.top + delta) / Math.max(1, height); this.layout();
      }
    });
    const finish = () => { if (this.drag && this.dragged) this.savePosition(); this.drag = null; };
    this.tab.addEventListener('pointerup', finish); this.tab.addEventListener('pointercancel', finish);
    this.tab.addEventListener('lostpointercapture', finish);
    this.tab.addEventListener('keydown', event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); this.position = (this.element.offsetTop + (event.key === 'ArrowUp' ? -20 : 20)) / Math.max(1, parent.clientHeight);
        this.layout(); this.savePosition();
      }
    });
    this.resize = new ResizeObserver(() => this.layout()); this.resize.observe(parent);
    this.element.addEventListener('pointerdown', event => event.stopPropagation());
    this.element.addEventListener('click', event => event.stopPropagation());
  }
  addSubmenu(group, slot, anchor) {
    const sub = document.createElement('div'); sub.className = 'reader-annotation-secondary'; sub.hidden = true;
    sub.dataset.duiControlId = `annotationVariants-${group}`; sub.dataset.slot = slot;
    sub.setAttribute('role', 'group'); sub.setAttribute('aria-label', t('annotations.variants'));
    this.element.append(sub); this.secondary.set(group, sub);
    anchor.setAttribute('aria-controls', `annotationVariants-${group}`); sub.id = `annotationVariants-${group}`;
    if (group !== 'text') anchor.setAttribute('aria-expanded', 'false');
    const cancel = () => { clearTimeout(this.hoverTimer); clearTimeout(this.closeTimer); };
    anchor.addEventListener('pointerenter', () => { cancel(); if (this.open) this.hoverTimer = setTimeout(() => this.openSubmenu(group), 180); });
    anchor.addEventListener('pointerleave', () => { clearTimeout(this.hoverTimer); this.closeTimer = setTimeout(() => this.openSubmenu(null), 300); });
    sub.addEventListener('pointerenter', cancel);
    sub.addEventListener('pointerleave', () => { this.closeTimer = setTimeout(() => this.openSubmenu(null), 300); });
    anchor.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' && (this.groups[group]?.length || group === 'color')) {
        event.preventDefault(); this.openSubmenu(group); sub.querySelector('button')?.focus();
      }
    });
    sub.addEventListener('keydown', event => { if (event.key === 'ArrowRight') { event.preventDefault(); this.openSubmenu(null); anchor.focus(); } });
  }
  openSubmenu(group) {
    clearTimeout(this.hoverTimer); clearTimeout(this.closeTimer);
    for (const [name, sub] of this.secondary) {
      const visible = this.open && name === group && sub.children.length > 0;
      sub.hidden = !visible;
      const anchor = name === 'color' ? this.picker?.element : this.buttons?.get(name)?.element;
      if (anchor?.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', String(visible));
    }
  }
  layoutSubmenus() {
    const anchors = [[-21, -68], [-57, -42], [-70, 0], [-57, 42], [-21, 68]];
    for (const sub of this.secondary.values()) {
      const count = sub.children.length;
      if (!count) continue;
      const [anchorX, anchorY] = anchors[Number(sub.dataset.slot)];
      const offsets = count === 2 ? [-13, 13] : [-22, 0, 22];
      const limit = (80 - Math.max(...offsets.map(Math.abs))) * Math.PI / 180;
      const angle = Math.max(-limit, Math.min(limit, Math.atan2(anchorY, -anchorX)));
      const centers = offsets.map(offset => {
        const theta = angle + offset * Math.PI / 180;
        return { x: -120 * Math.cos(theta), y: 120 * Math.sin(theta) };
      });
      // Both rows share the edge tab's circle center. Include the parent in the
      // hit bridge so crossing the gap keeps its child arc open.
      const minX = Math.min(anchorX, ...centers.map(p => p.x)) - 19;
      const maxX = Math.max(anchorX, ...centers.map(p => p.x)) + 19;
      const minY = Math.min(anchorY, ...centers.map(p => p.y)) - 19;
      const maxY = Math.max(anchorY, ...centers.map(p => p.y)) + 19;
      sub.style.right = `${-maxX}px`; sub.style.top = `${minY}px`;
      sub.style.width = `${maxX - minX}px`; sub.style.height = `${maxY - minY}px`;
      [...sub.children].forEach((child, index) => {
        child.style.top = `${centers[index].y - minY - 19}px`;
        child.style.left = `${centers[index].x - minX - 19}px`;
      });
    }
  }
  layout() {
    const height = this.element.parentElement.clientHeight, margin = Math.min(139, height / 2);
    if (height <= 0) return;
    const y = Math.max(margin, Math.min(height - margin, this.position * height));
    this.element.style.top = `${y}px`;
  }
  savePosition() {
    const height = this.element.parentElement.clientHeight;
    if (height <= 0) return;
    this.position = Number.parseFloat(this.element.style.top) / height;
    try { localStorage.setItem('reader.annotationPosition.v1', JSON.stringify(this.position)); } catch { /* memory fallback */ }
  }
  show(visible) { this.element.hidden = !visible; if (!visible) this.expand(false); this.layout(); }
  expand(open) {
    this.open = open; this.menu.hidden = !open;
    this.tab.setAttribute('aria-expanded', String(open));
    if (!open) { this.openSubmenu(null); for (const picker of this.pickers) picker.closePopup(); }
  }
  select(tool) {
    for (const [name, button] of this.buttons) {
      const active = name === tool || this.groups[name].includes(tool);
      button.setPressed(active); button.setIcon(`reader.${name === 'line' ? 'line' : active ? tool : name}`);
    }
    for (const [name, button] of this.childButtons) button.setPressed(name === tool);
  }
  destroy() {
    clearTimeout(this.hoverTimer); clearTimeout(this.closeTimer);
    this.resize.disconnect(); for (const picker of this.pickers) picker.destroy();
    for (const button of this.childButtons.values()) button.destroy();
    for (const button of this.buttons.values()) button.destroy(); this.element.remove();
  }
}
