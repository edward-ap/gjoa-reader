import {testArtifact} from './test-artifacts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {fixture} from './shell-fixture.mjs';

test('one custom application theme: gating, base, preview rollback, persistence and defaults', {timeout:60000}, async()=>{
 await fixture(async p=>{
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const settings=()=>p.getByRole('dialog',{name:'Settings',exact:true});
  const editor=()=>p.getByRole('dialog',{name:'Custom application theme',exact:true});
  const saved=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('test-settings')));
  const open=async()=>{await p.getByRole('button',{name:'Settings',exact:true}).click();};
  const choose=async value=>{await settings().getByRole('combobox',{name:'Application Theme',exact:true}).selectOption({label:value});};
  await open();
  for(const value of ['System','Light','Dark']){await choose(value);await expect(settings().getByRole('button',{name:'Custom',exact:true})).toBeDisabled();}
  await settings().getByRole('button',{name:'OK',exact:true}).click();
  const dark=await saved();
  await open();await choose('Custom');
  await expect(settings().getByRole('button',{name:'Custom',exact:true})).toBeEnabled();
  await settings().getByRole('button',{name:'Custom',exact:true}).click();
  await expect(editor().locator('.dui-theme-designer')).toBeVisible();
  await expect(editor().getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);
  await editor().getByRole('slider',{name:'Surface',exact:true}).press('Home');
  await editor().getByRole('button',{name:'OK',exact:true}).click();
  await settings().getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(await saved(),dark);
  await expect(p.locator('body')).toHaveClass(/dui-theme-dark-blue/);
  await open();await choose('Custom');await settings().getByRole('button',{name:'Custom',exact:true}).click();
  await editor().getByRole('slider',{name:'Surface',exact:true}).press('Home');
  await p.screenshot({path:testArtifact('custom-theme/designer.png')});
  await editor().getByRole('button',{name:'OK',exact:true}).click();
  await settings().getByRole('button',{name:'OK',exact:true}).click();
  const custom=await saved();
  assert.equal(custom.uiTheme,'custom');assert.equal(custom.customTheme.foundation,'dark');
  assert.equal(custom.customTheme.definition.surfaceTint,0);
  assert.equal(custom.pageAppearance,dark.pageAppearance);assert.equal(custom.workspaceBackground,dark.workspaceBackground);
  const actual=await p.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--dui-color-bg').trim());
  assert.equal(actual,custom.customTheme.tokens['--dui-color-bg']);
  await p.reload();await expect(p.locator('body')).toHaveClass(/dui-theme-dark-blue/);
  assert.equal(await p.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--dui-color-bg').trim()),actual);
  await open();await choose('Light');await settings().getByRole('button',{name:'OK',exact:true}).click();
  await expect(p.locator('body')).toHaveClass(/dui-theme-light/);
  assert.deepEqual((await saved()).customTheme,custom.customTheme);
  await open();await choose('Custom');await settings().getByRole('button',{name:'OK',exact:true}).click();
  assert.deepEqual(await saved(),custom);
  await open();await settings().getByRole('button',{name:'Custom',exact:true}).click();
  await editor().getByRole('slider',{name:'Surface',exact:true}).press('End');
  await editor().getByRole('button',{name:'Cancel',exact:true}).click();
  await settings().getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await saved(),custom);
  await open();await settings().getByRole('button',{name:'Restore Defaults',exact:true}).click();
  await expect(settings().getByRole('button',{name:'Custom',exact:true})).toBeDisabled();
  await settings().getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await saved(),custom);
  await open();await settings().getByRole('button',{name:'Restore Defaults',exact:true}).click();await settings().getByRole('button',{name:'OK',exact:true}).click();
  assert.equal((await saved()).uiTheme,'system');assert.equal((await saved()).customTheme,undefined);
  assert.deepEqual(errors,[]);
 });
});


test('custom palette colors visible Reader surfaces and nested scope titles', {timeout:60000}, async()=>{
 await fixture(async p=>{
  const settings=()=>p.getByRole('dialog',{name:'Settings',exact:true});
  const editor=()=>p.getByRole('dialog',{name:'Custom application theme',exact:true});
  await p.getByRole('button',{name:'Settings',exact:true}).click();
  await settings().getByRole('combobox',{name:'Application Theme',exact:true}).selectOption({label:'Light'});
  await settings().getByRole('combobox',{name:'Application Theme',exact:true}).selectOption({label:'Custom'});
  await settings().getByRole('button',{name:'Custom',exact:true}).click();
  await editor().getByRole('button',{name:'More rays',exact:true}).click();
  await editor().getByRole('button',{name:'More rays',exact:true}).click();
  const surfaces=()=>p.evaluate(()=>{
   const bg=s=>getComputedStyle(document.querySelector(s)).backgroundColor;
   return {toolbar:bg('.reader-statusbar'),library:bg('.reader-left-dock'),header:bg('.dui-hiding-side-panel .dui-window-header'),recent:bg('.recent-group > legend'),form:bg('.settings-dialog .dui-field-group > legend'),workspace:bg('.reader-view-host')};
  });
  const changeHue=async value=>{
   await editor().getByRole('slider',{name:'Base hue',exact:true}).evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
   await p.waitForTimeout(100);
  };
  await changeHue(140);const green=await surfaces();
  await changeHue(300);const purple=await surfaces();
  for(const key of ['toolbar','library','header','recent','form'])assert.notEqual(green[key],purple[key],key+' must follow hue');
  assert.equal(green.workspace,purple.workspace);
  assert.notEqual(purple.toolbar,purple.library);
  assert.notEqual(purple.header,purple.recent);
  await editor().getByRole('button',{name:'OK',exact:true}).click();
  await settings().getByRole('button',{name:'OK',exact:true}).click();
  await p.screenshot({path:testArtifact('custom-theme/palette-surfaces.png')});
  await p.reload();
  assert.equal(await p.locator('.reader-statusbar').evaluate(el=>getComputedStyle(el).backgroundColor),purple.toolbar);
  await p.getByRole('button',{name:'Settings',exact:true}).click();
  await settings().getByRole('combobox',{name:'Application Theme',exact:true}).selectOption({label:'Light'});
  await expect(p.locator('body')).not.toHaveClass(/reader-custom-theme/);
  assert.notEqual((await surfaces()).toolbar,purple.toolbar);
 });
});


test('Enter activates Custom and nested Escape restores keyboard focus without saving', async()=>{
 await fixture(async p=>{
  const opener=p.getByRole('button',{name:'Settings',exact:true});await opener.focus();await p.keyboard.press('Enter');
  const settings=p.getByRole('dialog',{name:'Settings',exact:true});
  const theme=settings.getByRole('combobox',{name:'Application Theme',exact:true});await theme.focus();await p.keyboard.press('End');await p.keyboard.press('Tab');
  const custom=settings.getByRole('button',{name:'Custom',exact:true});await expect(custom).toBeFocused();await p.keyboard.press('Enter');
  const editor=p.getByRole('dialog',{name:'Custom application theme',exact:true});await expect(editor).toBeVisible();
  await p.keyboard.press('Escape');await expect(editor).toHaveCount(0);await expect(custom).toBeFocused();
  await p.keyboard.press('Escape');await expect(settings).toHaveCount(0);await expect(opener).toBeFocused();
  assert.equal(await p.evaluate(()=>localStorage.getItem('test-settings')),null);
 });
});
