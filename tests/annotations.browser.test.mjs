import {testArtifact} from './test-artifacts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';

const control = (page, name) => page.locator(`[data-dui-control-id="${name}"]`);
const layer = (page, index = 0) => control(page, `pageAnnotations-${index}`);
const objects = (page, index = 0) => layer(page, index).locator('[data-painter-object]');
async function ready(page) {
  await expect(page.locator('[data-dui-control-id=readerViewHost]')).toHaveAttribute('data-render-status', 'ready');
  await expect(page.locator('.dui-painter:visible').first()).toBeVisible();
}
async function choose(page, tool) {
  if (!await control(page, 'annotationTab').isVisible()) await control(page, 'annotations').click();
  if (await control(page, 'annotationTab').getAttribute('aria-expanded') !== 'true') await control(page, 'annotationTab').click();
  const parent = { pen: 'line', arrow: 'line', dashed: 'line', 'area-select': 'select', eraser: 'select', square: 'rectangle', circle: 'rectangle', ellipse: 'rectangle' }[tool];
  if (parent) { await control(page, `annotation-${parent}`).hover(); await expect(control(page, `annotation-${tool}`)).toBeVisible(); }
  await control(page, `annotation-${tool}`).click();
  await expect(page.locator('.dui-painter:visible').first()).toHaveAttribute('data-editable', 'true');
}
async function point(page, index, x, y) {
  return layer(page, index).locator('.dui-painter__hit').evaluate((el, p) => {
    const pt = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
    return { x: pt.x, y: pt.y };
  }, { x, y });
}
async function draw(page, index, a, b) {
  const start = await point(page, index, ...a), end = await point(page, index, ...b);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
}

test('annotation palette, nested color picker, page coordinates, tools and document isolation', { timeout: 60000 }, async () => {
  await fixture(async page => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const row = id => page.locator(`[data-dui-control-id=libraryTree] [data-library-id="book:${id}"]`);
    await expect(control(page, 'annotations')).toBeDisabled();
    await row(1).dblclick(); await ready(page);
    await control(page, 'libraryToggle').click();
    await control(page, 'annotations').click();
    await expect(control(page, 'annotation-pen')).toBeHidden();
    await control(page, 'annotationTab').click();
    await expect(control(page, 'annotation-pen')).toHaveAttribute('aria-pressed', 'true');
    const color = control(page, 'annotationColor');
    await color.getByRole('button').click({ button: 'right' });
    const hex = page.getByRole('textbox', { name: 'Hex color', exact: true });
    await expect(hex).toBeVisible();
    await hex.fill('#247d39'); await hex.press('Enter');
    await expect(control(page, 'annotation-line')).toBeVisible();
    await control(page, 'annotation-line').click();
    await expect(control(page, 'annotationTab')).toHaveAttribute('aria-expanded', 'false');
    await draw(page, 0, [80, 120], [300, 120]);
    await expect(objects(page)).toHaveCount(1);
    await expect(control(page, 'pageNumber').getByRole('textbox')).toHaveValue('1');
    const original = await objects(page).first().evaluate(el => el.outerHTML);
    assert.match(original, /#247d39/);
    await choose(page, 'rectangle'); await draw(page, 0, [90, 170], [310, 230]);
    await expect(objects(page)).toHaveCount(2);
    await choose(page, 'text');
    const at = await point(page, 0, 110, 290); await page.mouse.click(at.x, at.y);
    const editor = page.locator('.dui-painter__text-editor');
    await editor.fill('Заметка на полях'); await editor.press('Control+Enter');
    await expect(objects(page)).toHaveCount(3);
    await expect(objects(page).last()).toContainText('Заметка на полях');
    await page.keyboard.press('Control+z'); await expect(objects(page)).toHaveCount(2);
    await page.keyboard.press('Control+y'); await expect(objects(page)).toHaveCount(3);
    await choose(page, 'text'); // choosing the selected tool keeps it selected
    await expect(layer(page)).toHaveAttribute('data-editable', 'true');
    await expect(control(page, 'annotations')).toHaveAttribute('aria-pressed', 'true');
    await control(page, 'annotations').click();
    await expect(layer(page)).toHaveAttribute('data-editable', 'false');
    await control(page, 'zoomIn').click(); await ready(page);
    assert.equal(await objects(page).first().evaluate(el => el.outerHTML), original);
    await control(page, 'next').click(); await ready(page); await expect(objects(page, 1)).toHaveCount(0);
    await control(page, 'previous').click(); await ready(page); await expect(objects(page)).toHaveCount(3);
    await control(page, 'facing').click(); await ready(page); await expect(objects(page)).toHaveCount(3);
    await control(page, 'continuous').click(); await ready(page); await expect(objects(page)).toHaveCount(3);
    await choose(page, 'text');
    const pt = await point(page, 0, 130, 350); await page.mouse.click(pt.x, pt.y);
    await editor.fill('Отмена'); await editor.press('ArrowDown');
    await expect(editor).toBeVisible(); await editor.press('Escape');
    await expect(objects(page)).toHaveCount(3);
    await choose(page, 'text');
    await control(page, 'annotationTab').click();

    await page.screenshot({ path: testArtifact('annotations/prototype.png') });
    await page.keyboard.press('Escape');
    await control(page, 'libraryToggle').click();
    await row(2).dblclick(); await ready(page); await expect(objects(page)).toHaveCount(0);
    await row(2).click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Close', exact: true }).click();
    await expect(page.locator('.dui-painter')).toHaveCount(0);
    await expect(control(page, 'annotations')).toBeDisabled();
    assert.deepEqual(errors, []);
  });
});

