import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';

test('continuous shell: smooth wheel, bounded reuse, reverse, jump, zoom and mode transitions', { timeout: 60000 }, async () => {
  await fixture(async page => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick();
    await page.getByRole('button', { name: 'Continuous Pages', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Page number', exact: true });
    const ready = () => page.waitForFunction(() => {
      const el = document.querySelector('.reader-continuous');
      return el?.dataset.pageWindow && JSON.parse(el.dataset.pageWindow).every(p => p.status === 'ready') &&
        document.querySelector('.reader-view-host').dataset.renderStatus === 'ready';
    });
    const windowPages = () => page.locator('.reader-continuous').evaluate(el => JSON.parse(el.dataset.pageWindow).map(p => p.pageIndex).sort((a,b) => a-b));
    await ready(); assert.deepEqual(await windowPages(), [0, 1]);
    await input.fill('5'); await input.press('Enter'); await ready();
    assert.deepEqual(await windowPages(), [3, 4, 5]);
    const count = () => page.evaluate(() => calls.filter(c => c.command === 'render_page').length);
    const before = await count();
    const surface = page.locator('.reader-continuous .reader-surface');
    const rect = await surface.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(0, 100); await page.waitForTimeout(150);
    await expect(input).toHaveValue('5'); assert.equal(await count(), before);
    await page.mouse.wheel(0, rect.height * .5); await expect(input).toHaveValue('6'); await ready();
    assert.deepEqual(await windowPages(), [4, 5, 6]); assert.equal(await count(), before + 1);
    await page.mouse.wheel(0, -rect.height * .5); await expect(input).toHaveValue('5'); await ready();
    assert.deepEqual(await windowPages(), [3, 4, 5]); assert.equal(await count(), before + 2);
    await expect.poll(() => page.evaluate(() => snapshot.items[0].pageIndex)).toBe(4);
    await page.getByRole('button', { name: 'Facing Pages', exact: true }).click();
    await expect(input).toHaveValue('5');
    await page.getByRole('button', { name: 'Single Page', exact: true }).click();
    await expect(input).toHaveValue('5');
    await page.getByRole('button', { name: 'Continuous Pages', exact: true }).click(); await ready();
    const zoom = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
    await zoom.fill('150%'); await zoom.press('Enter'); await ready();
    await page.setViewportSize({ width: 900, height: 700 }); await ready();
    await input.fill('10'); await input.press('Enter'); await ready(); assert.deepEqual(await windowPages(), [8, 9]);
    await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
    await input.fill('1'); await input.press('Enter'); await ready(); assert.deepEqual(await windowPages(), [0, 1]);
    assert.deepEqual(errors, []);
  });
});

test('continuous host: pixel continuity, variable geometry, owned eviction and stale metadata', { timeout: 60000 }, async () => {
  await fixture(async page => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(async () => {
      const { ReaderViewHost } = await import('./reader-view-host.js');
      const { Panel } = await import('taet-ui');
      window.owner = new Panel(document.body, { width: 800, height: 600 });
      owner.element.style.cssText += ';position:fixed;inset:0;z-index:9999';
      window.host = new ReaderViewHost(); owner.add(host); window.renders = []; window.images = [];
      window.info = async i => ({ width: i % 2 ? 700 : 800, height: 1200 });
      window.show = async (index, count = 8, doc = 1) => {
        const prepared = await host.prepareView({ documentId: doc, pageIndex: index, pageCount: count, viewMode: 'continuous' }, i => info(i));
        host.showView(prepared, i => async r => {
          renders.push(i); const c = new OffscreenCanvas(r.targetWidth, r.targetHeight);
          const ctx = c.getContext('2d'); ctx.fillStyle = i % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, c.width, c.height);
          const image = c.transferToImageBitmap(); images.push(image); return { image, owned: true };
        });
      };
      await show(3);
    });
    const ready = () => page.waitForFunction(() => host.isCurrentViewReady && !host.continuous.cache.busy);
    await ready();
    const result = await page.evaluate(async () => {
      const c = host.continuous, next = c.slots.find(s => s.pageIndex === 4);
      c.scroller.scrollTop = next.top - c.heightPx * .6;
      await new Promise(r => setTimeout(r, 120));
      const canvas = c.viewport.element.querySelector('canvas'), ctx = canvas.getContext('2d');
      return [ctx.getImageData(350, 100, 1, 1).data, ctx.getImageData(350, 550, 1, 1).data].map(a => Array.from(a));
    });
    assert.deepEqual(result, [[255,0,0,255], [0,0,255,255]]);
    const before = await page.evaluate(() => {
      const c = host.continuous; c.scroller.scrollTop += 100;
      return { offset: c.slots.find(s => s.pageIndex === 4).top - c.scroller.scrollTop, count: renders.length };
    });
    await page.waitForFunction(() => host.currentView.pageIndex === 4); await ready();
    const after = await page.evaluate(() => ({ offset: host.continuous.slots.find(s => s.pageIndex === 4).top - host.continuous.scroller.scrollTop, count: renders.length }));
    assert.ok(Math.abs(after.offset - before.offset) <= 1); assert.equal(after.count, before.count + 1);
    await page.evaluate(() => {
      const original = info;
      window.info = async i => { if (i === 6) await new Promise(r => { window.releaseInfo = r; }); return original(i); };
      const c = host.continuous; c.scroller.scrollTop = c.slots.find(s => s.pageIndex === 5).top;
    });
    await page.waitForFunction(() => typeof releaseInfo === 'function');
    await page.evaluate(async () => { await show(0, 1, 2); releaseInfo(); }); await ready();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => host.currentView.documentId), 2);
    assert.equal(await page.evaluate(() => host.currentView.pageIndex), 0);
    assert.deepEqual(await page.evaluate(() => host.continuous.cache.diagnostics.map(e => e.pageIndex)), [0]);
    await page.evaluate(() => host.setZoom(8)); await ready();
    assert.ok(await page.evaluate(() => host.continuous.cache.diagnostics.every(e => e.width * e.height <= 4 * 1024 * 1024)));
    await page.evaluate(() => owner.destroy());
    assert.ok(await page.evaluate(() => images.every(i => i.width === 0)));
    assert.deepEqual(errors, []);
  });
});
