import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpreadRenderer } from '../frontend/spread-renderer.js';
import { viewGeometry } from '../frontend/reader-spread.js';

const canvases = [];
const bitmap = name => ({ name, closes: 0, close() { this.closes++; } });
globalThis.OffscreenCanvas = class {
  constructor(width, height) { Object.assign(this, { width, height, draws: [] }); canvases.push(this); }
  getContext() { return { drawImage: (...args) => this.draws.push(args) }; }
  transferToImageBitmap() { this.output = bitmap('composite'); return this.output; }
};
const geometry = () => viewGeometry(1, 3, 'facing', new Map([[1, { width: 60, height: 100 }], [2, { width: 80, height: 120 }]]));
const request = signal => ({ signal, requestId: 8, targetWidth: 160, targetHeight: 120, zoom: 1, devicePixelRatio: 1 });

test('one atomic spread has distinct page providers, per-page dimensions and closed intermediates', async () => {
  const calls = [], images = [], metrics = [];
  const renderer = createSpreadRenderer(geometry(), pageIndex => async req => {
    calls.push([pageIndex, req.targetWidth, req.targetHeight]);
    const image = bitmap(pageIndex); images.push(image); return { image, owned: true };
  }, data => metrics.push(data));
  const result = await renderer(request(new AbortController().signal));
  assert.deepEqual(calls, [[1, 60, 100], [2, 80, 120]]);
  assert.ok(images.every(image => image.closes === 1));
  assert.equal(result.owned, true); assert.equal(result.image.closes, 0);
  assert.deepEqual(canvases.at(-1).draws.map(([image, x, y]) => [image.name, x, y]), [[1, 0, 0], [2, 64, 0]]);
  assert.equal(canvases.at(-1).width, 0); assert.equal(metrics[0].compositeBytes, 160 * 120 * 4);
});

test('cover/final blanks never create or invoke a page provider', async () => {
  for (const [index, count] of [[0, 3], [1, 2]]) {
    const calls = [];
    const geom = viewGeometry(index, count, 'facing', new Map([[index, { width: 60, height: 100 }]]));
    await createSpreadRenderer(geom, pageIndex => { calls.push(pageIndex); return async () => ({ image: bitmap(pageIndex), owned: true }); })(request(new AbortController().signal));
    assert.deepEqual(calls, [index]);
  }
});

test('obsolete left result is released; its right sibling never starts or publishes', async () => {
  let resolve; const controller = new AbortController(), image = bitmap('stale'); const calls = [];
  const renderer = createSpreadRenderer(geometry(), pageIndex => () => { calls.push(pageIndex); return new Promise(done => { resolve = done; }); });
  const pending = renderer(request(controller.signal));
  controller.abort(); resolve({ image, owned: true });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(calls, [1]); assert.equal(image.closes, 1);
  assert.equal(canvases.at(-1).width, 0); assert.equal(canvases.at(-1).output, undefined);
});

test('failed right page releases resources and cannot publish an incomplete spread', async () => {
  const left = bitmap('left'); let published = false;
  const renderer = createSpreadRenderer(geometry(), pageIndex => async () => {
    if (pageIndex === 2) throw new Error('Bad right page');
    return { image: left, owned: true };
  }, () => { published = true; });
  await assert.rejects(renderer(request(new AbortController().signal)), /Bad right page/);
  assert.equal(left.closes, 1); assert.equal(published, false); assert.equal(canvases.at(-1).width, 0);
});