test('two levels keep five primary circles; hover, selector, area, eraser, shapes and dash remain durable', { timeout: 45000 }, async () => {
  await fixture(async page => {
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick(); await ready(page); await control(page, 'libraryToggle').click();
    await choose(page, 'rectangle'); await draw(page, 0, [80, 130], [240, 160]); await draw(page, 0, [80, 190], [240, 220]);
    await choose(page, 'dashed'); await draw(page, 0, [80, 300], [260, 300]);
    await expect(objects(page).last().locator('path')).toHaveAttribute('stroke-dasharray', '8 6');
    await control(page, 'annotationTab').click(); await expect(page.locator('.reader-annotation-tools > *')).toHaveCount(5);
    await control(page, 'annotation-select').hover(); await expect(control(page, 'annotation-eraser')).toBeVisible();
    await expect(layer(page)).toHaveAttribute('data-tool', 'line');
    const anchor = await control(page, 'annotation-select').boundingBox();
    const child = await control(page, 'annotation-eraser').boundingBox();
    await page.mouse.move((anchor.x + child.x + anchor.width) / 2, (anchor.y + child.y + anchor.height) / 2);
    await page.waitForTimeout(400); await expect(control(page, 'annotation-eraser')).toBeVisible();
    await control(page, 'annotation-area-select').click(); await draw(page, 0, [70, 120], [250, 230]);
    await choose(page, 'select'); await draw(page, 0, [120, 140], [140, 150]);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('test-annotations'))?.['edition-1:0']);
    await expect.poll(async () => Math.round((await stored())?.objects[0].x)).toBe(100);
    await page.keyboard.press('Control+z'); await expect.poll(async () => Math.round((await stored())?.objects[0].x)).toBe(80);
    await choose(page, 'area-select'); await draw(page, 0, [70, 120], [250, 230]); await page.keyboard.press('Delete'); await expect(objects(page)).toHaveCount(1);
    await page.keyboard.press('Control+z'); await expect(objects(page)).toHaveCount(3);
    await choose(page, 'eraser'); const edge = await point(page, 0, 80, 140); await page.mouse.click(edge.x, edge.y); await expect(objects(page)).toHaveCount(2);
    await page.keyboard.press('Control+z'); await expect(objects(page)).toHaveCount(3);
    await choose(page, 'circle'); await draw(page, 0, [370, 130], [430, 170]);
    await expect.poll(async () => (await stored())?.objects.length).toBe(4); const circle = (await stored()).objects[3]; assert.ok(Math.abs(circle.width - circle.height) < .01);
    await control(page, 'annotationTab').click(); await control(page, 'annotation-rectangle').hover(); await expect(control(page, 'annotation-ellipse')).toBeVisible();
    const tabBox = await control(page, 'annotationTab').boundingBox();
    const parentCenter = { x: tabBox.x + tabBox.width, y: tabBox.y + tabBox.height / 2 };
    const centers = [];
    for (const name of ['square', 'circle', 'ellipse']) {
      const box = await control(page, `annotation-${name}`).boundingBox();
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      assert.ok(Math.abs(Math.hypot(center.x - parentCenter.x, center.y - parentCenter.y) - 120) < 1);
      centers.push(center);
    }
    assert.ok(centers[1].x < centers[0].x && centers[1].x < centers[2].x);
    assert.ok(Math.abs(centers[0].x - centers[2].x) < 1);
    assert.ok(Math.abs((centers[0].y + centers[2].y) / 2 - parentCenter.y) < 1);
    await page.screenshot({ path: testArtifact('annotations/two-level-shapes.png') });
    for (const [group, names] of [['select', ['area-select', 'eraser']], ['line', ['pen', 'arrow', 'dashed']], ['color', ['annotationColor-1', 'annotationColor-2']]]) {
      await control(page, group === 'color' ? 'annotationColor' : `annotation-${group}`).hover();
      for (const name of names) {
        const item = control(page, group === 'color' ? name : `annotation-${name}`);
        await expect(item).toBeVisible();
        const box = await item.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= tabBox.x + tabBox.width + 1);
        assert.ok(Math.abs(Math.hypot(box.x + box.width / 2 - parentCenter.x, box.y + box.height / 2 - parentCenter.y) - 120) < 1);
      }
      if (group === 'select') await page.screenshot({ path: testArtifact('annotations/two-level-selector.png') });
    }
    await page.evaluate(() => window.__TAURI__.core.invoke('save_ui_settings', { lastBook: { kind: 'library', itemId: 1 } }));
    await page.reload(); await ready(page); await expect(objects(page)).toHaveCount(4);
    await expect(objects(page).nth(2).locator('path')).toHaveAttribute('stroke-dasharray', '8 6');
  });
});

