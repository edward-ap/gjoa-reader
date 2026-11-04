import { t, denseText } from './i18n/i18n.js';
import { ImportStageAdapter } from './import-stage-adapter.js';
import { Panel, Button, ReadonlyText, TextInput } from 'taet-ui';
import { TreeExplorer, FileUpload, Dialog, FieldGroup, List, ContextMenu } from 'taet-ui/experimental';
import { libraryRows, moveTarget, uploadFile, progressPercent, isCompleted, MAX_SOURCE_BYTES } from './library-model.js';

export class LibraryController {
  constructor(owner, invoke, onOpen, binary = (bytes, id) => window.__TAURI__.core.invoke('append_import', bytes, { headers: { 'x-upload-id': String(id) } }), report = () => {}) {
    Object.assign(this, { owner, invoke, onOpen, binary, report, destroyed: false, busy: false });
    this.thumbnails = new Map(); this.thumbQueue = []; this.thumbPending = new Set(); this.thumbBusy = false;
    this.observed = new Set();
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { this.observer.unobserve(entry.target); this.observed.delete(entry.target); this.requestThumbnail(entry.target.dataset.itemId); }
    });
    this.recentGroup = new FieldGroup({ title: t('library.recent'), width: '100%', css: 'recent-group' });
    this.treeGroup = new Panel({ width: '100%', css: 'tree-group' });
    owner.add(this.recentGroup, this.treeGroup);
    this.recent = new List({ name: 'recentBooks', width: '100%', itemHeight: 30, renderItem: item => this.renderBook(item) });
    this.recentGroup.add(this.recent);
    this.recentMenu = new ContextMenu();
    this.recentMenu.mount(document.body); owner.disposables.add(() => this.recentMenu.destroy());
    owner.disposables.addEventListener(this.recent.element, 'contextmenu', event => {
      const node = event.target.closest('[data-library-id]');
      const row = node && this.recent.data.get(node.dataset.libraryId);
      if (!row) return;
      event.preventDefault(); this.showRecentMenu(row, event.clientX, event.clientY);
    });
    owner.disposables.addEventListener(this.recent.element, 'keydown', event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const row = this.recent.selection.get()[0];
      if (!row) return;
      event.preventDefault(); event.stopPropagation();
      const node = this.recent.element.querySelector(`[data-library-id="${CSS.escape(row.id)}"]`);
      const rect = (node ?? this.recent.element).getBoundingClientRect();
      this.showRecentMenu(row, rect.left, rect.bottom);
    }, true);
    this.tree = new TreeExplorer({ translate: denseText, name: 'libraryTree', title: t('library.title'), width: '100%', height: '100%', dragDrop: true, showHeader: false, rowHeight: 24,
      nodeIcon: row => row.kind === 'folder' ? 'folder' : null,
      renderName: row => this.renderBook(row), renderDetail: row => this.renderProgress(row),
      provider: { canExecute: (command, context) => this.canExecute(command, context), execute: request => this.execute(request) } });
    this.treeGroup.add(this.tree);
    this.installResourceCommands();
    this.bookMenu = new ContextMenu({ commands: this.tree.commands });
    this.bookMenu.mount(document.body); owner.disposables.add(() => this.bookMenu.destroy());
    this.tree.commands.register('closeBook', { label: t('common.close'),
      visible: ({ id }) => !!this.tree.grid.data.get(id)?.itemId,
      enabled: ({ id }) => this.canClose(this.tree.grid.data.get(id)?.itemId),
      run: ({ id }) => this.closeBook(this.tree.grid.data.get(id)?.itemId) });
    // The application owns resource menus. Never inspect TreeExplorer.menu or
    // depend on its private command context. Capture on the parent before the
    // composed TreeExplorer handles an event; identify rows by application markup
    // and the public ARIA row semantic, then execute with an explicit item ID.
    const atEvent = target => {
      const node = target.closest('[data-library-id]') ?? target.closest('[role="row"]')?.querySelector('[data-library-id]');
      return node ? this.tree.grid.data.get(node.dataset.libraryId) : null;
    };
    owner.disposables.addEventListener(this.treeGroup.element, 'contextmenu', event => {
      if (event.target.closest('input,textarea,[contenteditable=true]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.showResourceMenu(atEvent(event.target), event.clientX, event.clientY);
    }, true);
    owner.disposables.addEventListener(this.treeGroup.element, 'click', event => {
      const button = event.target.closest('button[aria-haspopup="menu"]');
      if (!button) return;
      const row = atEvent(button); if (!row) return;
      const rect = button.getBoundingClientRect();
      event.preventDefault(); event.stopImmediatePropagation();
      this.showResourceMenu(row, rect.left, rect.bottom);
    }, true);
    owner.disposables.addEventListener(this.treeGroup.element, 'keydown', event => {
      if (event.target.closest('input,textarea,select,[contenteditable=true]')) return;
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const row = atEvent(event.target) ?? this.tree.grid.selection.get()[0];
      const rect = event.target.getBoundingClientRect();
      event.preventDefault(); event.stopImmediatePropagation();
      this.showResourceMenu(row, rect.left, rect.bottom);
    }, true);
    this.recent.events.on('itemClick', event => this.open(event.item));
    owner.disposables.addEventListener(this.recent.element, 'keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); this.open(this.recent.selection.get()[0]); }
    });
    this.tree.grid.events.on('rowClick', event => { if (event.nativeEvent?.detail === 2) this.open(event.item); });
    this.tree.events.on('operationError', event => this.tell(event.error));
    owner.disposables.add(() => {
      this.destroyed = true; this.dialog?.destroy(); this.observer.disconnect(); this.observed.clear(); this.thumbnails.clear(); this.thumbQueue.length = 0;
    });
    this.ready = this.refresh().catch(error => this.tell(error));
  }
  tell(text) { if (!this.destroyed) { this.report(String(text?.message ?? text)); this.message?.setText(String(text?.message ?? text)); } }
  resources(snapshot) { return libraryRows(snapshot).map(row => ({ ...row, name: row.label, kind: row.kind === 'book' ? 'file' : 'folder', system: row.kind === 'root', cutPending: this.clipboard?.id === row.id })); }
  async refresh(select) {
    const snapshot = await this.invoke('list_library'); if (this.destroyed) return;
    this.snapshot = snapshot;
    const rows = this.resources(snapshot);
    this.bookMenu?.close({ silent: true });
    this.tree.setResources(rows); this.tree.grid.expandAll();
    if (select) this.tree.grid.selectById(select);
    this.updateRecent(rows);
  }
  updateRecent(rows = this.resources(this.snapshot)) {
    this.onEmptyChange?.(this.snapshot.items.length === 0 && !this.dialog);
    this.recentMenu.close({ silent: true });
    const byId = new Map(rows.filter(row => row.itemId).map(row => [row.itemId, row]));
    this.recent.data.parse((this.snapshot.recent ?? []).slice(0, 5).map(id => byId.get(id)).filter(Boolean));
  }
  async opened() {
    const snapshot = await this.invoke('list_library'); if (this.destroyed) return;
    this.snapshot = snapshot; this.updateRecent();
  }
  open(row) { if (row?.itemId && !this.busy) void this.onOpen(row.itemId); }
  showRecentMenu(row, x, y) {
    this.recentMenu.setItems([{ id: 'remove', text: t('resource.remove'), onClick: () => this.removeRecent(row.itemId) },
      { type: 'separator' }, { id: 'close', text: t('common.close'), disabled: !this.canClose(row.itemId), onClick: () => this.closeBook(row.itemId) }]);
    this.recentMenu.openAt(x, y);
  }
  /** Public command states are evaluated against a stable explicit context.
   * Menu items own their labels/actions; no borrowed internal menu or model exists.
   */
  showResourceMenu(row, x, y) {
    if (this.destroyed || this.dialog || this.tree.busy) return;
    const id = row?.id ?? null, context = { id };
    if (id != null) this.tree.grid.selectById(id);
    const commands = row ? ['open', ...(row.kind === 'folder' ? ['newFolder'] : []), null,
      'rename', 'delete', null, 'cut', 'copy', ...(row.kind === 'folder' ? ['paste'] : []), null,
      'properties', ...(row.itemId ? [null, 'closeBook'] : [])] : ['newFolder', 'paste', 'refresh'];
    this.bookMenu.setItems(commands.map(command => {
      if (!command) return { type: 'separator' };
      const state = this.tree.commands.state(command, context);
      return { id: command, text: state.label, shortcut: state.shortcut, icon: state.icon,
        disabled: !state.enabled, hidden: !state.visible,
        onClick: () => this.tree.commands.execute(command, context, { origin: 'user', userAction: true }) };
    }));
    this.bookMenu.openAt(x, y, { origin: 'user', userAction: true });
  }
  canClose(itemId) { return !!itemId && !this.busy && !this.dialog && !!this.isOpen?.(itemId); }
  async closeBook(itemId) {
    if (!this.canClose(itemId)) return;
    try { await this.onClose?.(itemId); }
    catch (error) { if (!this.destroyed) this.tell(error); }
    finally { if (!this.destroyed) this.tree.commands.refreshState(); }
  }
  async removeRecent(itemId) {
    try {
      const snapshot = await this.invoke('remove_recent_book', { itemId });
      if (this.destroyed) return;
      this.snapshot = snapshot; this.updateRecent();
    } catch (error) { if (!this.destroyed) this.tell(error); }
  }
  installResourceCommands() {
    for (const command of ['newFolder', 'rename', 'delete', 'properties', 'cut', 'paste']) {
      const definition = this.tree.commands.get(command);
      this.tree.commands.unregister(command);
      this.tree.commands.register(command, { ...definition,
        enabled: ({ id }) => {
          const item = this.tree.grid.data.get(id);
          return !this.dialog && !this.tree.busy && this.canExecute(command, { item, parentId: item?.kind === 'folder' ? item.id : item?.parentId, clipboard: this.clipboard });
        },
        run: async ({ id }) => {
          const row = this.tree.grid.data.get(id);
          try {
            if (command === 'cut') return this.setClipboard(row.id);
            if (command === 'paste') {
              this.busy = true;
              const result = await this.execute({ command: 'move', id, parentId: id, clipboard: this.clipboard, signal: new AbortController().signal });
              if (!this.destroyed) { this.tree.setResources(result.items); this.tree.grid.expandAll(); this.tree.grid.selectById(result.selectId); }
            } else if (command === 'newFolder') await this.createFolder(row?.kind === 'folder' ? row : this.tree.grid.data.get(row?.parentId));
            else if (command === 'rename') await this.rename(row);
            else if (command === 'delete') await this.delete(row);
            else await this.properties(row);
          } catch (error) { this.tell(error); }
          finally { if (!this.destroyed) { this.busy = false; this.tree.commands.refreshState(); } }
        } });
    }
    this.owner.disposables.addEventListener(this.tree.element, 'keydown', event => {
      if (event.key === 'Escape' && this.clipboard && !this.dialog && !this.busy) {
        event.preventDefault(); this.setClipboard(null);
      }
    }, true);
  }
  setClipboard(id) {
    const previous = this.clipboard?.id;
    this.clipboard = id == null ? null : { id, mode: 'cut' };
    for (const key of new Set([previous, id])) if (key && this.tree.grid.data.get(key)) this.tree.grid.data.update(key, { cutPending: key === id });
    this.tree.commands.refreshState();
  }
  canPaste(target, clipboard) {
    const source = this.tree?.grid.data.get(clipboard?.id);
    if (!source || source.system || target?.kind !== 'folder' || source.id === target.id || source.parentId === target.id) return false;
    if (source.itemId) return true;
    if (target.id === 'new') return false;
    const seen = new Set();
    for (let node = target; node; node = this.tree.grid.data.get(node.parentId)) {
      if (node.id === source.id || seen.has(node.id)) return false;
      seen.add(node.id);
    }
    return true;
  }
  async resourceDialog(title, build, { cancel = true, accept = async () => true, secondaryAction = null, acceptText = t('common.ok'), cancelText = t('common.cancel') } = {}) {
    if (this.dialog || this.destroyed) return;
    const content = new Panel({ width: '100%', css: 'library-dialog-content' });
    let pending = false;
    const secondary = secondaryAction ? new Button({ text:secondaryAction.text, onClick:() => { if (!pending) secondaryAction.onClick(); } }) : null;
    const ok = new Button({ text: acceptText, onClick: async () => {
      if (pending) return;
      pending = true; ok.disable(); cancelButton?.disable(); secondary?.disable(); this.busy = true;
      try { if (await accept() !== false && !this.destroyed) { pending = false; dialog.close('ok'); } }
      catch (error) { if (!message.destroyed) { message.setText(String(error?.message ?? error)); message.show(); } }
      finally { pending = false; this.busy = false; if (!ok.destroyed) ok.enable(); if (!cancelButton?.destroyed) cancelButton?.enable(); if (!secondary?.destroyed) secondary?.enable(); }
    } });
    const cancelButton = cancel ? new Button({ text: cancelText, onClick: () => dialog.close('cancel') }) : null;
    const dialog = new Dialog({ translate: denseText, title, width: 440, content, destroyContent: true, className: secondaryAction ? 'settings-dialog' : undefined,
      buttons: secondary ? [secondary, ...(cancelButton ? [cancelButton] : []), ok] : [ok, ...(cancelButton ? [cancelButton] : [])] });
    dialog.disposables.add(() => ok.destroy()); if (secondary) dialog.disposables.add(() => secondary.destroy()); if (cancelButton) dialog.disposables.add(() => cancelButton.destroy());
    dialog.events.on('beforeClose', event => { if (pending) event.cancel = true; });
    this.dialog = dialog;
    const result = dialog.showModal();
    const focus = build(content);
    const message = new ReadonlyText({ text: '', role: 'status', width: '100%', css: 'library-message' }); content.add(message); message.hide();
    dialog.disposables.addEventListener(content.element, 'keydown', event => {
      if (event.key === 'Enter' && !event.isComposing && !event.defaultPrevented &&
          event.target.matches?.('input[type=text],input[type=search],input[type=email],input[type=url],input[type=tel],input[type=password],input[type=number]')) {
        event.preventDefault(); ok.getFocusElement().click();
      }
    });
    dialog.reposition();
    const observer = new ResizeObserver(() => dialog.reposition()); observer.observe(dialog.element);
    dialog.disposables.add(() => observer.disconnect());
    if (focus) queueMicrotask(() => { if (!focus.destroyed) { focus.focus(); focus.getFocusElement().select(); } });
    try { return await result; }
    finally { if (this.dialog === dialog) this.dialog = null; dialog.destroy(); }
  }
  async createFolder(parent) {
    if (!parent || !this.canExecute('newFolder', { parentId: parent.id })) return;
    let input;
    await this.resourceDialog(t('resource.newFolder'), panel => {
      input = new TextInput({ name: 'resourceName', label: t('resource.name'), width: '100%', maxLength: 100, value: '' });
      panel.add(input); return input;
    }, { accept: async () => {
      const name = String(input.value.get() ?? '').trim();
      if (!name) throw Error(t('error.name'));
      const id = await this.invoke('create_library_folder', { parentId: parent.folderId ?? null, name });
      await this.refresh(`folder:${id}`);
    } });
  }
  async rename(row) {
    let input;
    await this.resourceDialog(row.itemId ? t('resource.renameBook') : t('resource.renameFolder'), panel => {
      input = new TextInput({ name: 'resourceName', label: t('resource.name'), width: '100%', maxLength: row.itemId ? 500 : 100,
        value: row.name }); panel.add(input); return input;
    }, { accept: async () => {
      const name = String(input.value.get() ?? '').trim();
      if (!name) throw Error(t('error.name'));
      await this.invoke(row.id === 'mylib' ? 'rename_library_root' : row.itemId ? 'rename_library_item' : 'rename_library_folder', { itemId: row.itemId, folderId: row.folderId, name });
      await this.refresh(row.id);
      if (row.itemId) this.onRename?.(row.itemId, name);
    } });
  }
  descendants(row) {
    const ids = new Set([row.id]);
    const rows = this.tree.getResources();
    let changed = true;
    while (changed) { changed = false; for (const child of rows) if (ids.has(child.parentId) && !ids.has(child.id)) { ids.add(child.id); changed = true; } }
    return rows.filter(child => ids.has(child.id));
  }
  async delete(row) {
    const children = this.descendants(row), itemIds = children.filter(r => r.itemId).map(r => r.itemId);
    const message = row.itemId ? t('resource.deleteBookMessage')
      : t('resource.deleteFolderMessage', { name: row.name, books: itemIds.length, folders: children.filter(r => !r.itemId).length - 1 });
    await this.resourceDialog(row.itemId ? t('resource.deleteBook') : t('resource.deleteFolder'), panel => {
      panel.add(new ReadonlyText({ text: row.itemId ? message : `${message}\n${t('resource.deleteDetails')}`, width: '100%' }));
    }, { accept: async () => {
      await this.beforeDelete?.(itemIds);
      try { await this.invoke('delete_library_resource', { itemId: row.itemId ?? null, folderId: row.folderId ?? null }); }
      finally { this.setClipboard(null); await this.refresh(); }
      for (const id of itemIds) this.thumbnails.delete(String(id));
    } });
  }
  async properties(row) {
    const item = row.itemId && this.snapshot.items.find(i => i.id === row.itemId);
    const warnings = item ? await this.invoke('library_import_warnings', { itemId: item.id }) : [];
    const fields = item ? [[t('resource.name'), item.title || item.originalName], [t('resource.format'), (item.format ?? '').toUpperCase()],
      [t('resource.size'), t('resource.bytes', { bytes: Number(item.byteLength).toLocaleString('en-US'), mib: (item.byteLength / 1048576).toFixed(2) })], [t('resource.pages'), item.pageCount]]
      : [[t('resource.name'), row.name], [t('resource.books'), this.descendants(row).filter(r => r.itemId).length], [t('resource.subfolders'), this.descendants(row).filter(r => !r.itemId).length - 1]];
    await this.resourceDialog(row.itemId ? t('resource.bookProperties') : t('resource.folderProperties'), panel => {
      for (const [label, value] of fields) panel.add(new TextInput({ label, value: String(value), readOnly: true, width: '100%', labelWidth: 112 }));
      if (warnings?.length) panel.add(new ReadonlyText({ text: t('import.warningDetails', { details: warnings.join('\n') }), width: '100%', css: 'import-warnings' }));
    }, { acceptText: t('common.ok') });
  }

  canExecute(command, { item, parentId, clipboard }) {
    if (this.busy) return false;
    if (command === 'open') return !!item;
    if (command === 'newFolder') return parentId === 'mylib' || String(parentId).startsWith('folder:');
    if (command === 'rename') return !!item && (!item.system || item.id === 'mylib');
    if (['delete', 'cut', 'properties'].includes(command)) return !!item && !item.system;
    if (command === 'paste') return this.canPaste(item, clipboard);
    return command === 'refresh';
  }
  async execute(request) {
    const { command, id, parentId, name, signal } = request;
    const row = this.tree.getResources().find(row => row.id === id);
    const parent = this.tree.getResources().find(row => row.id === parentId);
    let selectId = id;
    if (command === 'open') { if (row?.itemId) await this.onOpen(row.itemId); return null; }
    if (command === 'create') {
      if (!parent || parent.id === 'new' || request.kind !== 'folder') throw Error(t('error.parent'));
      selectId = `folder:${await this.invoke('create_library_folder', { parentId: parent.folderId ?? null, name })}`;
    } else if (command === 'rename' || command === 'delete') {
      if (!row || (row.system && !(command === 'rename' && row.id === 'mylib'))) throw Error('System roots are protected.');
      if (command === 'delete') throw Error('Deletion requires the confirmation dialog.');
      await this.invoke(row.id === 'mylib' ? 'rename_library_root' : row.itemId ? 'rename_library_item' : 'rename_library_folder', { itemId: row.itemId, folderId: row.folderId, name });
    } else if (command === 'move') {
      const source = this.tree.getResources().find(row => row.id === request.clipboard?.id);
      if (!source || !this.canPaste(parent, { id: source.id })) throw Error(t('error.destination'));
      if (source.itemId) await this.invoke('move_library_item', { itemId: source.itemId, ...moveTarget(parent) });
      else await this.invoke('move_library_folder', { folderId: source.folderId, parentId: parent.folderId ?? null });
      this.clipboard = null; selectId = source.id;
    } else if (command !== 'refresh') throw Error('Unsupported Library operation.');
    const snapshot = await this.invoke('list_library');
    if (signal.aborted || this.destroyed) { if (!this.destroyed) void this.refresh(); return null; }
    this.snapshot = snapshot; this.updateRecent();
    return { items: this.resources(snapshot), selectId };
  }
  updateProgress(itemId, pageIndex) {
    if (this.destroyed) return;
    const id = `book:${itemId}`, row = this.tree.grid.data.get(id); if (!row) return;
    const next = { pageIndex, pageCount: row.pageCount, completed: row.completed };
    const patch = { pageIndex, completed: isCompleted(next), progress: progressPercent(next) };
    const item = this.snapshot.items.find(item => item.id === itemId);
    if (item) Object.assign(item, { pageIndex, completed: patch.completed });
    this.tree.grid.data.update(id, patch);
    if (this.recent.data.get(id)) this.recent.data.update(id, patch);
  }
  async showImport() {
    if (this.destroyed || this.dialog) return;
    const guided = this.tutorialEnabled !== false && this.snapshot?.items.length === 0;
    const panel = new Panel({ width: '100%', css: 'import-content' });
    const warnings = new ReadonlyText({ text: '', role: 'status', width: '100%', css: 'import-warnings' });
    const warningMessages = [];
    // Native stages belong to each queue row, above that file's progressbar.
    // The isolated adapter documents the pinned DOM exception; queue state and
    // transport still flow only through FileUpload's public API.
    let stages;
    let synchronizeClose = () => {};
    const upload = new FileUpload({ translate: denseText, name: 'importBook', label: t('import.queue'), width: '100%', height: '100%',
      dropText: t('import.drop'), maxFiles: 100, maxFileSize: MAX_SOURCE_BYTES,
      concurrency: 1, autoUpload: true,
      upload: (file, { signal, onProgress, entry }) => {
        this.importJobs = (this.importJobs ?? 0) + 1; this.busy = true; synchronizeClose();
        const attempt = stages.begin(entry.id);
        // A closed dialog may still be finishing native publication. Share the
        // serialization tail across dialog instances, not just queue rows.
        const job = (this.importTail ?? Promise.resolve()).then(async () => {
          signal.throwIfAborted();
          try {
            const stage = value => {
              if (upload.destroyed || signal.aborted) return;
              stages.update(attempt, value, t('import.' + value));
            };
            const listen = window.__TAURI__?.event?.listen;
            const result = await uploadFile(file, this.invoke, this.binary, stage, signal, onProgress, listen);
            if (result.warnings?.length && !warnings.destroyed && !signal.aborted) {
              warningMessages.push(`${file.name}: ${result.warnings.join('; ')}`);
              warnings.setText(t('import.warnings', { details: warningMessages.join('\n') })); warnings.show();
            }
            await this.imported(result); return result;
          } finally {
            // Native publication can commit after cancellation was requested.
            if (signal.aborted && !this.destroyed) await this.refresh().catch(error => this.tell(error));
          }
        });
        this.importTail = job.catch(() => {});
        return job.finally(() => { this.importJobs--; this.busy = this.importJobs > 0; stages.clear(attempt); synchronizeClose(); });
      } });
    stages = new ImportStageAdapter(upload);
    const closeButton = new Button({ text: t('common.close'), onClick: () => dialog.close('close') });
    const dialog = new Dialog({ translate: denseText, title: t('import.title'), width: 560, className: 'import-books-dialog',
      content: panel, destroyContent: true, buttons: [closeButton] });
    dialog.disposables.add(() => closeButton.destroy());
    dialog.disposables.add(() => stages.dispose());
    const intakeBusy = () => (this.importJobs ?? 0) > 0 || upload.getEntries().some(entry => ['queued', 'uploading'].includes(entry.status));
    synchronizeClose = () => {
      if (dialog.destroyed) return;
      const busy = intakeBusy();
      closeButton[busy ? 'disable' : 'enable']();
      const entries = upload.getEntries();
      dialog.element?.classList.toggle('reader-guide-close', guided && !busy && entries.some(entry => entry.status === 'uploaded'));
    };
    dialog.events.on('beforeClose', event => { if (intakeBusy()) event.cancel = true; });
    this.dialog = dialog;
    this.onEmptyChange?.(false);
    dialog.open(); panel.add(upload); panel.add(warnings); warnings.hide(); dialog.reposition();
    dialog.element.classList.toggle('reader-guide-drop', guided);
    dialog.disposables.add(upload.events.on('beforeAdd', () => {
      dialog.element.classList.remove('reader-guide-drop', 'reader-guide-close');
    }));
    dialog.disposables.add(upload.events.on('uploadStart', () => dialog.element.classList.remove('reader-guide-close')));
    for (const event of ['uploadSuccess', 'uploadError', 'cancel']) dialog.disposables.add(upload.events.on(event, ({ entry, id }) => stages.settle(entry?.id ?? id)));
    for (const event of ['add', 'remove', 'uploadStart', 'uploadSuccess', 'uploadError', 'cancel', 'complete']) {
      dialog.disposables.add(upload.events.on(event, synchronizeClose));
    }
    synchronizeClose();
    const sizeObserver = new ResizeObserver(() => dialog.reposition());
    sizeObserver.observe(dialog.element); dialog.disposables.add(() => sizeObserver.disconnect());
    dialog.events.on('close', () => {
      upload.cancel();
      if (this.dialog === dialog) this.dialog = null;
      this.onEmptyChange?.(this.snapshot?.items.length === 0);
      this.busy = (this.importJobs ?? 0) > 0;
      queueMicrotask(() => dialog.destroy());
    });
  }
  async importWithHistory() {
    if (this.busy || this.dialog || this.destroyed) return;
    this.busy = true;
    try {
      const result = await this.invoke('import_from_dialog');
      if (result && !this.destroyed) { await this.imported(result); await this.onOpen(result.preferredItemId ?? result.item.id); }
    } catch (error) { this.tell(error); }
    finally { this.busy = (this.importJobs ?? 0) > 0; }
  }
  async imported(result) {
    if (!this.destroyed) await this.refresh(`book:${result.preferredItemId ?? result.item.id}`);
  }
  renderProgress(row) {
    if (!row.itemId) return '';
    const progress = document.createElement('progress');
    progress.className = 'book-progress'; progress.max = 100; progress.value = row.progress;
    progress.setAttribute('aria-label', t('reader.progress'));
    return progress;
  }
  renderBook(row) {
    const root = document.createElement('span'); root.className = 'book-row'; root.dataset.libraryId = row.id; root.title = row.name;
    if (row.cutPending) { root.dataset.cutPending = 'true'; root.title = t('resource.cutHint', { name: row.name }); }
    if (row.itemId) {
      const canvas = document.createElement('canvas'); canvas.className = 'book-thumbnail'; canvas.width = 64; canvas.height = 88;
      canvas.dataset.itemId = row.itemId; canvas.setAttribute('aria-hidden', 'true'); root.append(canvas);
      const cached = this.thumbnails.get(String(row.itemId));
      if (cached) this.paintThumbnail(canvas, cached); else {
        this.observer.observe(canvas); this.observed.add(canvas);
        if (!this.pruneScheduled) {
          this.pruneScheduled = true;
          queueMicrotask(() => {
            this.pruneScheduled = false;
            for (const node of this.observed) if (!node.isConnected) { this.observer.unobserve(node); this.observed.delete(node); }
          });
        }
      }
    }
    const text = document.createElement('span'); text.textContent = row.name; root.append(text); return root;
  }
  requestThumbnail(id) {
    if (this.thumbnails.has(id) || this.thumbPending.has(id) || this.destroyed) return;
    this.thumbPending.add(id); this.thumbQueue.push(id); void this.drainThumbnails();
  }
  async drainThumbnails() {
    if (this.thumbBusy) return;
    this.thumbBusy = true;
    while (this.thumbQueue.length && !this.destroyed) {
      const id = this.thumbQueue.shift();
      try {
        const bytes = await this.invoke('library_thumbnail', { itemId: Number(id) });
        if (this.destroyed) break;
        const buffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
        const header = new DataView(buffer), width = header.getUint32(0, true), height = header.getUint32(4, true);
        if (!width || !height || width > 64 || height > 88 || buffer.byteLength !== 8 + width * height * 4) throw Error('Invalid thumbnail');
        const image = new ImageData(new Uint8ClampedArray(buffer, 8), width, height);
        this.thumbnails.set(id, image);
        if (this.thumbnails.size > 64) this.thumbnails.delete(this.thumbnails.keys().next().value);
        for (const canvas of this.owner.element.querySelectorAll(`canvas[data-item-id="${id}"]`)) this.paintThumbnail(canvas, image);
      } catch { /* A damaged first page must not make the Library unusable. */ }
      this.thumbPending.delete(id);
    }
    this.thumbBusy = false;
  }
  paintThumbnail(canvas, image) { canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').putImageData(image, 0, 0); }
}
