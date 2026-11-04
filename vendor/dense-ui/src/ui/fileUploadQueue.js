import { DataStore } from "../core/DataStore.js";
import { EventBus } from "../core/EventBus.js";

function limit(value, fallback, integer = false) {
  value ??= fallback;
  if (value !== Infinity && (!Number.isFinite(value) || value < 0 || integer && (!Number.isInteger(value) || value < 1))) throw new TypeError("Invalid file limit.");
  return value;
}
function parseAccept(value) {
  if (typeof value !== "string") throw new TypeError("accept must be a string.");
  const rules = value.split(',').map(rule => rule.trim().toLowerCase()).filter(Boolean);
  if (rules.some(rule => !/^\.[^\s/,]+$/.test(rule) && !/^[\w!#$&^.+-]+\/(?:[\w!#$&^.+-]+|\*)$/.test(rule))) throw new TypeError("accept requires extensions or MIME types.");
  return rules;
}
const fingerprint = file => JSON.stringify([file.name, file.size, file.type, file.lastModified, file.webkitRelativePath ?? '']);

/** Internal queue engine; keeps File handles separate from metadata and uses no transport by default. */
export class FileUploadQueue {
  constructor(options = {}) {
    this.events = new EventBus();
    this.destroyed = false;
    this.upload = options.upload ?? null;
    if (this.upload != null && typeof this.upload !== 'function') throw new TypeError("upload must be a function.");
    this.accept = options.accept ?? '';
    this._rules = parseAccept(this.accept);
    this.maxFiles = limit(options.maxFiles, 100, true);
    this.maxFileSize = limit(options.maxFileSize, Infinity);
    this.maxTotalSize = limit(options.maxTotalSize, Infinity);
    this.concurrency = limit(options.concurrency, 2, true);
    if (this.concurrency === Infinity) throw new TypeError("concurrency must be finite.");
    this.allowDuplicates = options.allowDuplicates === true;
    this._data = new DataStore();
    this._files = new Map();
    this._active = new Map();
    this._ready = new Set();
    this._sequence = 0;
    this._revision = 0;
    this._run = null;
  }
  _assert() { if (this.destroyed) throw new Error("FileUpload queue is destroyed."); }
  get busy() { return this._active.size > 0 || this._ready.size > 0; }
  getEntries() { this._assert(); return this._data.all().map(entry => ({ ...entry })); }
  getFile(id) { this._assert(); return this._files.get(id) ?? null; }
  getFiles() { this._assert(); return [...this._files.values()]; }
  canRetry(id) { return !this._active.has(id) && ['error','canceled'].includes(this._data.get(id)?.status); }
  _emit(type, details = {}) { if (!this.destroyed) this.events.emit(type, { source: this, ...details }); }
  _changed() { this._revision++; this._emit('change'); }
  _update(id, patch) {
    if (this.destroyed || !this._data.get(id)) return;
    this._data.update(id, patch, { silent: true, history: false }); this._changed();
  }
  _reason(file) {
    if (!(typeof File !== 'undefined' && file instanceof File)) return ['file', 'Only browser File objects are accepted.'];
    if (this._rules.length && !this._rules.some(rule => rule.startsWith('.') ? file.name.toLowerCase().endsWith(rule) :
      rule.endsWith('/*') ? file.type.toLowerCase().startsWith(rule.slice(0,-1)) : file.type.toLowerCase() === rule)) return ['type', 'File type is not accepted.'];
    if (file.size > this.maxFileSize) return ['size', 'File exceeds the per-file size limit.'];
    const entries = this._data.all();
    if (entries.length >= this.maxFiles) return ['count', 'File count limit reached.'];
    if (entries.reduce((sum, item) => sum + item.size, 0) + file.size > this.maxTotalSize) return ['totalSize', 'Total file size limit reached.'];
    if (!this.allowDuplicates && [...this._files.values()].some(item => fingerprint(item) === fingerprint(file))) return ['duplicate', 'File is already in the queue.'];
    return null;
  }
  addFiles(files) {
    this._assert();
    if (this._adding) throw new Error("Cannot add files recursively.");
    const accepted = [], rejected = [];
    this._adding = true;
    try {
      for (const file of Array.from(files)) {
        if (this.destroyed) break;
        let reason = this._reason(file);
        if (!reason) {
          const revision = this._revision;
          const before = { source: this, file, cancel: false };
          this.events.emit('beforeAdd', before);
          if (this.destroyed || revision !== this._revision) break;
          if (before.cancel) reason = ['veto', 'File was rejected by the application.'];
        }
        if (reason) {
          const rejection = { file, code: reason[0], message: reason[1] };
          rejected.push(rejection); this._emit('reject', rejection);
          continue;
        }
        const entry = { id: `upload-${++this._sequence}`, name: file.name, size: file.size, type: file.type,
          lastModified: file.lastModified, relativePath: file.webkitRelativePath ?? '', status: 'queued', progress: 0, error: null, result: undefined };
        this._files.set(entry.id, file); this._data.add(entry, { silent: true, history: false }); accepted.push({ ...entry });
        this._changed(); this._emit('add', { entry: { ...entry }, file });
      }
    } finally { this._adding = false; }
    return { accepted, rejected };
  }
  start() {
    this._assert();
    if (!this.upload) throw new Error("Configure upload(file, context) before starting uploads.");
    for (const entry of this._data.all()) if (entry.status === 'queued') this._ready.add(entry.id);
    if (!this._run) {
      let resolve; const promise = new Promise(done => { resolve = done; });
      this._run = { promise, resolve };
    }
    const promise = this._run.promise;
    this._pump(); return promise;
  }
  retry(id) {
    this._assert();
    if (!this.upload || !this.canRetry(id)) return false;
    this._update(id, { status: 'queued', progress: 0, error: null, result: undefined });
    if (!this.destroyed) void this.start();
    return true;
  }
  cancel(id) {
    this._assert();
    const ids = id == null ? this._data.all().map(entry => entry.id) : [id];
    for (const key of ids) {
      if (this.destroyed) break;
      const entry = this._data.get(key);
      if (!entry || !['queued','uploading'].includes(entry.status)) continue;
      this._ready.delete(key);
      const job = this._active.get(key); job?.controller.abort();
      this._update(key, { status: 'canceled' }); this._emit('cancel', { id: key });
    }
    this._pump();
  }
  remove(id) {
    this._assert();
    if (!this._data.get(id)) return false;
    this._ready.delete(id); this._active.get(id)?.controller.abort();
    if (this.destroyed) return false;
    this._files.delete(id); this._data.remove(id, { silent: true, history: false });
    this._changed(); this._emit('remove', { id }); this._pump(); return true;
  }
  clear() {
    this._assert();
    this._ready.clear();
    for (const job of this._active.values()) job.controller.abort();
    if (this.destroyed) return;
    this._files.clear(); this._data.clear({ silent: true, history: false }); this._changed(); this._pump();
  }
  _pump() {
    if (this.destroyed || this._pumping) return;
    this._pumping = true;
    try {
      while (!this.destroyed && this._ready.size && this._active.size < this.concurrency) {
        const id = this._ready.values().next().value; this._ready.delete(id);
        if (this._data.get(id)?.status !== 'queued' || !this._files.has(id)) continue;
        this._launch(id);
      }
      if (!this.destroyed && !this.busy && this._run) {
        const run = this._run; this._run = null;
        const entries = this.getEntries(); run.resolve(entries); this._emit('complete', { entries });
      }
    } finally {
      this._pumping = false;
      if (!this.destroyed && this._ready.size && this._active.size < this.concurrency) queueMicrotask(() => this._pump());
    }
  }
  _launch(id) {
    const job = { controller: new AbortController() };
    const file = this._files.get(id);
    this._active.set(id, job);
    this._update(id, { status: 'uploading', error: null });
    const current = () => !this.destroyed && this._active.get(id) === job && !job.controller.signal.aborted && this._files.get(id) === file;
    Promise.resolve().then(() => {
      if (!current()) return;
      this._emit('uploadStart', { entry: { ...this._data.get(id) }, file });
      if (!current()) return;
      return this.upload(file, { signal: job.controller.signal, entry: { ...this._data.get(id) }, onProgress: value => {
        if (!current() || !Number.isFinite(value)) return;
        const progress = Math.max(this._data.get(id).progress, Math.min(.999, Math.max(0, value)));
        this._update(id, { progress });
      } });
    }).then(result => {
      if (!current()) return;
      this._update(id, { status: 'uploaded', progress: 1, result });
      if (current()) this._emit('uploadSuccess', { entry: { ...this._data.get(id) }, result });
    }, error => {
      if (!current()) return;
      this._update(id, { status: 'error', error: error instanceof Error ? error.message : String(error) });
      if (current()) this._emit('uploadError', { entry: { ...this._data.get(id) }, error });
    }).finally(() => {
      if (this.destroyed) return;
      this._active.delete(id); this._changed(); this._pump();
    });
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const job of this._active.values()) job.controller.abort();
    this._active.clear(); this._ready.clear(); this._files.clear(); this._data.destroy();
    this._run?.resolve([]); this._run = null; this.upload = null; this.events.destroy();
  }
}
