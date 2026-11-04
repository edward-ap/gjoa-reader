/**
 * Narrow application-owned bridge for publication feedback inside FileUpload.
 *
 * Upstream 0.6.0-rc.1 has no row presentation slot. This explicit exception uses
 * only its pinned data-file-id row identity and ARIA progressbar, plus the bar's
 * immediate parent as insertion host. No queue fields, Dense control instances,
 * indicator classes or existing row text/attributes are read or mutated.
 *
 * Each upload attempt owns a token, so old native completions cannot remove or
 * repaint a retry's label. Public getEntries verifies that a row is still active.
 * The application owns only the inserted node and removes it on settlement.
 */
export class ImportStageAdapter {
  constructor(upload) {
    this.upload = upload;
    this.records = new Map();
    this.disposed = false;
  }
  begin(id) {
    const token = Object.freeze({ id: String(id) });
    const previous = this.records.get(token.id);
    previous?.node?.remove();
    if (!this.disposed) this.records.set(token.id, { token, node: null });
    return token;
  }
  update(token, stage, text) {
    const record = this.records.get(token?.id);
    if (this.disposed || this.upload.destroyed || !record || record.token !== token) return false;
    const entry = this.upload.getEntries().find(entry => String(entry.id) === token.id);
    if (entry?.status !== 'uploading') { this.clear(token); return false; }
    const row = this.upload.element.querySelector('[data-file-id="' + CSS.escape(token.id) + '"]');
    const bar = row?.querySelector('[role="progressbar"]');
    if (!bar?.parentElement) return false;
    let node = record.node;
    if (!node) {
      node = this.upload.element.ownerDocument.createElement('div');
      node.className = 'import-stage';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.dataset.importId = token.id;
      record.node = node;
    }
    // Row rendering is retained today; reinserting also tolerates a replaced host.
    if (node.parentElement !== bar.parentElement || node.nextElementSibling !== bar)
      bar.parentElement.insertBefore(node, bar);
    node.textContent = String(text);
    node.dataset.importStage = stage;
    return true;
  }
  clear(token) {
    const record = this.records.get(token?.id);
    if (!record || record.token !== token) return;
    record.node?.remove();
    this.records.delete(token.id);
  }
  settle(id) {
    if (this.disposed || this.upload.destroyed) return;
    const key = String(id), entry = this.upload.getEntries().find(entry => String(entry.id) === key);
    // A stale terminal notification cannot clear a new attempt already uploading.
    if (entry?.status === 'uploading') return;
    const record = this.records.get(key);
    if (record) this.clear(record.token);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.records.values()) record.node?.remove();
    this.records.clear();
  }
}
