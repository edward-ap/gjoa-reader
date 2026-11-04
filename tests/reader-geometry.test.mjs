import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollGeometry, scrollToPan, panToScroll } from '../frontend/reader-geometry.js';

test('small/Fit page centered without unnecessary scrollbar ranges', () => {
  const geometry = scrollGeometry({ width: 600, height: 800 }, 1, { width: 1000, height: 800 });
  assert.deepEqual([geometry.planeWidth, geometry.planeHeight, geometry.maxX, geometry.maxY], [1000, 800, 0, 0]);
  assert.deepEqual(scrollToPan(geometry, 50, 10), { x: 200, y: 0 });
  assert.deepEqual(panToScroll(geometry, { x: 200, y: 0 }), { left: 0, top: 0 });
});
test('fit-width and manual ranges reflect full zoomed page, not raster caps', () => {
  const page = { width: 1600, height: 2400 };
  const visible = { width: 800, height: 600 };
  const fitWidth = scrollGeometry(page, 0.5, visible);
  assert.deepEqual([fitWidth.maxX, fitWidth.maxY], [0, 600]);
  const manual = scrollGeometry(page, 2, visible);
  assert.deepEqual([manual.planeWidth, manual.planeHeight, manual.maxX, manual.maxY], [3200, 4800, 2400, 4200]);
  assert.deepEqual(scrollToPan(manual, 200, 300), { x: -200, y: -300 });
  assert.deepEqual(panToScroll(manual, { x: -200, y: -300 }), { left: 200, top: 300 });
  assert.deepEqual(scrollToPan(manual, 10000, -200), { x: -2400, y: 0 });
});
test('resize and zero-size initialization give finite clamped geometry', () => {
  const page = { width: 1600, height: 2400 };
  const enlarged = scrollGeometry(page, 0.5, { width: 900, height: 1000 });
  assert.deepEqual(scrollToPan(enlarged, 0, 1000), { x: 50, y: -200 });
  const empty = scrollGeometry({ width: 0, height: 0 }, 1, { width: 0, height: 0 });
  assert.equal(empty.maxX, 0);
  assert.equal(empty.maxY, 0);
  assert.equal(scrollGeometry({ width: 800.000001, height: 600 }, 1, { width: 800, height: 600 }).planeWidth, 800);
});
