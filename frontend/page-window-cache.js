export function pageWindow(index, count) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count) throw new RangeError('Invalid page window');
  return [index - 1, index, index + 1].filter(page => page >= 0 && page < count);
}

// Page bitmaps have one owner. Neither presentation nor callers may close them.
// At most three desired entries; native work remains serialized, even after abort.
export class PageWindowCache {
  entries = new Map();
  tail = Promise.resolve();
  revision = 0;
  constructor(onChange = () => {}) { this.onChange = onChange; }
  setWindow(documentId, targets, rendererForPage) {
    if (targets.length > 3 || new Set(targets.map(t => t.pageIndex)).size !== targets.length) throw new RangeError('Expected at most three unique pages');
    const keys = new Map(targets.map(t => [t.pageIndex, `${documentId}/${t.pageIndex}/${t.targetWidth}x${t.targetHeight}`]));
    for (const [index, entry] of this.entries) {
      if (keys.get(index) !== entry.key) { this.release(entry); this.entries.delete(index); }
    }
    for (const target of targets) {
      if (!this.entries.has(target.pageIndex)) this.entries.set(target.pageIndex, {
        key: keys.get(target.pageIndex), target, provider: rendererForPage(target.pageIndex), controller: new AbortController(), result: null, promise: null, error: null,
      });
    }
    this.revision++;
  }
  get(index) {
    const entry = this.entries.get(index);
    if (!entry) return Promise.reject(new DOMException('Page evicted', 'AbortError'));
    if (entry.result) return Promise.resolve(entry.result.image);
    if (entry.promise) return entry.promise;
    const signal = entry.controller.signal;
    const work = this.tail.then(async () => {
      signal.throwIfAborted();
      const result = await entry.provider({ ...entry.target, signal, requestId: entry.key });
      if (signal.aborted) { if (result.owned) result.image.close(); signal.throwIfAborted(); }
      entry.result = result;
      this.onChange();
      return result.image;
    });
    entry.promise = work.catch(error => { if (!signal.aborted) { entry.error = error; this.onChange(); } throw error; });
    this.tail = entry.promise.catch(() => {});
    return entry.promise;
  }
  release(entry) { entry.controller.abort(); if (entry.result?.owned) entry.result.image.close(); entry.result = null; }
  clear() { for (const entry of this.entries.values()) this.release(entry); this.entries.clear(); this.revision++; }
  get busy() { return [...this.entries.values()].some(e => e.promise && !e.result && !e.error); }
  get diagnostics() { return [...this.entries].map(([pageIndex, e]) => ({ pageIndex, width: e.target.targetWidth, height: e.target.targetHeight,
    bytes: e.result ? e.target.targetWidth * e.target.targetHeight * 4 : 0, status: e.result ? 'ready' : e.error ? 'error' : e.promise ? 'rendering' : 'empty' })); }
}
