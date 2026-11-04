import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';

test('PDF properties never offer or request text reconstruction', { timeout: 40000 }, async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      const invoke = window.__TAURI__.core.invoke;
      window.readerRequests = [];
      window.__TAURI__.core.invoke = async (command, args) => {
        if (['reader_edition_status', 'create_reader_edition'].includes(command)) {
          readerRequests.push(command);
          return { supported: true, itemId: 20, confidence: 'High' };
        }
        return invoke(command, args);
      };
    });
    await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Properties/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: /Reader Edition|Open Original/ })).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => readerRequests), []);
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
