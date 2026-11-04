import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('real host: fit/resize, native scroll, pan sync, manual scale, lifecycle and no decode on pan', { timeout: 40000 }, async () => {
  const root = resolve('dist');
  const server = createServer(async (request, response) => {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(root)) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    // Do not use the app controller: exercise the actual host with a tiny test raster.
    await page.evaluate(async () => {
      const { ReaderViewHost } = await import('./reader-view-host.js');
      const { Panel } = await import('taet-ui');
      window.testOwner = new Panel(document.body, { width: 800, height: 600 });
      window.testHost = new ReaderViewHost();
      testOwner.add(testHost);
      window.testRenders = 0;
      window.testChanges = 0;
      testHost.viewport.events.on('viewportChange', () => testChanges++);
      testHost.showPage({ width: 1600, height: 2400 }, () => { testRenders++; return { image: new ImageData(16, 24) }; }, { opening: true });
    });
    // The app above occupies a full screen. Test host is a separate fixed overlay.
    await page.addStyleTag({ content: 'body > .dui-panel { position:fixed;inset:0; }' });
    const wait = () => page.waitForFunction(() => testHost.viewport.renderStatus === 'ready');
    const snapshot = () => page.evaluate(() => ({ ...testHost.getViewState(), renders: testRenders, changes: testChanges,
      clientWidth: testHost.scroller.clientWidth, clientHeight: testHost.scroller.clientHeight,
      scrollWidth: testHost.scroller.scrollWidth, scrollHeight: testHost.scroller.scrollHeight }));
    await wait();
    await page.waitForTimeout(150);
    const fit = await snapshot();
    assert.equal(fit.fitMode, 'fit');
    assert.equal(fit.scrollWidth, fit.clientWidth);
    assert.equal(fit.scrollHeight, fit.clientHeight);
    assert.ok(fit.pan.x > 0);
    const assertCentered = async () => {
      const margins = await page.evaluate(() => {
        const host = testHost.element.getBoundingClientRect();
        const surface = testHost.surfaceLayer.getBoundingClientRect();
        const left = surface.left + testHost.viewport.pan.x;
        const right = left + testHost.viewport.contentSize.width * testHost.viewport.zoom;
        return { left: left - host.left, right: host.right - right };
      });
      assert.ok(Math.abs(margins.left - margins.right) <= 1, JSON.stringify(margins));
    };
    await assertCentered();
    await page.evaluate(() => testOwner.setSize(630, 900));
    await wait(); await page.waitForTimeout(150);
    await assertCentered();
    await page.evaluate(() => testOwner.setSize(700, 500));
    await wait();
    await page.waitForTimeout(150);
    assert.equal((await snapshot()).fitMode, 'fit');
    assert.ok((await snapshot()).zoom < fit.zoom);
    await page.evaluate(() => testHost.fit('fit-width'));
    await wait();
    await page.waitForTimeout(200);
    const fitWidth = await snapshot();
    assert.equal(fitWidth.scrollWidth, fitWidth.clientWidth);
    assert.ok(fitWidth.scrollHeight > fitWidth.clientHeight);
    await assertCentered();
    await page.evaluate(() => testHost.viewport.setZoom(1.5));
    await wait();
    await page.waitForTimeout(200);
    const manual = await snapshot();
    assert.equal(manual.zoom, 1.5);
    assert.equal(manual.scrollWidth, 2400);
    assert.equal(manual.scrollHeight, 3600);
    await page.evaluate(() => { testHost.scroller.scrollLeft = 123; testHost.scroller.scrollTop = 234; });
    await page.waitForTimeout(100);
    assert.deepEqual((await snapshot()).pan, { x: -123, y: -234 });
    await page.evaluate(() => testHost.viewport.panTo(-350, -500));
    await page.waitForTimeout(100);
    assert.deepEqual((await snapshot()).scroll, { left: 350, top: 500 });
    assert.equal((await snapshot()).renders, manual.renders, 'pan never requests a raster');
    await page.evaluate(() => testOwner.setSize(850, 700));
    await wait();
    await page.waitForTimeout(200);
    assert.equal((await snapshot()).fitMode, 'manual');
    assert.equal((await snapshot()).zoom, 1.5);
    assert.ok((await snapshot()).changes < 30, 'bounded event count, no feedback loop');
    // A near-square facing spread used to alternate between scrollbar/no scrollbar:
    // the changed client width refit its height across the threshold on every frame.
    await page.evaluate(() => {
      testOwner.setSize(468, 356);
      testHost.showPage({ width: 6128, height: 4755 }, () => { testRenders++; return { image: new ImageData(16, 24) }; }, { opening: true });
      testHost.fit('fit-width');
    });
    await wait(); await page.waitForTimeout(200);
    const threshold = await snapshot();
    assert.equal(threshold.scrollWidth, threshold.clientWidth);
    await page.evaluate(() => testOwner.setSize(468, 350));
    await wait(); await page.waitForTimeout(200);
    assert.equal((await snapshot()).clientWidth, threshold.clientWidth, 'vertical gutter must not change fitting width');
    assert.equal((await snapshot()).zoom, threshold.zoom);
    const settled = await snapshot(); await page.waitForTimeout(250);
    assert.equal((await snapshot()).changes, settled.changes, 'resize must settle without a feedback loop');
    await page.evaluate(() => testOwner.destroy());
    assert.equal(await page.evaluate(() => testHost.viewport.destroyed), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
