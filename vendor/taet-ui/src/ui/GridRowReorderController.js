// Internal Grid-only presentation; all writes go through Grid.moveRows().
export class GridRowReorderController {
  constructor(grid) { this.grid = grid; this.state = null; this.subscriptions = []; this.timer = null; }
  attach(body) {
    const g = this.grid;
    if (!g.rowReorderEnabled) return;
    for (const [type, handler] of [
      ['dragstart', e => this.start(e)], ['dragover', e => this.over(e)],
      ['drop', e => this.drop(e)], ['dragend', () => this.finish()],
      ['dragleave', e => { if (!body.contains(e.relatedTarget)) this.clearTarget(); }],
      ['keydown', e => this.key(e)]
    ]) g.disposables.addEventListener(body, type, handler);
    g.disposables.addEventListener(document, 'dragend', () => this.finish());
    g.disposables.addEventListener(document, 'drop', () => this.finish());
    g.disposables.addEventListener(window, 'blur', () => this.finish());
    g.disposables.addEventListener(document, 'keydown', e => { if (e.key === 'Escape') this.finish(); });
  }
  handle() {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'dui-grid__row-handle'; button.draggable = true;
    button.textContent = '⋮'; button.setAttribute('aria-label', 'Move row');
    button.title = 'Drag to move row; Alt+Up/Down to move with keyboard';
    return button;
  }
  item(event) {
    const row = event.target.closest?.('.dui-grid__row[data-dui-grid-row-id]');
    if (!row || !this.grid?._body?.contains(row)) return null;
    return { row, item: this.grid._getItemFromRow(row) };
  }
  ids(item) {
    const g = this.grid, id = g.data.idOf(item), selected = g.getSelectedIds();
    return selected.includes(id) ? selected : [id];
  }
  start(event) {
    const g = this.grid;
    if (!event.target.closest?.('.dui-grid__row-handle')) return;
    this.finish();
    const hit = this.item(event);
    if (!g?._canReorderRows() || !hit?.item) { event.preventDefault(); return; }
    this.state = { ids: this.ids(hit.item) };
    event.stopPropagation();
    event.dataTransfer?.setData('text/plain', 'Tæt UI rows');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    // Projection/data changes cancel the gesture; scrolling does not.
    for (const model of [g.data, g.view, g.groups]) {
      this.subscriptions.push(model.events.on('invalidate', () => this.finish()));
    }
  }
  over(event) {
    const g = this.grid, hit = this.item(event);
    if (!this.state) return;
    if (!g?._canReorderRows()) { this.finish(); return; }
    if (!hit?.item || this.state.ids.includes(g.data.idOf(hit.item))) { this.clearTarget(); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.clearTarget();
    const rect = hit.row.getBoundingClientRect();
    this.state.targetId = g.data.idOf(hit.item);
    this.state.position = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
    hit.row.classList.add('dui-grid__row--drop-' + this.state.position);
    const bounds = g._body.getBoundingClientRect();
    const delta = event.clientY < bounds.top + 24 ? -16 : event.clientY > bounds.bottom - 24 ? 16 : 0;
    if (delta) this.timer = setInterval(() => {
      if (!this.grid?._canReorderRows() || !this.state) { this.finish(); return; }
      this.grid._body.scrollTop += delta;
    }, 50);
  }
  drop(event) {
    const g = this.grid, state = this.state, hit = this.item(event);
    if (!state || !hit?.item || !g?._canReorderRows()) { this.finish(); return; }
    event.preventDefault(); event.stopPropagation();
    // Resolve the actual drop row, never a cached DOM index from before scrolling.
    const rect = hit.row.getBoundingClientRect();
    const targetId = g.data.idOf(hit.item);
    const position = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
    this.finish();
    g.moveRows(state.ids, targetId, { position, origin:'user', userAction:true });
  }
  key(event) {
    if (!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key) ||
        !event.target.closest?.('.dui-grid__row-handle')) return;
    event.preventDefault(); event.stopPropagation();
    const g = this.grid, hit = this.item(event);
    if (!g?._canReorderRows() || !hit?.item) return;
    const ids = this.ids(hit.item), rows = g.view.all();
    const indices = rows.flatMap((row, i) => ids.includes(g.data.idOf(row)) ? [i] : []);
    if (!indices.length) return;
    const up = event.key === 'ArrowUp';
    const target = rows[up ? indices[0] - 1 : indices.at(-1) + 1];
    if (!target) return;
    const id = g.data.idOf(hit.item);
    const changed = g.moveRows(ids, g.data.idOf(target), { position:up ? 'before' : 'after', origin:'user', userAction:true });
    if (changed && !g.destroyed) {
      g._windowRenderer.flush();
      if (!g.destroyed) g._getCellElement(id, g._visibleColumns()[0]?.id)?.querySelector('.dui-grid__row-handle')?.focus();
    }
  }
  clearTarget() {
    clearInterval(this.timer); this.timer = null;
    this.grid?._body?.querySelectorAll('.dui-grid__row--drop-before, .dui-grid__row--drop-after')
      .forEach(row => row.classList.remove('dui-grid__row--drop-before', 'dui-grid__row--drop-after'));
  }
  finish() {
    this.clearTarget(); this.state = null;
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
  }
  destroy() { this.finish(); this.grid = null; }
}