test('three color presets switch without a popup and persist their customized values', async () => {
  await fixture(async page => {
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick(); await ready(page); await control(page, 'libraryToggle').click();
    await choose(page, 'pen'); await control(page, 'annotationTab').click(); await control(page, 'annotationColor').hover(); await expect(control(page, 'annotationColor-1')).toBeVisible();
    await control(page, 'annotationColor-1').getByRole('button').click({ button: 'right' });
    const hex = page.getByRole('textbox', { name: 'Hex color', exact: true }); await hex.fill('#6633aa'); await hex.press('Enter');
    await control(page, 'annotationColor-1').getByRole('button').click(); await expect(hex).toBeHidden();
    await expect(control(page, 'annotationTab')).toHaveAttribute('aria-expanded', 'false');
    await draw(page, 0, [80, 140], [260, 140]); assert.match(await objects(page).first().evaluate(el => el.outerHTML), /#6633aa/);
    await page.evaluate(() => window.__TAURI__.core.invoke('save_ui_settings', { lastBook: { kind: 'library', itemId: 1 } }));
    await page.reload(); await ready(page);
    await choose(page, 'pen'); await draw(page, 0, [80, 190], [260, 190]); assert.match(await objects(page).last().evaluate(el => el.outerHTML), /#6633aa/);
  });
});

test('annotations restore after book replacement and reload; new edits and undo remain durable', { timeout: 40000 }, async () => {
  await fixture(async page => {
    const row = id => page.locator(`[data-dui-control-id=libraryTree] [data-library-id="book:${id}"]`);
    await row(1).dblclick(); await ready(page); await control(page, 'libraryToggle').click();
    await choose(page, 'rectangle'); await draw(page, 0, [70, 120], [240, 190]);
    const original = await objects(page).first().evaluate(el => el.outerHTML);
    const savedCount = () => page.evaluate(() => JSON.parse(localStorage.getItem('test-annotations'))?.['edition-1:0']?.objects.length);
    await expect.poll(savedCount).toBe(1);
    await control(page, 'libraryToggle').click(); await row(2).dblclick(); await ready(page);
    await expect(objects(page)).toHaveCount(0);
    await row(1).dblclick(); await ready(page); await expect(objects(page)).toHaveCount(1);
    assert.equal(await objects(page).first().evaluate(el => el.outerHTML), original);
    await page.evaluate(() => window.__TAURI__.core.invoke('save_ui_settings', { lastBook: { kind: 'library', itemId: 1 } }));
    await page.reload(); await ready(page); await expect(objects(page)).toHaveCount(1);
    await control(page, 'libraryToggle').click();
    await choose(page, 'line'); await draw(page, 0, [80, 230], [260, 230]);
    await expect(objects(page)).toHaveCount(2); await expect.poll(savedCount).toBe(2);
    await page.keyboard.press('Delete'); await expect.poll(savedCount).toBe(1);
    await page.keyboard.press('Control+z'); await expect.poll(savedCount).toBe(2);
    await page.keyboard.press('Control+z'); await expect.poll(savedCount).toBe(1);
    await page.keyboard.press('Control+y'); await expect.poll(savedCount).toBe(2);
  });
});

test('drawing waits for restoration and activates when a delayed read completes', async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      const invoke = window.__TAURI__.core.invoke;
      const pending = new Promise(resolve => { window.releaseAnnotationRead = resolve; });
      window.__TAURI__.core.invoke = async (command, args) => {
        if (command === 'read_page_annotations') await pending;
        return invoke(command, args);
      };
    });
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick(); await ready(page);
    await control(page, 'libraryToggle').click(); await control(page, 'annotations').click();
    await expect(layer(page)).toHaveAttribute('data-editable', 'false');
    await page.evaluate(() => window.releaseAnnotationRead());
    await expect(layer(page)).toHaveAttribute('data-editable', 'true');
    await draw(page, 0, [80, 200], [250, 220]); await expect(objects(page)).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('test-annotations'))?.['edition-1:0']?.objects.length)).toBe(1);
  });
});

