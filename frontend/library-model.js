import { t, denseText } from './i18n/i18n.js';
export const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
export const CHUNK_BYTES = 1024 * 1024;
export function isCompleted(item) {
  return item.completed === true || (Number.isInteger(item.pageIndex) && item.pageIndex >= 0 &&
    item.pageCount > 0 && item.pageIndex < item.pageCount && (item.pageIndex + 1) * 100 >= item.pageCount * 99);
}
export function progressPercent(item) {
  if (isCompleted(item)) return 100;
  return item.pageIndex == null || !item.pageCount ? 0 : Math.min(100, Math.max(0, (item.pageIndex + 1) / item.pageCount * 100));
}
export function bookRow(item) {
  const title = item.title || item.originalName;
  return { id: `book:${item.id}`, parentId: item.inbox ? null : item.folderId == null ? 'mylib' : `folder:${item.folderId}`,
    kind: 'book', itemId: item.id, label: item.displayName ?? (item.author ? `${item.author} — ${title}` : title),
    progress: progressPercent(item), completed: isCompleted(item), pageIndex: item.pageIndex, pageCount: item.pageCount, addedAt: item.addedAt };
}
export function libraryRows({ items, folders, myLibName }) {
  const rows = folders.map(folder => ({ id: `folder:${folder.id}`, parentId: folder.parentId == null ? 'mylib' : `folder:${folder.parentId}`, kind: 'folder', folderId: folder.id, label: folder.name }));
  rows.push(...items.map(bookRow));
  const inbox = rows.filter(row => row.parentId == null).sort((a, b) => b.addedAt - a.addedAt || b.itemId - a.itemId);
  const filed = rows.filter(row => row.parentId != null).sort((a, b) => a.parentId.localeCompare(b.parentId)
    || (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return [...inbox, { id: 'mylib', parentId: null, kind: 'root', label: myLibName ?? 'MyLib' }, ...filed];
}
export function moveTarget(row) {
  if (row?.id === 'mylib') return { folderId: null, inbox: false };
  if (row?.kind === 'folder') return { folderId: row.folderId, inbox: false };
  throw new Error(t('error.dropTarget'));
}
export async function uploadFile(file, invoke, binary, report = () => {}, signal, onProgress = () => {}, listen) {
  if (!file || file.size < 1 || file.size > MAX_SOURCE_BYTES) throw new Error(t('error.fileSize'));
  let uploadId, unlisten;
  let cancellation;
  const cancel = () => {
    if (uploadId != null) cancellation ??= invoke('cancel_import', { uploadId }).catch(() => {});
    return cancellation;
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    report('Reading');
    uploadId = await invoke('begin_import', { name: file.name, size: file.size });
    signal?.throwIfAborted();
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      signal?.throwIfAborted();
      await binary(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer(), uploadId);
      onProgress(Math.min(file.size, offset + CHUNK_BYTES) / file.size * .9);

    }
    if (listen) unlisten = await listen('library-import-stage', ({ payload }) => {
      if (!signal?.aborted && payload?.uploadId === uploadId && ['Processing', 'Saving'].includes(payload.stage)) report(payload.stage);
    });
    report('Processing');
    signal?.throwIfAborted();
    const result = await invoke('finish_import', { uploadId });
    signal?.throwIfAborted();
    onProgress(1);
    return result;
  } catch (error) {
    await cancel();
    throw error;
  } finally { signal?.removeEventListener('abort', cancel); unlisten?.(); }
}
