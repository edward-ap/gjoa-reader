import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';
const row = (page,id) => page.locator(`[data-dui-control-id=libraryTree] [data-library-id="${id}"]`);
async function action(page,id,name) {
  await row(page,id).click({button:'right'});
  await page.getByRole('menuitem',{name:new RegExp(`^${name}(?:$|\\s)`)}).click();
}
const ok = page => page.getByRole('dialog').getByRole('button',{name:'OK',exact:true}).click();

test('book dialogs: rename, validation, read-only properties, cancel and delete active book', {timeout:40000}, async () => {
  await fixture(async page => {
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await row(page,'book:1').dblclick();
    await expect(page.getByRole('button',{name:'Ready',exact:true})).toBeVisible();
    await action(page,'book:1','Rename');
    const name=page.getByRole('textbox',{name:'Name',exact:true});
    await expect(name).toHaveValue('Author — Book 1');
    await name.fill(' '); await ok(page);
    await expect(page.getByRole('dialog')).toContainText('Enter a name.');
    await name.fill('Uncommitted'); await page.keyboard.press('Escape');
    await expect(row(page,'book:1')).toContainText('Book 1');
    await action(page,'book:1','Rename'); await name.fill('Renamed <Book>'); await name.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page,'book:1')).toContainText('Renamed <Book>');
    await expect(page.locator('[data-dui-control-id=recentBooks] [data-library-id="book:1"]')).toContainText('Renamed <Book>');
    await action(page,'book:1','Properties');
    await expect(name).toHaveValue('Renamed <Book>');
    await expect(name).toHaveAttribute('readonly','');
    await expect(page.getByRole('textbox',{name:'Original format',exact:true})).toHaveValue('DJVU');
    await expect(page.getByRole('textbox',{name:'Original size',exact:true})).toHaveValue(/123,456 bytes/);
    await expect(page.getByRole('textbox',{name:'Pages',exact:true})).toHaveValue('10');
    await ok(page);
    await action(page,'book:1','Delete'); await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.command==='delete_library_resource').length),0);
    await action(page,'book:1','Delete'); await ok(page);
    await expect(row(page,'book:1')).toHaveCount(0);
    await expect(page.locator('[data-dui-control-id=recentBooks] [data-library-id="book:1"]')).toHaveCount(0);
    await expect(page.getByRole('textbox',{name:'Page number',exact:true})).toHaveValue('');
    await expect(page.getByRole('button',{name:'Next page',exact:true})).toBeDisabled();
    await row(page,'book:2').dblclick(); await expect(page.getByRole('button',{name:'Ready',exact:true})).toBeVisible();
    assert.deepEqual(errors,[]);
  });
});

test('Cut stays grey through progress updates; Escape cancels; folder paste and recursive delete', {timeout:40000}, async () => {
  await fixture(async page => {
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await action(page,'mylib','New Folder');
    const editor=page.getByRole('textbox', { name: 'Name', exact: true });
    await expect(editor).toBeFocused();
    await editor.fill('Cancelled'); await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(()=>snapshot.folders.length),0);
    await action(page,'mylib','New Folder');
    await editor.fill(' '); await ok(page);
    await expect(page.getByRole('dialog')).toContainText('Enter a name.');
    await editor.fill('Shelf');await editor.press('Enter');
    await expect(row(page,'folder:1')).toBeVisible();
    await row(page,'book:1').dblclick();
    await action(page,'book:1','Cut'); await expect(row(page,'book:1')).toHaveAttribute('data-cut-pending','true');
    await page.getByRole('button',{name:'Next page',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>snapshot.items[0].pageIndex)).toBe(1);
    await expect(row(page,'book:1')).toHaveAttribute('data-cut-pending','true');
    await row(page,'book:1').click(); await page.keyboard.press('Escape');
    await expect(row(page,'book:1')).not.toHaveAttribute('data-cut-pending','true');
    await action(page,'book:1','Cut'); await action(page,'folder:1','Paste');
    await expect.poll(()=>page.evaluate(()=>snapshot.items[0].folderId)).toBe(1);
    await expect(row(page,'book:1')).not.toHaveAttribute('data-cut-pending','true');
    await action(page,'mylib','New Folder');await editor.fill('Destination');await editor.press('Enter');
    await expect(row(page,'folder:2')).toBeVisible();
    await action(page,'folder:1','Cut');await action(page,'folder:2','Paste');
    await expect.poll(()=>page.evaluate(()=>snapshot.folders[0].parentId)).toBe(2);
    await action(page,'folder:2','Cut'); await row(page,'folder:1').click({button:'right'});
    await expect(page.getByRole('menuitem',{name:/^Paste/})).toHaveAttribute('aria-disabled','true');await page.keyboard.press('Escape');
    await action(page,'folder:2','Delete');
    await expect(page.getByRole('dialog')).toContainText('1 books, 1 subfolders');
    await ok(page);await expect(row(page,'folder:2')).toHaveCount(0);await expect(row(page,'book:1')).toHaveCount(0);
    await expect(row(page,'book:2')).toBeVisible();
    assert.deepEqual(errors,[]);
  });
});


test('Cyrillic book rename commits on Enter and updates the tree and Recent', {timeout:40000}, async () => {
  await fixture(async page => {
    await row(page,'book:3').dblclick();
    await expect(page.getByRole('button',{name:'Ready',exact:true})).toBeVisible();
    await page.evaluate(() => {
      const item = snapshot.items.find(item => item.id === 3);
      item.title = 'Левиафан'; item.author = 'Борис Акунин';
    });
    // Opening another book and returning refreshes the controller snapshot.
    await row(page,'book:2').dblclick();
    await expect(page.getByRole('button',{name:'Ready',exact:true})).toBeVisible();
    await action(page,'book:3','Rename');
    const input = page.getByRole('textbox',{name:'Name',exact:true});
    await expect(input).toHaveValue('Author — Book 3');
    await input.fill('Лефиафан'); await input.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page,'book:3')).toHaveText('Лефиафан');
    await expect(page.locator('[data-dui-control-id=recentBooks] [data-library-id="book:3"]')).toHaveText('Лефиафан');
    assert.equal(await page.evaluate(() => snapshot.items.find(item => item.id===3).title), 'Лефиафан');
  });
});