test('failed annotation read keeps the page read-only and never saves an empty replacement', async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      const invoke = window.__TAURI__.core.invoke;
      window.__TAURI__.core.invoke = (command, args) => command === 'read_page_annotations'
        ? Promise.reject('Malformed saved annotation layer') : invoke(command, args);
    });
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick(); await ready(page);
    await expect(page.locator('[data-dui-control-id="status"][role="status"]')).toContainText('Malformed saved annotation layer');
    await control(page, 'libraryToggle').click(); await control(page, 'annotations').click();
    await expect(layer(page)).toHaveAttribute('data-editable', 'false');
    await draw(page, 0, [80, 200], [250, 220]);
    await expect(objects(page)).toHaveCount(0);
    assert.equal(await page.evaluate(() => calls.filter(c => c.command === 'save_page_annotations').length), 0);
  });
});

test('edge tab moves without expanding, clamps on resize and hiding restores reading', { timeout: 30000 }, async () => {
  await fixture(async page => {
    await page.locator('[data-library-id="book:1"]').dblclick(); await ready(page);
    await control(page, 'libraryToggle').click();
    await control(page, 'annotations').click();
    const tab = control(page, 'annotationTab'), original = await tab.boundingBox();
    await expect(control(page, 'annotations')).toHaveAttribute('aria-pressed', 'true');
    await expect(layer(page)).toHaveAttribute('data-editable', 'true');
    await tab.click();
    await draw(page, 0, [100, 130], [220, 180]);
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    await expect(objects(page)).toHaveCount(1);
    await page.mouse.move(original.x + 10, original.y + 30); await page.mouse.down();
    await page.mouse.move(original.x + 10, original.y + 160, { steps: 8 }); await page.mouse.up();
    assert.ok((await tab.boundingBox()).y > original.y + 100);
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    const movedY = (await tab.boundingBox()).y;
    await page.evaluate(() => window.__TAURI__.core.invoke('save_ui_settings', { lastBook: { kind: 'library', itemId: 1 } }));
    await page.reload(); await ready(page); await control(page, 'annotations').click();
    assert.ok(Math.abs((await tab.boundingBox()).y - movedY) < 1, 'rail position survives restart at the same viewport size');
    await tab.click(); await expect(control(page, 'annotation-pen')).toHaveAttribute('aria-pressed', 'true');
    const circles = await page.locator('.reader-annotation-tools > *').evaluateAll(elements =>
      elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, radius: r.width / 2 }; }));
    for (let i = 1; i < circles.length; i++) {
      const a = circles[i - 1], b = circles[i];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.radius + b.radius + 2, 'neighbor circles must have a usable gap');
    }
    await page.setViewportSize({ width: 720, height: 480 });
    for (const name of ['select', 'line', 'rectangle', 'text']) {
      const r = await control(page, `annotation-${name}`).boundingBox();
      assert.ok(r.x >= 0 && r.y >= 0 && r.y + r.height < 436);
    }
    await choose(page, 'pen');
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    await expect(layer(page)).toHaveAttribute('data-editable', 'true');
    await tab.click();
    await expect(page.locator('.reader-annotation-tools [aria-pressed=true]')).toHaveCount(1);
    await expect(control(page, 'annotation-pen')).toHaveAttribute('aria-pressed', 'true');
    await choose(page, 'line');
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    await tab.click();
    await expect(control(page, 'annotation-line')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.reader-annotation-tools [aria-pressed=true]')).toHaveCount(1);
    const start = await point(page, 0, 100, 240), end = await point(page, 0, 250, 240);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
    await expect(objects(page)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(layer(page)).toHaveAttribute('data-editable', 'true');
    await control(page, 'annotations').click(); await expect(tab).toBeHidden();
    await expect(control(page, 'annotations')).toHaveAttribute('aria-pressed', 'false');
    await expect(layer(page)).toHaveAttribute('data-editable', 'false');
    await expect(objects(page)).toHaveCount(2);
    await control(page, 'next').click(); await ready(page);
    await expect(control(page, 'pageNumber').getByRole('textbox')).toHaveValue('2');
  });
});

