import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
export async function fixture(run, viewport = { width: 1100, height: 850 }, { emptyLibrary = false } = {}) {
  const root = resolve('dist');
  const server = createServer(async (request, response) => {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try { response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await readFile(path)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(({ emptyLibrary }) => {
      window.calls = []; window.snapshot = { items: emptyLibrary ? [] : Array.from({ length: 7 }, (_, i) => ({ id: i + 1, title: `Book ${i + 1}`, author: 'Author', originalName: 'test.djvu', format: 'djvu', byteLength: 123456, inbox: true, pageCount: 10, pageIndex: null, addedAt: i })), folders: [], recent: [] };
      let documentId = 0, openedId = 0, folderId = 0;
      window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
        calls.push({ command, args });
        if (command === 'read_settings') return JSON.parse(localStorage.getItem('test-settings') ?? 'null');
        if (command === 'save_settings') { localStorage.setItem('test-settings', JSON.stringify(args.settings)); return; }
        if (command === 'read_ui_settings') return JSON.parse(localStorage.getItem('test-ui-settings') ?? 'null');
        if (command === 'save_ui_settings') {
          const settings = { ...(JSON.parse(localStorage.getItem('test-ui-settings') ?? '{}')), ...args };
          localStorage.setItem('test-ui-settings', JSON.stringify(settings)); return;
        }
        if (command === 'list_library') return structuredClone(snapshot);
        if (command === 'restore_last_document') {
          const saved = JSON.parse(localStorage.getItem('test-ui-settings') ?? '{}').lastBook;
          if (!saved) return null;
          if (!snapshot.items.some(item => item.id === saved.itemId)) {
            const settings = JSON.parse(localStorage.getItem('test-ui-settings')); settings.lastBook = null;
            localStorage.setItem('test-ui-settings', JSON.stringify(settings));
            throw Error('Saved book is missing');
          }
          return window.__TAURI__.core.invoke('open_library_item', { itemId: saved.itemId });
        }
        if (command === 'remove_recent_book') { snapshot.recent = snapshot.recent.filter(id => id !== args.itemId); return structuredClone(snapshot); }
        if (command === 'library_thumbnail') { const bytes = new Uint8Array(12); new DataView(bytes.buffer).setUint32(0, 1, true); new DataView(bytes.buffer).setUint32(4, 1, true); bytes.fill(180, 8); return bytes.buffer; }
        if (command === 'open_library_item') {
          openedId = args.itemId; documentId++;
          snapshot.recent = [openedId, ...snapshot.recent.filter(id => id !== openedId)].slice(0, 5);
          const item = snapshot.items.find(item => item.id === openedId);
          return { documentId, libraryItemId: openedId, displayName: item.title, path: '/internal/book', pageCount: 10, initialPageIndex: item.pageIndex ?? 0, initialPage: { width: 800, height: 1120 } };
        }
        if (command === 'get_page_info') return { width: 800, height: 1120 };
        if (command === 'read_page_annotations') {
          const key = `edition-${openedId}`, notes = JSON.parse(localStorage.getItem('test-annotations') ?? '{}');
          return { key, document: notes[`${key}:${args.pageIndex}`] ?? null };
        }
        if (command === 'save_page_annotations') {
          const notes = JSON.parse(localStorage.getItem('test-annotations') ?? '{}');
          notes[`${args.key}:${args.pageIndex}`] = args.document;
          localStorage.setItem('test-annotations', JSON.stringify(notes)); return;
        }
        if (command === 'render_page') return new Uint8Array(args.targetWidth * args.targetHeight * 4).fill(245).buffer;
        if (command === 'save_book_progress') {
          const item = snapshot.items.find(item => item.id === openedId);
          item.pageIndex = args.pageIndex;
          item.completed = item.completed === true || (args.pageIndex + 1) * 100 >= item.pageCount * 99;
          return;
        }
        if (command === 'create_library_folder') { const id = ++folderId; snapshot.folders.push({ id, parentId: args.parentId, name: args.name }); return id; }
        if (command === 'rename_library_root') snapshot.myLibName = args.name;
        if (command === 'rename_library_item') Object.assign(snapshot.items.find(item => item.id === args.itemId), {title:args.name, displayName:args.name});
        if (command === 'move_library_folder') snapshot.folders.find(item => item.id === args.folderId).parentId = args.parentId;
        if (command === 'delete_library_resource') {
          const folders = new Set(args.folderId == null ? [] : [args.folderId]);
          let changed = true;
          while (changed) { changed = false; for (const f of snapshot.folders) if (folders.has(f.parentId) && !folders.has(f.id)) { folders.add(f.id); changed = true; } }
          const deleted = snapshot.items.filter(i => i.id === args.itemId || folders.has(i.folderId)).map(i => i.id);
          snapshot.items = snapshot.items.filter(i => !deleted.includes(i.id));
          snapshot.recent = snapshot.recent.filter(id => !deleted.includes(id));
          snapshot.folders = snapshot.folders.filter(f => !folders.has(f.id));
          return structuredClone(snapshot);
        }
        if (command === 'rename_library_folder') snapshot.folders.find(item => item.id === args.folderId).name = args.name;
        if (command === 'delete_library_folder') snapshot.folders = snapshot.folders.filter(item => item.id !== args.folderId);
        if (command === 'move_library_item') Object.assign(snapshot.items.find(item => item.id === args.itemId), args);
        if (command === 'begin_import') return 1;
        if (command === 'finish_import') return { item: snapshot.items[0], duplicate: true };
      } } };
    }, { emptyLibrary });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await run(page);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
