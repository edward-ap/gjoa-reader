import {testArtifact} from './test-artifacts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';

test('Library tab overlays unchanged viewport and persists edge, position and width', { timeout: 30000 }, async () => {
  await fixture(async page => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const tab = page.getByRole('button', { name: 'Library', exact: true });
    const toggle = page.locator('[data-dui-control-id=libraryToggle]');
    const workspace = page.locator('[data-dui-control-id=workspace]');
    const before = await workspace.boundingBox();
    await page.locator('[data-library-id="book:1"]').dblclick();
    await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible();
    await toggle.click(); await expect(tab).toHaveAttribute('aria-expanded', 'false');
    assert.deepEqual(await workspace.boundingBox(), before);
    assert.equal(before.width, 1096, 'only two 2px side rails; no dock strip or reserved columns');
    await tab.click(); await expect(tab).toHaveAttribute('aria-expanded', 'true');
    assert.deepEqual(await workspace.boundingBox(), before);
    await page.getByRole('separator', { name: 'Library width' }).press('ArrowRight');
    await tab.press('Alt+ArrowRight'); await tab.press('Alt+ArrowDown');
    await toggle.click(); await expect(tab).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-dui-control-id=libraryDock]')).toHaveAttribute('data-side', 'right');
    const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('test-ui-settings')));
    assert.equal(settings.leftWidth, 300);
    assert.equal(settings.libraryPanel.side, 'right');
    assert.ok(Math.abs(settings.libraryPanel.tabPosition - 0.4) < 0.001);
    await page.setViewportSize({ width: 560, height: 800 });
    const narrow = await workspace.boundingBox();
    await tab.click(); assert.deepEqual(await workspace.boundingBox(), narrow);
    await expect(page.locator('[data-library-id="book:1"]')).toBeVisible();

    await page.screenshot({ path: testArtifact('library-overlay/open-right.png'), animations: 'disabled' });
    await tab.click();
    await page.screenshot({ path: testArtifact('library-overlay/closed-right.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
  });
});