test('facing pages have independent hit areas, marks survive continuous scrolling and resize', { timeout: 40000 }, async () => {
  await fixture(async page => {
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick();
    await ready(page); await control(page, 'libraryToggle').click();
    await control(page, 'facing').click(); await ready(page);
    await control(page, 'next').click(); await ready(page);
    await choose(page, 'rectangle');
    await draw(page, 1, [80, 100], [200, 200]);
    await draw(page, 2, [120, 140], [280, 240]);
    await expect(objects(page, 1)).toHaveCount(1); await expect(objects(page, 2)).toHaveCount(1);
    const left = await objects(page, 1).evaluate(el => el.outerHTML);
    const right = await objects(page, 2).evaluate(el => el.outerHTML);
    assert.notEqual(left, right);
    await control(page, 'annotations').click();
    await page.setViewportSize({ width: 720, height: 850 }); await ready(page);
    assert.equal(await objects(page, 1).evaluate(el => el.outerHTML), left);
    assert.equal(await objects(page, 2).evaluate(el => el.outerHTML), right);
    await control(page, 'continuous').click(); await ready(page);
    await control(page, 'pageNumber').getByRole('textbox').fill('3');
    await control(page, 'pageNumber').getByRole('textbox').press('Enter'); await ready(page);
    await expect(objects(page, 2)).toHaveCount(1);
    assert.equal(await objects(page, 2).evaluate(el => el.outerHTML), right);
    await control(page, 'single').click(); await ready(page);
    await expect(objects(page, 2)).toHaveCount(1);
  });
});
