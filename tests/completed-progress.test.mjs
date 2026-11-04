import test from 'node:test';
import assert from 'node:assert/strict';
import { progressPercent, bookRow } from '../frontend/library-model.js';
import { fixture } from './shell-fixture.mjs';
import { expect } from '@playwright/test';

test('completion threshold is exact and independent of the current page', () => {
  assert.equal(progressPercent({ pageIndex: 97, pageCount: 100 }), 98);
  assert.equal(progressPercent({ pageIndex: 98, pageCount: 100 }), 100);
  assert.ok(progressPercent({ pageIndex: 98, pageCount: 101 }) < 99);
  assert.equal(progressPercent({ pageIndex: 99, pageCount: 101 }), 100);
  assert.equal(progressPercent({ completed: true, pageIndex: 0, pageCount: 100 }), 100);
  assert.equal(progressPercent({ pageIndex: null, pageCount: 100 }), 0);
  assert.equal(bookRow({ id: 1, title: 'Book', completed: true, pageIndex: 0, pageCount: 100 }).completed, true);
});

test('completed Library bar stays full after navigating to the first page and refreshing Recent', { timeout: 30000 }, async () => {
  await fixture(async page => {
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick();
    const input = page.getByRole('textbox', { name: 'Page number', exact: true });
    const bar = page.locator('[data-dui-control-id=libraryTree] [role=row]').filter({ has: page.locator('[data-library-id="book:1"]') }).locator('progress');
    await input.fill('10'); await input.press('Enter');
    await expect.poll(() => page.evaluate(() => snapshot.items[0].pageIndex)).toBe(9);
    await expect(bar).toHaveAttribute('value', '100');
    await input.fill('1'); await input.press('Enter');
    await expect.poll(() => page.evaluate(() => snapshot.items[0].pageIndex)).toBe(0);
    await expect(bar).toHaveAttribute('value', '100');
    await page.locator('[data-dui-control-id=recentBooks] [data-library-id="book:1"]').click();
    await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible();
    await expect(bar).toHaveAttribute('value', '100');
  });
});
