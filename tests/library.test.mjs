import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryRows, progressPercent, moveTarget, uploadFile, MAX_SOURCE_BYTES, CHUNK_BYTES } from '../frontend/library-model.js';

test('abort signals native cancellation while publication is still pending', async () => {
  const controller = new AbortController();
  let finish, started;
  const processing = new Promise(resolve => { started = resolve; });
  const calls = [];
  const invoke = async command => {
    calls.push(command);
    if (command === 'begin_import') return 42;
    if (command === 'finish_import') { started(); return new Promise(resolve => { finish = resolve; }); }
  };
  const job = uploadFile(new File(['text'], 'book.fb2'), invoke, async()=>{}, undefined, controller.signal);
  await processing;
  controller.abort();
  assert.equal(calls.at(-1), 'cancel_import');
  finish({item:{id:1}});
  await assert.rejects(job, { name: 'AbortError' });
  assert.equal(calls.filter(c=>c==='cancel_import').length, 1);
});
test('import stages follow native session events and unsubscribe on completion or failure', async () => {
  for (const fails of [false, true]) {
    const stages = []; let handler, stopped = 0;
    const listen = async (name, callback) => { assert.equal(name, 'library-import-stage'); handler = callback; return () => stopped++; };
    const invoke = async command => {
      if (command === 'begin_import') return 13;
      if (command === 'finish_import') {
        handler({payload:{uploadId:99,stage:'Saving'}});
        assert.deepEqual(stages,['Reading','Processing']);
        handler({payload:{uploadId:13,stage:'Saving'}});
        if (fails) throw Error('disk failed');
        return {item:{id:1}};
      }
    };
    const result = uploadFile(new File(['text'],'book.fb2'),invoke,async()=>{},stage=>stages.push(stage),undefined,()=>{},listen);
    if (fails) await assert.rejects(result,/disk failed/); else await result;
    assert.deepEqual(stages,['Reading','Processing','Saving']); assert.equal(stopped,1);
  }
});
test('Library hierarchy, deterministic placement, labels and progress', () => {
  const rows = libraryRows({ folders: [{ id: 1, parentId: null, name: 'SF' }, { id: 2, parentId: 1, name: 'Classic' }],
    items: [{ id: 1, title: 'Title', author: 'Author', pageIndex: 49, pageCount: 100, folderId: 2, inbox: false },
      { id: 2, originalName: 'new.djvu', pageIndex: null, pageCount: 10, inbox: true, addedAt: 5 }] });
  assert.deepEqual(rows.slice(0, 2).map(r => r.id), ['book:2', 'mylib']);
  assert.equal(rows.find(r => r.id === 'folder:2').parentId, 'folder:1');
  const book = rows.find(r => r.id === 'book:1');
  assert.equal(book.parentId, 'folder:2'); assert.equal(book.label, 'Author — Title'); assert.equal(book.progress, 50);
  assert.equal(rows.find(r => r.id === 'book:2').parentId, null);
  assert.equal(progressPercent({ pageCount: 10, pageIndex: null }), 0);
  assert.equal(progressPercent({ pageCount: 10, pageIndex: 9 }), 100);
  assert.throws(() => moveTarget(rows[0]));
  assert.deepEqual(moveTarget(rows[1]), { folderId: null, inbox: false });
  assert.deepEqual(moveTarget(rows.find(r => r.id === 'folder:2')), { folderId: 2, inbox: false });
  assert.throws(() => moveTarget(book));
});
test('bounded binary upload, rejection before reading and failure cancellation', async () => {
  const calls = [], chunks = [];
  const invoke = async (command, args) => { calls.push([command, args]); return command === 'begin_import' ? 7 : { item: { id: 1 } }; };
  await uploadFile(new File([new Uint8Array(CHUNK_BYTES + 15)], 'book.djvu'), invoke, async (bytes, id) => chunks.push([bytes.byteLength, id]));
  assert.deepEqual(chunks, [[CHUNK_BYTES, 7], [15, 7]]);
  assert.deepEqual(calls.map(c => c[0]), ['begin_import', 'finish_import']);
  await assert.rejects(uploadFile({ size: MAX_SOURCE_BYTES + 1, slice() { assert.fail('must not read oversized input'); } }, invoke, () => {}));
  await assert.rejects(uploadFile(new File(['x'], 'broken.djvu'), invoke, async () => { throw Error('IPC failed'); }), /IPC failed/);
  assert.equal(calls.at(-1)[0], 'cancel_import');
});
