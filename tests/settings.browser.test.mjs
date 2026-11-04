import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';
const button=(p,name)=>p.getByRole('button',{name,exact:true});
async function choose(p,label,text) { await p.getByRole('combobox',{name:label,exact:true}).selectOption({label:text}); }
test('settings are English for legacy ru/system preferences and retain draft semantics', {timeout:40000},async()=>{
 await fixture(async p=>{
  const errors=[];p.on('pageerror',error=>errors.push(error.message));
  await button(p,'Settings').click();
  await expect(p.locator('.settings-restart-note')).toHaveCount(0);
  await expect(p.getByRole('group',{name:'Appearance',exact:true})).toContainText('Page Background');
  await choose(p,'Application Theme','Dark');await button(p,'Cancel').click();
  assert.equal(await p.evaluate(()=>localStorage.getItem('test-settings')),null);
  await p.addInitScript(()=>Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'ru-RU'}));
  for(const legacy of ['ru','system']){
   const saved={version:1,language:legacy,uiTheme:'dark',pageAppearance:'original',workspaceBackground:'#484c50'};
   await p.evaluate(value=>localStorage.setItem('test-settings',JSON.stringify(value)),saved);await p.reload();
   await expect(p.locator('html')).toHaveAttribute('lang','en');
   await expect(p.locator('body')).toHaveClass(/dui-theme-dark-blue/);
   await button(p,'Settings').click();
   const language=p.getByRole('combobox',{name:'Language',exact:true});
   await expect(language).toHaveValue('string:en');
   assert.deepEqual(await language.locator('option').allTextContents(),['English']);
   await button(p,'Cancel').click();
   assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('test-settings'))),saved);
   await button(p,'Settings').click();await button(p,'OK').click();
   assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('test-settings')).language),'en');
  }
  await p.locator('[data-library-id=mylib]').click({button:'right'});
  await p.getByRole('menuitem',{name:/^New Folder/}).click();
  await expect(p.getByRole('textbox',{name:'Name',exact:true})).toBeVisible();await button(p,'Cancel').click();
  await button(p,'Import book').click();await expect(button(p,'Browse files')).toBeVisible();
  await expect(p.getByRole('dialog')).toHaveAttribute('aria-label','Import Books');await button(p,'Close').last().click();
  assert.deepEqual(errors,[]);
 });
});

test('appearance refresh affects only active view and clears continuous cache',{timeout:40000},async()=>{
 await fixture(async p=>{
  await p.evaluate(()=>{const invoke=__TAURI__.core.invoke;__TAURI__.core.invoke=async(c,a)=>{const r=await invoke(c,a);if(c==='open_library_item')r.supportsPageAppearance=true;return r;};});
  await p.locator('[data-library-id="book:1"]').dblclick();await expect(button(p,'Ready')).toBeVisible();
  const pageNumber=p.getByRole('textbox',{name:'Page number',exact:true});await pageNumber.fill('5');await pageNumber.press('Enter');await expect(button(p,'Ready')).toBeVisible();
  for(const [mode,appearance] of [['Single Page','#cbdcc3'],['Continuous Pages','#182038'],['Facing Pages','#ffffff']]){
   await button(p,mode).click();await expect(button(p,'Ready')).toBeVisible();
   await p.evaluate(()=>calls.length=0);
   await button(p,'Settings').click();await button(p,'Page Background').click();await p.getByRole('textbox',{name:'Hex color',exact:true}).fill(appearance);await p.keyboard.press('Tab');await p.keyboard.press('Escape');await p.evaluate(()=>calls.length=0);await p.getByRole('dialog').getByRole('button',{name:'OK',exact:true}).click();
   await expect.poll(()=>p.evaluate(()=>calls.filter(c=>c.command==='render_page').length)).toBeGreaterThan(0);
   await expect(button(p,'Ready')).toBeVisible();await expect(pageNumber).toHaveValue('5');
   const renders=await p.evaluate(()=>calls.filter(c=>c.command==='render_page'));
   assert.ok(new Set(renders.map(r=>r.args.pageIndex)).size <= (mode==='Continuous Pages'?3:mode==='Facing Pages'?2:1), JSON.stringify(renders));
   const expected = {custom:[1,3,5].map(i=>parseInt(appearance.slice(i,i+2),16))};
   for(const render of renders) assert.deepEqual(render.args.appearance,expected);
  }
 });
});


test('Restore Defaults resets drafts; Cancel preserves preferences and Ok persists defaults', {timeout:40000}, async()=>{
 await fixture(async p=>{
  const custom={version:1,language:'en',uiTheme:'dark',pageAppearance:{custom:[24,32,56]},workspaceBackground:'#123456'};
  await p.evaluate(value=>localStorage.setItem('test-settings',JSON.stringify(value)),custom);await p.reload();
  for(const action of ['Cancel','OK']) {
   await button(p,'Settings').click();await button(p,'Restore Defaults').click();
   await expect(p.getByRole('combobox',{name:'Language',exact:true})).toHaveValue('string:en');
   await expect(p.getByRole('combobox',{name:'Application Theme',exact:true})).toHaveValue('string:system');
   await expect(button(p,'Page Background')).toContainText('#ffffff');
   await expect(button(p,'Workspace Background')).toContainText('#484c50');
   await button(p,action).click();
   assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('test-settings'))),action==='Cancel'?custom:{version:1,language:'en',uiTheme:'system',pageAppearance:'original',workspaceBackground:'#484c50'});
  }
 });
});


test('English-only language control needs no restart guidance and footer retains draft actions', {timeout:40000}, async()=>{
 await fixture(async p=>{
  await button(p,'Settings').click();
  await expect(p.locator('.settings-restart-note')).toHaveCount(0);
  assert.deepEqual(await p.locator('.settings-dialog .dui-dialog__footer button').allTextContents(),['Restore Defaults','Cancel','OK']);
  const language=p.getByRole('combobox',{name:'Language',exact:true});
  assert.deepEqual(await language.locator('option').allTextContents(),['English']);
  await choose(p,'Language','English');await button(p,'Restore Defaults').click();
  await expect(language).toHaveValue('string:en');await button(p,'Cancel').click();
  assert.equal(await p.evaluate(()=>localStorage.getItem('test-settings')),null);
  assert.equal(await p.evaluate(()=>calls.filter(c=>c.command==='render_page').length),0);
 });
});
