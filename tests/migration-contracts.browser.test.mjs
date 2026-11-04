import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {fixture} from './shell-fixture.mjs';

test('independently mounted menus and import dialogs are destroyed with their screen', async () => {
  await fixture(async page => {
    const result = await page.evaluate(async () => {
      const {Panel} = await import('dense-ui');
      const {LibraryController} = await import('/library-controller.js');
      const owner = new Panel(document.body, {width:300,height:500});
      const library = new LibraryController(owner, async command => {
        if (command === 'list_library') return {items:[],folders:[],recent:[]};
        throw Error('Unexpected synthetic native command: '+command);
      }, () => {});
      await library.ready;
      const recent = library.recentMenu, resource = library.bookMenu;
      library.showResourceMenu(library.tree.grid.data.get('mylib'), 10, 10);
      library.showImport(); const dialog = library.dialog;
      owner.destroy();
      return {owner:owner.destroyed,recent:recent.destroyed,resource:resource.destroyed,dialog:dialog.destroyed};
    });
    assert.deepEqual(result,{owner:true,recent:true,resource:true,dialog:true});
  });
});

test('row action and Shift+F10 use the application resource menu with explicit command context', async () => {
  await fixture(async page => {
    const row=page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:2"]');
    await row.click(); await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem',{name:/^Rename/})).toBeVisible();
    await page.getByRole('menuitem',{name:/^Rename/}).click();
    await expect(page.getByRole('textbox',{name:'Name',exact:true})).toHaveValue('Author — Book 2');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    // This is the control's public accessible row action, not a private CSS hook.
    await page.getByRole('button',{name:'Actions for Author — Book 3',exact:true}).click();
    await page.getByRole('menuitem',{name:/^Rename/}).click();
    await expect(page.getByRole('textbox',{name:'Name',exact:true})).toHaveValue('Author — Book 3');
  });
});
