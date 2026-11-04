import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';

test('restart restores only the selected view; Recent uses the same bounded active pages', { timeout: 60000 }, async () => {
  await fixture(async page => {
    for (const [mode, label, indices] of [
      ['single', 'Single Page', [4]], ['facing', 'Facing Pages', [3, 4]], ['continuous', 'Continuous Pages', [3, 4, 5]],
    ]) {
      await page.evaluate(mode => localStorage.setItem('test-ui-settings', JSON.stringify({ leftWidth: 333, viewMode: mode })), mode);
      await page.reload();
      await page.locator('[data-library-id=mylib]').waitFor();
      await page.evaluate(() => { snapshot.items[0].pageIndex = 4; calls = []; });
      await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick();
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible();
      await page.waitForTimeout(120);
      assert.deepEqual(await page.evaluate(() => calls.filter(c => c.command === 'render_page').map(c => c.args.pageIndex).sort()), indices);
      if (mode !== 'continuous') assert.equal(await page.locator('.reader-continuous').count(), 0, 'unused Continuous is not mounted');
      await page.evaluate(() => { calls = []; });
      await page.locator('[data-dui-control-id=recentBooks] [data-library-id="book:1"]').click();
      await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible(); await page.waitForTimeout(120);
      assert.deepEqual(await page.evaluate(() => calls.filter(c => c.command === 'render_page').map(c => c.args.pageIndex).sort()), indices);
    }
    await page.getByRole('button', { name: 'Single Page', exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('test-ui-settings')).viewMode)).toBe('single');
    await page.reload(); await page.locator('[data-library-id=mylib]').waitFor();
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick();
    await expect(page.getByRole('button', { name: 'Single Page', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await page.locator('.reader-continuous').count(), 0);
  });
});

test('cancelled external opening resumes the active continuous page and scroll offset', { timeout: 30000 }, async () => {
  await fixture(async page => {
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick();
    await page.getByRole('button', { name: 'Continuous Pages', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible();
    await page.locator('.reader-continuous .reader-scroll').evaluate(el => { el.scrollTop += 100; });
    const old = await page.locator('.reader-continuous .reader-scroll').evaluate(el => el.scrollTop);
    await page.keyboard.press('Control+o');
    await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible();
    assert.equal(await page.locator('.reader-continuous .reader-scroll').evaluate(el => el.scrollTop), old);
    await expect(page.getByRole('button', { name: 'Continuous Pages', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});
