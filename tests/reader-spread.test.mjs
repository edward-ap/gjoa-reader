import test from 'node:test';
import assert from 'node:assert/strict';
import { spreadForPage, adjacentSpreadPage, visiblePages, viewGeometry, pageRasterTargets, FACING_PAGE_GAP } from '../frontend/reader-spread.js';
import { ReaderState } from '../frontend/reader-state.js';

test('Western pairs preserve exact anchors, cover and odd/even final spreads', () => {
  for (const [page, expected] of [[0, [null, 0]], [1, [1, 2]], [2, [1, 2]], [3, [3, 4]], [771, [771, null]]]) {
    const spread = spreadForPage(page, 772);
    assert.deepEqual([spread.leftPageIndex, spread.rightPageIndex], expected);
    assert.equal(spread.anchorPageIndex, page);
  }
  assert.deepEqual(visiblePages(770, 771, 'facing'), [769, 770]);
  assert.deepEqual(visiblePages(0, 1, 'facing'), [0]);
  assert.deepEqual(visiblePages(1, 2, 'facing'), [1]);
  for (const count of [1, 2, 3, 4, 5, 771, 772]) for (let page = 0; page < count; page++) {
    const spread = spreadForPage(page, count);
    const pages = visiblePages(page, count, 'facing');
    assert.ok(pages.includes(page));
    assert.ok(pages.every(index => index >= 0 && index < count));
    if (spread.leftPageIndex !== null) assert.equal((spread.leftPageIndex + 1) % 2, 0);
    if (spread.rightPageIndex !== null) assert.equal((spread.rightPageIndex + 1) % 2, 1);
  }
});

test('spread stepping chooses the first real page and stops at boundaries', () => {
  assert.equal(adjacentSpreadPage(0, 772, -1), null);
  assert.equal(adjacentSpreadPage(0, 772, 1), 1);
  assert.equal(adjacentSpreadPage(1, 772, 1), 3);
  assert.equal(adjacentSpreadPage(2, 772, 1), 3);
  assert.equal(adjacentSpreadPage(3, 772, -1), 1);
  assert.equal(adjacentSpreadPage(2, 772, -1), 0);
  assert.equal(adjacentSpreadPage(770, 772, 1), 771);
  assert.equal(adjacentSpreadPage(771, 772, 1), null);
  assert.equal(adjacentSpreadPage(770, 771, 1), null);
  for (const args of [[-1, 2], [2, 2], [0, 0], [0.1, 2]]) assert.throws(() => spreadForPage(...args));
  assert.deepEqual(visiblePages(0, 2, 'continuous'), [0]);
});

test('mode switches retain exact page and semantic zoom; spread steps update anchor', () => {
  const state = new ReaderState(); state.open({ pageCount: 772 });
  for (const pageIndex of [0, 1, 2, 99]) for (const zoomMode of ['fit', 'fit-width', 'fit-height', 'manual', 'actual']) {
    state.navigate(pageIndex); state.observeViewport({ fitMode: zoomMode, zoom: 1.5 });
    state.setViewMode('facing');
    assert.ok(visiblePages(state.pageIndex, 772, state.viewMode).includes(pageIndex));
    state.setViewMode('single');
    assert.equal(state.pageIndex, pageIndex); assert.equal(state.zoomMode, zoomMode); assert.equal(state.zoom, 1.5);
  }
  state.navigate(2); state.setViewMode('facing'); state.navigate(state.step(1));
  assert.equal(state.pageIndex, 3); state.navigate(state.step(-1)); assert.equal(state.pageIndex, 1);
  state.setViewMode('continuous');
  assert.equal(state.viewMode, 'continuous');
  assert.equal(state.step(1), 2);
});

test('page-based progress round trip from facing resets to Single and Fit', () => {
  const state = new ReaderState(); state.open({ pageCount: 772 });
  state.setViewMode('facing'); state.navigate(99);
  const saved = JSON.parse(JSON.stringify({ pageIndex: state.pageIndex }));
  const restarted = new ReaderState(); restarted.open({ pageCount: 772, initialPageIndex: saved.pageIndex });
  assert.deepEqual([restarted.pageIndex, restarted.viewMode, restarted.zoomMode], [99, 'single', 'fit']);
  state.setViewMode('single'); assert.equal(state.pageIndex, saved.pageIndex);
});

test('different page sizes share a scale, align tops, and reserve mirrored blank slots', () => {
  const infos = new Map([[0, { width: 800, height: 1200 }], [1, { width: 600, height: 1000 }], [2, { width: 800, height: 1200 }]]);
  const geometry = viewGeometry(2, 3, 'facing', infos);
  assert.equal(geometry.width, 1400 + FACING_PAGE_GAP); assert.equal(geometry.height, 1200);
  assert.deepEqual(geometry.slots.map(slot => [slot.x, slot.y]), [[0, 0], [600 + FACING_PAGE_GAP, 0]]);
  const cover = viewGeometry(0, 3, 'facing', infos);
  assert.equal(cover.width, 1600 + FACING_PAGE_GAP); assert.equal(cover.slots[0].pageIndex, null);
  const end = viewGeometry(1, 2, 'facing', infos);
  assert.equal(end.slots[1].pageIndex, null); assert.equal(end.width, 1200 + FACING_PAGE_GAP);
  assert.equal(end.slots[0].height, end.slots[1].height);
  assert.throws(() => viewGeometry(2, 3, 'facing', new Map()), /Invalid dimensions/);
});

test('DPR/capped spread targets allocate each page at its own size, never render blanks', () => {
  const geometry = viewGeometry(2, 3, 'facing', new Map([[1, { width: 600, height: 1000 }], [2, { width: 800, height: 1200 }]]));
  const targets = pageRasterTargets(geometry, 2106, 1800); // common scale 1.5
  assert.deepEqual(targets.map(t => [t.pageIndex, t.targetWidth, t.targetHeight]), [[1, 900, 1500], [2, 1200, 1800]]);
  assert.equal(targets[1].x, 906);
  const cover = viewGeometry(0, 1, 'facing', new Map([[0, { width: 1600, height: 2400 }]]));
  assert.deepEqual(pageRasterTargets(cover, 805, 600).map(t => t.pageIndex), [0]);
  for (const [w, h] of [[0, 1], [8192, 8192], [8193, 1]]) assert.throws(() => pageRasterTargets(geometry, w, h));
  for (const t of pageRasterTargets(geometry, 4096, 4096)) assert.ok(t.targetWidth * t.targetHeight * 4 <= 67108864);
});
