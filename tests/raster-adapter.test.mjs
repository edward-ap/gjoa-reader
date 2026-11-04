import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageRenderer } from '../frontend/raster-adapter.js';

globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
globalThis.createImageBitmap = async pixels => ({ pixels, closed: false, close() { this.closed = true; } });
const request = signal => ({ signal, targetWidth: 2, targetHeight: 3 });

test('binary adapter captures identity and transfers fresh bitmap ownership', async () => {
  const identity = { documentId: 7, pageIndex: 2 };
  const calls = [];
  const renderer = createPageRenderer(async (...args) => { calls.push(args); return new ArrayBuffer(24); }, identity);
  identity.pageIndex = 9;
  const result = await renderer(request(new AbortController().signal));
  assert.equal(result.owned, true);
  assert.equal(result.image.pixels.data.byteLength, 24);
  assert.deepEqual(calls[0], ['render_page', { documentId: 7, pageIndex: 2, targetWidth: 2, targetHeight: 3, appearance: 'original' }]);
});

test('rejects JSON byte arrays and incorrect RGBA lengths', async () => {
  for (const value of [[1, 2, 3], new ArrayBuffer(20)]) {
    await assert.rejects(createPageRenderer(async () => value, {})(request(new AbortController().signal)), /Invalid binary/);
  }
});

test('aborted requests do not start native work; stale native results are rejected', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(createPageRenderer(async () => { called = true; }, {})(request(controller.signal)), { name: 'AbortError' });
  assert.equal(called, false);
  const during = new AbortController();
  await assert.rejects(createPageRenderer(async () => { during.abort(); return new ArrayBuffer(24); }, {})(request(during.signal)), { name: 'AbortError' });
});

test('queued superseded request is skipped and later work still succeeds', async () => {
  let release;
  const first = createPageRenderer(() => new Promise(resolve => { release = resolve; }), {})(request(new AbortController().signal));
  await new Promise(resolve => setImmediate(resolve));
  const obsolete = new AbortController();
  let called = false;
  const second = createPageRenderer(async () => { called = true; return new ArrayBuffer(24); }, {})(request(obsolete.signal));
  obsolete.abort();
  release(new ArrayBuffer(24));
  await first;
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(called, false);
});

test('bitmap completed after cancellation is closed', async () => {
  const controller = new AbortController();
  const original = globalThis.createImageBitmap;
  const bitmap = { closed: false, close() { this.closed = true; } };
  globalThis.createImageBitmap = async () => { controller.abort(); return bitmap; };
  try {
    await assert.rejects(createPageRenderer(async () => new ArrayBuffer(24), {})(request(controller.signal)), { name: 'AbortError' });
    assert.equal(bitmap.closed, true);
  } finally { globalThis.createImageBitmap = original; }
});
