import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const open=async page=>{
  const tab=page.getByRole('button',{name:'Library',exact:true});
  if(await tab.getAttribute('aria-expanded')==='false') await tab.click();
  await page.locator('[data-dui-control-id=libraryTree] [data-library-id="book:1"]').dblclick();
};
const complete=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('test-ui-settings')??'{}').tutorialCompleted===true);

for(const method of ['button','edge']) test(`navigation tutorial: ${method}, accepted page and persistent completion`,{timeout:30000},async()=>{
  await fixture(async page=>{
    await open(page);
    await expect(page.locator('.reader-navigation-guide')).toHaveCount(3);
    await expect(button(page,'Previous page')).toBeDisabled();
    const indicator=page.locator('.dui-edge-action-layer__zone--left .dui-edge-action-layer__indicator');
    assert.equal(await indicator.evaluate(el=>getComputedStyle(el).opacity),'1');
    await page.setViewportSize({width:1250,height:850});
    await button(page,'Facing Pages').click();
    await expect(page.locator('.reader-navigation-guide')).toHaveCount(3);
    assert.equal(await complete(page),false);
    await button(page,'Single Page').click();
    await expect(page.locator('.reader-navigation-guide')).toHaveCount(3);
    await page.evaluate(()=>{
      const invoke=__TAURI__.core.invoke;
      __TAURI__.core.invoke=async(command,args)=>{
        if(command==='render_page') await new Promise(r=>window.releasePage=r);
        return invoke(command,args);
      };
    });
    if(method==='button') await button(page,'Next page').click();
    else {
      const box=await page.locator('[data-dui-control-id=workspace]').boundingBox();
      await page.mouse.click(box.x+box.width*.9,box.y+box.height*.5);
    }
    await page.waitForFunction(()=>typeof releasePage==='function');
    assert.equal(await complete(page),false,'pending render does not finish teaching');
    await page.evaluate(()=>releasePage());
    await expect.poll(()=>complete(page)).toBe(true);
    await expect(page.locator('.reader-navigation-guide')).toHaveCount(0);
    await page.reload(); await open(page);
    await expect(button(page,'Ready')).toBeVisible();
    await expect(page.locator('.reader-navigation-guide')).toHaveCount(0);
  });
});

test('completed tutorial disables import hints even for an empty Library',{timeout:30000},async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>localStorage.setItem('test-ui-settings',JSON.stringify({tutorialCompleted:true})));
    await page.reload();
    await expect(button(page,'Import book')).toBeVisible();
    await expect(page.locator('.reader-import-empty')).toHaveCount(0);
    await button(page,'Import book').click();
    await expect(page.getByRole('dialog')).not.toHaveClass(/reader-guide-drop/);
  },undefined,{emptyLibrary:true});
});


test('continuous wheel finishes navigation guidance only after a page turn',{timeout:30000},async()=>{
  await fixture(async page=>{
    await open(page);
    await button(page,'Continuous Pages').click();
    await expect(page.locator('.reader-navigation-guide')).toHaveCount(3);
    assert.equal(await complete(page),false);
    const surface=page.locator('.reader-continuous .reader-surface');
    const rect=await surface.boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
    await page.mouse.wheel(0,rect.height);
    await expect.poll(()=>complete(page)).toBe(true);
    await expect(page.locator('.reader-navigation-guide')).toHaveCount(0);
  });
});
