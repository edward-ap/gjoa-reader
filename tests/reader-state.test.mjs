import test from 'node:test';
import assert from 'node:assert/strict';
import { ReaderState, pageInputIndex, VIEW_MODES, ZOOM_MODES } from '../frontend/reader-state.js';
import { createProgressWriter } from '../frontend/progress-store.js';

test('reader defaults, restore, and separate view/zoom modes', () => {
  const state = new ReaderState();
  assert.deepEqual([state.viewMode, state.zoomMode, state.pageIndex], ['single', 'fit', 0]);
  state.open({ pageCount: 772 });
  assert.equal(state.pageIndex, 0);
  state.open({ pageCount: 772, initialPageIndex: 386 });
  assert.equal(state.pageIndex, 386);
  state.open({ pageCount: 20, initialPageIndex: 999 });
  assert.equal(state.pageIndex, 19);
  assert.deepEqual(VIEW_MODES, ['single', 'continuous', 'facing']);
  assert.ok(ZOOM_MODES.includes('fit-height'));
});

test('page input uses whole 1-based pages; invalid and empty values never navigate', () => {
  assert.equal(pageInputIndex('1', 772), 0);
  assert.equal(pageInputIndex('772', 772), 771);
  assert.equal(pageInputIndex(' 387 ', 772), 386);
  for (const value of ['', ' ', '0', '-1', '773', '1.2', '1e2', 'bad', '999999999999999999']) {
    assert.equal(pageInputIndex(value, 772), null, value);
  }
});

test('navigation retains fit/manual semantics and opening resets to fit', () => {
  const state = new ReaderState();
  state.open({ pageCount: 100 });
  for (const mode of ['fit', 'fit-width', 'manual']) {
    state.observeViewport({ fitMode: mode, zoom: 1.5 });
    assert.equal(state.navigate(2), true);
    assert.equal(state.zoomMode, mode);
    // Resize observes the viewport's semantic mode, not a new user zoom action.
    state.observeViewport({ fitMode: mode, zoom: mode === 'manual' ? 1.5 : 0.7 });
    assert.equal(state.zoomMode, mode);
    if (mode === 'manual') assert.equal(state.zoom, 1.5);
  }
  assert.equal(state.navigate(-1), false);
  assert.equal(state.pageIndex, 2);
  state.open({ pageCount: 100, initialPageIndex: 49 });
  assert.equal(state.zoomMode, 'fit');
  assert.equal(state.pageIndex, 49);
});

test('progress writes stay ordered; failure does not block later saves or flush', async () => {
  const calls = [], errors = [];
  const writer = createProgressWriter(async (_, args) => {
    calls.push(args.pageIndex);
    if (args.pageIndex === 2) throw new Error('Disk unavailable');
  }, error => errors.push(error.message));
  writer.save(1, 2);
  writer.save(1, 3);
  await writer.flush();
  assert.deepEqual(calls, [2, 3]);
  assert.deepEqual(errors, ['Disk unavailable']);
});
