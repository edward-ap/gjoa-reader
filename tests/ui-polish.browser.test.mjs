import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {fixture} from './shell-fixture.mjs';
test('Recent stays compact with restrained selection and keyboard focus; roots remain unchanged', {timeout:40000},async()=>{
 await fixture(async p=>{
  const tree=p.locator('[data-dui-control-id=libraryTree]');
  await expect(p.locator('.tree-group legend')).toHaveCount(0);
  await expect(tree.locator('[data-library-id=new]')).toHaveCount(0);
  await tree.locator('[data-library-id="book:1"]').dblclick();
  await expect(p.getByRole('button',{name:'Ready',exact:true})).toBeVisible();
  const recent=p.locator('[data-dui-control-id=recentBooks]');
  await recent.locator('[data-library-id="book:1"]').click();
  await expect(p.getByRole('button',{name:'Ready',exact:true})).toBeVisible();
  const item=recent.locator('.dui-list__item').first();
  assert.ok((await item.boundingBox()).height<=32);
  await recent.focus();await p.keyboard.press('ArrowDown');
  await expect(recent).toBeFocused();
  const active=recent.locator('.dui-active');
  assert.equal(await active.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  const before=await p.evaluate(()=>calls.filter(c=>c.command==='render_page').length);
  await item.hover();await p.keyboard.press('Shift+F10');
  await expect(p.getByRole('menuitem',{name:'Remove',exact:true})).toBeVisible();
  assert.equal(await p.evaluate(()=>calls.filter(c=>c.command==='render_page').length),before);
 });
});
