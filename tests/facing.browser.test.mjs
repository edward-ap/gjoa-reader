import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

async function browserFixture(run) {
  const root = resolve('dist');
  const server = createServer(async (request, response) => {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try { await run(await browser.newPage({ viewport: { width: 1000, height: 900 } }), `http://127.0.0.1:${server.address().port}/index.html`); }
  finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

test('actual host: cover, unequal pages, common zoom, scroll, resize, same-spread anchor and owned bitmaps', { timeout: 40000 }, async () => {
  await browserFixture(async (page, url) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.evaluate(async () => {
      const { ReaderViewHost } = await import('./reader-view-host.js');
      const { Panel } = await import('dense-ui');
      window.owner = new Panel(document.body, { width: 800, height: 600 });
      window.host = new ReaderViewHost(); owner.add(host);
      window.calls = []; window.bitmaps = []; window.changes = 0;
      const transfer = OffscreenCanvas.prototype.transferToImageBitmap;
      OffscreenCanvas.prototype.transferToImageBitmap = function () { const image = transfer.call(this); bitmaps.push(image); return image; };
      host.viewport.events.on('viewportChange', () => changes++);
      window.show = async (pageIndex, mode, pageCount = 5, opening = false) => {
        const prepared = await host.prepareView({ documentId: 1, pageIndex, pageCount, viewMode: mode }, async index =>
          index === 1 ? { width: 600, height: 1000 } : { width: 800, height: 1200 });
        host.showView(prepared, index => async request => {
          calls.push({ pageIndex: index, width: request.targetWidth, height: request.targetHeight });
          const canvas = new OffscreenCanvas(request.targetWidth, request.targetHeight);
          const ctx = canvas.getContext('2d'); ctx.fillStyle = index === 1 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          const image = canvas.transferToImageBitmap(); return { image, owned: true };
        }, { opening });
      };
      await show(0, 'facing', 5, true);
    });
    await page.addStyleTag({ content: 'body > .dui-panel { position:fixed;inset:0; }' });
    const ready = async () => { await page.waitForFunction(() => host.isCurrentViewReady); await page.waitForTimeout(120); };
    const state = () => page.evaluate(() => ({ ...host.getViewState(), calls: calls.length,
      width: host.scroller.clientWidth, height: host.scroller.clientHeight, totalWidth: host.scroller.scrollWidth, totalHeight: host.scroller.scrollHeight }));
    const pixel = point => page.evaluate(([x, y]) => {
      const p = host.viewport.contentToViewport(x, y);
      return Array.from(host.viewport.element.querySelector('canvas').getContext('2d').getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data);
    }, point);
    await ready();
    const cover = await state();
    assert.equal(cover.logicalView.slots[0].pageIndex, null);
    assert.equal(cover.totalWidth, cover.width); assert.equal(cover.totalHeight, cover.height);
    assert.deepEqual(await pixel([400, 600]), [0, 0, 0, 0]);
    assert.deepEqual(await pixel([1220, 600]), [0, 0, 255, 255]);
    assert.ok(await page.evaluate(() => calls.every(call => call.pageIndex === 0)));
    await page.evaluate(() => show(2, 'facing')); await ready();
    let s = await state(); assert.equal(s.pageIndex, 2); assert.equal(s.logicalView.width, 1404);
    assert.deepEqual(await pixel([300, 500]), [255, 0, 0, 255]);
    assert.deepEqual(await pixel([1020, 500]), [0, 0, 255, 255]);
    assert.deepEqual(await pixel([300, 1100]), [0, 0, 0, 0], 'short left page stays top aligned');
    assert.deepEqual(await pixel([602, 500]), [0, 0, 0, 0], 'narrow gutter reveals the dark viewport background');
    const callsBeforeAnchor = s.calls;
    await page.evaluate(() => show(1, 'facing')); await ready();
    assert.equal((await state()).calls, callsBeforeAnchor, 'changing anchor within same spread reuses accepted pixels');
    await page.evaluate(() => show(2, 'single')); await ready(); assert.equal((await state()).pageIndex, 2);
    await page.evaluate(() => show(2, 'facing')); await ready();
    await page.evaluate(() => host.fit('fit-width')); await ready();
    s = await state(); assert.equal(s.fitMode, 'fit-width'); assert.equal(s.totalWidth, s.width); assert.ok(s.totalHeight > s.height);
    await page.evaluate(() => owner.setSize(700, 450)); await ready(); assert.equal((await state()).fitMode, 'fit-width');
    await page.evaluate(() => host.viewport.setZoom(1.5)); await ready();
    s = await state(); assert.equal(s.totalWidth, 2106); assert.equal(s.totalHeight, 1800);
    const beforePan = s.calls;
    await page.evaluate(() => { host.scroller.scrollLeft = 140; host.scroller.scrollTop = 250; });
    await page.waitForTimeout(100); assert.deepEqual((await state()).pan, { x: -140, y: -250 });
    await page.evaluate(() => host.viewport.panTo(-200, -330)); await page.waitForTimeout(100);
    assert.deepEqual((await state()).scroll, { left: 200, top: 330 }); assert.equal((await state()).calls, beforePan);
    await page.evaluate(() => owner.setSize(850, 700)); await ready();
    assert.equal((await state()).zoom, 1.5); assert.equal((await state()).fitMode, 'manual');
    await page.evaluate(() => show(3, 'facing', 4)); await ready();
    s = await state(); assert.equal(s.logicalView.slots[1].pageIndex, null); assert.equal(s.zoom, 1.5); assert.equal(s.scroll.top, 0);
    assert.equal(s.renderMetrics.pages.length, 1);
    await page.evaluate(() => host.fit('fit')); await ready();
    await page.evaluate(() => owner.setSize(760, 550)); await ready();
    s = await state(); assert.equal(s.fitMode, 'fit'); assert.equal(s.totalWidth, s.width); assert.equal(s.totalHeight, s.height);
    assert.ok(await page.evaluate(() => changes < 60), 'no layout/render loop');
    await page.evaluate(() => owner.destroy());
    assert.ok(await page.evaluate(() => host.viewport.destroyed && bitmaps.every(image => image.width === 0)), 'all owned page images released');
    assert.deepEqual(errors, []);
  });
});

test('actual controller: atomic facing progress, failed sibling, rapid mode/book changes and exact anchor', { timeout: 40000 }, async () => {
  await browserFixture(async (page, url) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.saved = []; window.requests = []; window.waiting = []; window.block = []; window.fail = []; window.bookId = 0;
      const metadata = index => ({ width: index % 2 ? 180 : 200, height: 300, dpi: 96 });
      window.__TAURI__ = { core: { invoke: async (command, args) => {
        if (command === 'list_library') return { items: [{ id: 1, title: 'Fixture', inbox: true, pageCount: 8, addedAt: 1 }], folders: [], recent: [] };
        if (command === 'open_library_item') return { documentId: ++bookId, path: `test-${bookId}.djvu`, pageCount: 8, initialPageIndex: 2, initialPage: metadata(2) };
        if (command === 'get_page_info') return metadata(args.pageIndex);
        if (command === 'save_book_progress') { saved.push(args); return; }
        if (command === 'render_page') {
          requests.push(args);
          if (block.includes(args.pageIndex)) await new Promise(resolve => waiting.push({ pageIndex: args.pageIndex, resolve }));
          if (fail.includes(args.pageIndex)) throw new Error('Synthetic page failure');
          const pixels = new Uint8Array(args.targetWidth * args.targetHeight * 4); pixels.fill(255); return pixels.buffer;
        }
      } } };
    });
    await page.goto(url);
    const input = page.locator('[data-dui-control-id=pageNumber] input');
    const selector = page.getByRole('button', { name: 'Single Page', exact: true });
    const ready = () => page.waitForFunction(() => document.querySelector('[data-render-status]')?.dataset.renderStatus === 'ready');
    const mode = async label => { await page.getByRole('button', { name: label, exact: true }).click(); };
    const go = async number => { await input.fill(String(number)); await input.press('Enter'); };
    await page.locator('[data-library-id="book:1"]').dblclick(); await ready();
    await expect(selector).toHaveAttribute('aria-pressed', 'true');
    await expect(input).toHaveValue('3');
    await mode('Facing Pages'); await ready();
    await expect(page.locator('.reader-status')).not.toContainText('Pages 2–3');
    await mode('Single Page'); await ready(); await expect(input).toHaveValue('3');
    await mode('Facing Pages'); await ready();
    await page.evaluate(() => { block = [4]; }); await go(5);
    await page.waitForFunction(() => waiting.length > 0);
    assert.ok(await page.evaluate(() => saved.every(item => item.pageIndex !== 4)), 'no progress before right/anchor is displayable');
    await page.evaluate(() => { block = []; waiting.splice(0).forEach(item => item.resolve()); }); await ready();
    await expect.poll(() => page.evaluate(() => saved.at(-1)?.pageIndex)).toBe(4);
    await page.evaluate(() => { fail = [6]; }); await go(7);
    await expect(page.locator('.reader-status')).toContainText('Synthetic page failure');
    assert.equal(await page.evaluate(() => saved.at(-1).pageIndex), 4, 'failed spread cannot advance progress');
    await page.evaluate(() => { fail = []; block = [1]; }); await go(2);
    await page.waitForFunction(() => waiting.length > 0);
    // Replace a pending facing view with a new book. The old native work cannot
    // be cancelled; its eventual completion must not publish pixels/progress.
    await page.locator('[data-library-id="book:1"]').dblclick();
    await expect(input).toHaveValue('3');
    await page.evaluate(() => { block = []; waiting.splice(0).forEach(item => item.resolve()); }); await ready();
    await expect.poll(() => page.evaluate(() => saved.at(-1)?.documentId)).toBe(2);
    assert.ok(await page.evaluate(() => saved.every(item => !(item.documentId === 1 && item.pageIndex === 1))));
    await expect(page.getByRole('button', { name: 'Facing Pages', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.reader-view-host')).toHaveAttribute('data-zoom-mode', 'fit');
    await mode('Facing Pages'); await ready(); await go(2); await ready(); await mode('Single Page'); await ready();
    await expect(input).toHaveValue('2');
    assert.deepEqual(errors, []);
  });
});

test('host discards late facing pixels after mode change/destroy and waits for a nonzero surface', { timeout: 30000 }, async () => {
  await browserFixture(async (page, url) => {
    await page.goto(url);
    await page.evaluate(async () => {
      const { ReaderViewHost } = await import('./reader-view-host.js');
      const { Panel } = await import('dense-ui');
      window.owner = new Panel(document.body, { width: 640, height: 480 });
      window.host = new ReaderViewHost(); owner.add(host);
      window.lateImages = []; window.release = null;
      window.install = async (mode, blocked = false) => {
        const prepared = await host.prepareView({ documentId: 1, pageIndex: 2, pageCount: 5, viewMode: mode }, async () => ({ width: 200, height: 300 }));
        host.showView(prepared, () => async request => {
          if (blocked) await new Promise(resolve => { window.release = resolve; });
          const canvas = new OffscreenCanvas(request.targetWidth, request.targetHeight), ctx = canvas.getContext('2d');
          ctx.fillStyle = blocked ? '#ff0000' : '#00ff00'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          const image = canvas.transferToImageBitmap(); if (blocked) lateImages.push(image);
          return { image, owned: true };
        });
      };
      await install('facing', true);
    });
    await page.addStyleTag({ content: 'body > .dui-panel { position:fixed;inset:0; }' });
    await page.waitForFunction(() => release !== null);
    await page.evaluate(() => install('single'));
    await page.waitForFunction(() => host.isCurrentViewReady);
    await page.evaluate(() => { release(); release = null; });
    await page.waitForFunction(() => lateImages.length === 1 && lateImages[0].width === 0);
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => {
      const p = host.viewport.contentToViewport(100, 150);
      return Array.from(host.viewport.element.querySelector('canvas').getContext('2d').getImageData(p.x, p.y, 1, 1).data);
    }), [0, 255, 0, 255], 'late red facing page cannot overwrite accepted green single page');
    await page.evaluate(() => owner.setSize(0, 0)); await page.waitForTimeout(100);
    await page.evaluate(() => install('facing'));
    assert.equal(await page.evaluate(() => host.isCurrentViewReady), false, 'old ready raster is not progress for a hidden new spread');
    await page.evaluate(() => owner.setSize(640, 480));
    await page.waitForFunction(() => host.isCurrentViewReady);
    await page.evaluate(async () => { await install('single'); });
    await page.waitForFunction(() => host.isCurrentViewReady);
    await page.evaluate(() => install('facing', true));
    await page.waitForFunction(() => release !== null);
    await page.evaluate(() => { owner.destroy(); release(); });
    await page.waitForFunction(() => lateImages.length === 2 && lateImages.every(image => image.width === 0));
    assert.equal(await page.evaluate(() => host.isCurrentViewReady), false);
  });
});
