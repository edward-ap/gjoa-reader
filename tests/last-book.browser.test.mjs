import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';

test('startup restores saved Library book through the normal reader pipeline', { timeout: 30000 }, async () => {
  await fixture(async page => {
    await page.evaluate(() => localStorage.setItem('test-ui-settings', JSON.stringify({ lastBook: { kind: 'library', itemId: 3 }, leftCollapsed: true, viewMode: 'facing' })));
    await page.reload();
    await expect.poll(() => page.evaluate(() => calls.filter(c => c.command === 'restore_last_document').length)).toBe(1);
    await expect(page.locator('[data-dui-control-id=pageNumber] input')).toHaveValue('1');
    await expect(page.locator('.reader-view-host')).toHaveAttribute('data-view-mode', 'facing');
    await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-expanded', 'false');
    const commands = await page.evaluate(() => calls.map(c => c.command));
    assert.ok(commands.indexOf('restore_last_document') < commands.indexOf('show_main_window'));
    assert.ok(!commands.includes('open_document'), 'no file picker during restore');
  });
});

test('missing saved book still shows the window and does not loop', { timeout: 30000 }, async () => {
  await fixture(async page => {
    await page.evaluate(() => localStorage.setItem('test-ui-settings', JSON.stringify({ lastBook: { kind: 'library', itemId: 999 } })));
    await page.reload();
    await expect(page.locator('.reader-status')).toContainText('Saved book is missing');
    await expect.poll(() => page.evaluate(() => calls.some(c => c.command === 'show_main_window'))).toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Import book', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => calls.some(c => c.command === 'restore_last_document')), false);
  });
});
