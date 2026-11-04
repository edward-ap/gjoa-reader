import { localize } from "./localize.js";
import { BaseControl } from "../core/BaseControl.js";
import { DisposableBag } from "../core/DisposableBag.js";
import { FilePicker } from "./FilePicker.js";
import { Button } from "./Button.js";
import { createIcon } from "./Icon.js";
import { IconButton } from "./IconButton.js";
import { ProgressBar } from "./ProgressBar.js";
import { FileUploadQueue } from "./fileUploadQueue.js";

const bytes = size => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
const fileDrag = event => Array.from(event.dataTransfer?.types ?? []).includes('Files');
function dropHandle(record) {
  return { dispose() {
    if (!record.node) return;
    record.reset(); record.bag.dispose(); record.owner._dropAreas.delete(record.node);
    record.node = record.owner = record.bag = record.reset = null;
  } };
}
const user = { origin: 'user', userAction: true };

/** A drop target and file queue. Applications supply transport or consume local File handles. */
export class FileUpload extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const mounted = typeof containerOrOptions === 'string' || typeof HTMLElement !== 'undefined' && containerOrOptions instanceof HTMLElement;
    const options = mounted ? maybeOptions ?? {} : containerOrOptions ?? {};
    super(options);
    if (options.autoUpload && typeof options.upload !== 'function') throw new TypeError("autoUpload requires an upload adapter.");
    this._queue = new FileUploadQueue(options);
    this.autoUpload = options.autoUpload === true;
    this._rows = new Map(); this._dropAreas = new Map();
    this._browse = new FilePicker({ multiple: true, accept: options.accept ?? '', buttonText: localize(this.options, 'Browse files'), clearable: false, css: 'dui-file-upload__picker' });
    this._add = new IconButton({icon:'add', text:localize(this.options, 'Add files'), onClick:()=>this.openPicker()});
    this._start = new Button({ text: localize(this.options, 'Upload'), onClick: () => { void this.start(); } });
    this._cancel = new Button({ text: localize(this.options, 'Cancel all'), onClick: () => this.cancel() });
    this._clear = new Button({ text: localize(this.options, 'Clear'), onClick: () => this.clear() });
    this.disposables.add(this._browse.events.on('change', () => {
      if (this.destroyed) return;
      this.addFiles(this._browse.getFiles(), user);
      if (!this.destroyed) this._browse.clearFiles({ silent: true });
    }));
    this.disposables.add(this._queue.events.on('beforeAdd', event => {
      if (this.destroyed) { event.cancel = true; return; }
      const before = { ...event, source: this, ...(this._addingOptions ?? {}) };
      this.events.emit('beforeAdd', before); event.cancel = before.cancel;
    }));
    this.disposables.add(this._queue.events.on('change', () => { if (!this.destroyed && !this._disposingUpload) this._render(); }));
    for (const name of ['add','reject','remove','cancel','uploadStart','uploadSuccess','uploadError','complete']) {
      this.disposables.add(this._queue.events.on(name, event => {
        if (this.destroyed || this._disposingUpload) return;
        if (name === 'reject' && this._message) this._message.textContent = `${event.file?.name ?? localize(this.options, 'File')}: ${localize(this.options, event.message)}`;
        this.events.emit(name, { ...event, source: this, origin: this._addingOptions?.origin ?? 'api', userAction: this._addingOptions?.userAction === true });
      }));
    }
    if (mounted) this.mount(containerOrOptions);
  }
  get busy() { return this._queue.busy; }
  getEntries() { this._assertMutable('getEntries'); return this._queue.getEntries(); }
  getFiles() { this._assertMutable('getFiles'); return this._queue.getFiles(); }
  getFile(id) { this._assertMutable('getFile'); return this._queue.getFile(id); }
  addFiles(files, options = {}) {
    this._assertMutable('addFiles');
    if (this.disabled) return { accepted: [], rejected: [] };
    const prior = this._addingOptions;
    this._addingOptions = { origin: options.origin ?? 'api', userAction: options.userAction === true };
    if (this._message) this._message.textContent = '';
    try {
      const result = this._queue.addFiles(files);
      if (!this.destroyed && this.autoUpload && result.accepted.length) void this.start();
      return result;
    } finally { this._addingOptions = prior; }
  }
  start() {
    this._assertMutable('start');
    if (this.disabled) return Promise.resolve(this.getEntries());
    return this._queue.start();
  }
  retry(id) { this._assertMutable('retry'); return !this.disabled && this._queue.retry(id); }
  cancel(id) { this._assertMutable('cancel'); this._queue.cancel(id); }
  remove(id) { this._assertMutable('remove'); return this._queue.remove(id); }
  clear() { this._assertMutable('clear'); this._queue.clear(); if (this._message) this._message.textContent = ''; }
  openPicker() { this._assertMutable('openPicker'); return !this.disabled && this._browse.openPicker(); }

  createElement() {
    const root = super.createElement(); root.classList.add('dui-file-upload');
    const toolbar = document.createElement('div'); toolbar.className = 'dui-file-upload__toolbar';
    root.append(toolbar);
    for (const control of [this._add, this._start, this._cancel, this._clear]) control.mount(toolbar);
    const drop = document.createElement('div'); drop.className = 'dui-file-upload__drop';
    drop.append(createIcon('upload', {className:'dui-file-upload__empty-icon'}));
    const hint = document.createElement('div'); hint.textContent = this.options.dropText ?? localize(this.options, 'Drag & drop files here');
    drop.append(hint); this._browse.mount(drop);
    const list = document.createElement('div'); list.className = 'dui-file-upload__list'; list.setAttribute('role','list'); list.setAttribute('aria-label', this.options.label ?? localize(this.options, 'File queue'));
    const message = document.createElement('div'); message.className = 'dui-file-upload__message'; message.setAttribute('role','status');
    this._message = message; this._list = list; this._drop = drop;
    root.append(drop, list, message);
    this.linkDropArea(root);
    this._render();
    return root;
  }
  _render() {
    if (!this._list || this.destroyed) return;
    const entries = this.getEntries(); const ids = new Set(entries.map(entry => entry.id));
    for (const [id, row] of this._rows) if (!ids.has(id)) {
      const focused = row.element.contains(document.activeElement);
      row.progress.destroy(); row.action.destroy(); row.remove.destroy(); row.element.remove(); this._rows.delete(id);
      if (focused) this._add.element?.focus();
    }
    for (const entry of entries) {
      let row = this._rows.get(entry.id);
      if (!row) {
        const element = document.createElement('div'); element.className = 'dui-file-upload__row'; element.setAttribute('role','listitem'); element.dataset.fileId = entry.id;
        const name = document.createElement('span'); name.className = 'dui-file-upload__name';
        const size = document.createElement('span'); size.className = 'dui-file-upload__size';
        const status = document.createElement('span'); status.className = 'dui-file-upload__status';
        const info = document.createElement('div'); info.className = 'dui-file-upload__info';
        const details = document.createElement('div'); details.className = 'dui-file-upload__details'; details.append(name, size);
        info.append(createIcon('file', {className:'dui-file-upload__file-icon'}), details);
        const state = document.createElement('div'); state.className = 'dui-file-upload__state';
        const indicator = document.createElement('div'); indicator.className = 'dui-file-upload__indicator';
        const complete = createIcon('check', {className:'dui-file-upload__complete', label:`Uploaded ${entry.name}`});
        indicator.append(status, complete); state.append(indicator); element.append(info, state);
        const progress = new ProgressBar({ min:0, max:100, showText:false }); progress.mount(indicator);
        progress.element.querySelector('[role=progressbar]').setAttribute('aria-label', localize(this.options, 'Progress for {name}', { name: entry.name }));
        const action = new Button({ text:localize(this.options, 'Retry'), onClick: () => this._queue.canRetry(entry.id) ? this.retry(entry.id) : this.cancel(entry.id) }); action.mount(state);
        const remove = new IconButton({ text:localize(this.options, 'Remove {name}', { name: entry.name }), icon:'remove', onClick: () => this.remove(entry.id) }); remove.mount(state);
        row = { element, name, size, status, complete, progress, action, remove }; this._rows.set(entry.id, row); this._list.append(element);
      }
      row.name.textContent = entry.name; row.name.title = entry.relativePath || entry.name;
      row.size.textContent = `${bytes(entry.size)} · ${new Date(entry.lastModified).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'})}`;
      row.size.title = localize(this.options, 'Size · Last modified');
      row.complete.style.display = entry.status === 'uploaded' ? '' : 'none';
      row.status.hidden = ['uploading','uploaded'].includes(entry.status);
      row.status.textContent = localize(this.options, entry.error || ({queued:'Ready',uploading:'Uploading',uploaded:'Complete',error:'Failed',canceled:'Canceled'}[entry.status]));
      row.status.title = entry.error ?? '';
      row.element.dataset.status = entry.status;
      row.progress.value.set(entry.progress * 100, { silent:true });
      row.progress[entry.status === 'uploading' ? 'show' : 'hide']();
      const retry = ['error','canceled'].includes(entry.status);
      row.action.setText(retry ? localize(this.options, 'Retry') : localize(this.options, 'Cancel'));
      row.action.element.setAttribute('aria-label', `${retry ? localize(this.options, 'Retry') : localize(this.options, 'Cancel')} ${entry.name}`);
      row.action[(entry.status === 'uploaded' || !this._queue.upload) ? 'hide' : 'show']();
      row.action[this.disabled || retry && !this._queue.canRetry(entry.id) ? 'disable' : 'enable']();
      row.remove[this.disabled ? 'disable' : 'enable']();
    }
    this._start[this._queue.upload ? 'show' : 'hide']();
    this._cancel[this._queue.upload ? 'show' : 'hide']();
    this._start[this.disabled || !entries.some(entry => entry.status === 'queued') ? 'disable' : 'enable']();
    this._cancel[this.disabled || !entries.some(entry => ['queued','uploading'].includes(entry.status)) ? 'disable' : 'enable']();
    this._clear[this.disabled || !entries.length ? 'disable' : 'enable']();
    const wasEmpty = !this._drop.hidden;
    this._drop.hidden = entries.length > 0;
    this._list.hidden = entries.length === 0;
    if (entries.length && wasEmpty && this._drop.contains(document.activeElement)) this._add.element.focus();
  }
  linkDropArea(target) {
    this._assertMutable('linkDropArea');
    const node = this._resolveContainer(target);
    if (this._dropAreas.has(node)) return this._dropAreas.get(node).handle;
    const bag = new DisposableBag(); let depth = 0;
    const reset = () => { depth = 0; node.classList.remove('dui-file-upload--dragover'); };
    bag.addEventListener(node, 'dragenter', event => { if (fileDrag(event)) { event.preventDefault(); depth++; if (!this.disabled) node.classList.add('dui-file-upload--dragover'); } });
    bag.addEventListener(node, 'dragleave', event => { if (fileDrag(event) && --depth <= 0) reset(); });
    bag.addEventListener(node, 'dragover', event => { if (fileDrag(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = this.disabled ? 'none' : 'copy'; } });
    bag.addEventListener(node, 'drop', event => {
      if (!fileDrag(event)) return;
      event.preventDefault(); event.stopPropagation(); reset();
      if (this.disabled || this.destroyed) return;
      const transfer = event.dataTransfer;
      const items = Array.from(transfer?.items ?? []).filter(item => item.kind === 'file');
      const files = [], directories = [];
      if (items.length) for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) directories.push(entry.name);
        else { const file = item.getAsFile(); if (file) files.push(file); }
      } else files.push(...Array.from(transfer?.files ?? []));
      this.addFiles(files, user);
      for (const name of directories) {
        if (this.destroyed) break;
        const message = localize(this.options, 'Drop individual files; directory traversal is not supported.');
        if (this._message) this._message.textContent = `${name}: ${message}`;
        this.events.emit('reject', {source:this,file:null,name,code:'directory',message,...user});
      }
    });
    const handle = dropHandle({ node, owner: this, bag, reset });
    this._dropAreas.set(node, { handle, reset });
    return handle;
  }
  _applyDisabledState() {
    super._applyDisabledState();
    if (!this._browse) return;
    this._browse[this.disabled ? 'disable' : 'enable']();
    this._add[this.disabled ? 'disable' : 'enable']();
    if (this.disabled) for (const area of this._dropAreas.values()) area.reset();
    this._render();
  }
  destroy() {
    if (this.destroyed || this._disposingUpload) return;
    this._disposingUpload = true;
    this._queue.destroy();
    for (const area of [...this._dropAreas.values()]) area.handle.dispose();
    for (const row of this._rows.values()) { row.progress.destroy(); row.action.destroy(); row.remove.destroy(); }
    this._rows.clear();
    for (const child of [this._browse,this._add,this._start,this._cancel,this._clear]) child.destroy();
    super.destroy(); this._list = null; this._drop = null; this._message = null; this.options = {};
  }
}
