import {testArtifact} from './test-artifacts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fixture } from './shell-fixture.mjs';
const open = page => page.getByRole('button',{name:'Import book',exact:true}).click();
const cancel = page => page.getByRole('dialog').locator('.dui-dialog__footer').getByRole('button',{name:'Close',exact:true}).click();
const file = name => ({ name, mimeType:'application/octet-stream', buffer:Buffer.alloc(1048577,42) });
test('first library walkthrough advances only after intake and the whole queue completes', {timeout:30000}, async () => {
  await fixture(async page => {
    await expect(page.locator('.reader-import-empty')).toHaveCount(1);
    await page.evaluate(() => {
      const invoke=__TAURI__.core.invoke;
      __TAURI__.event={listen:async (_,callback)=>{ window.stageEvent=callback; return ()=>{window.stageEvent=null;}; }};
      __TAURI__.core.invoke=async (command,args)=>{
        if(command==='append_import') await new Promise(r=>setTimeout(r,100));
        if(command==='finish_import') {
          await new Promise(r=>window.releaseProcessing=r);
          stageEvent({payload:{uploadId:1,stage:'Saving'}});
          await new Promise(r=>window.releaseSaving=r);
          snapshot.items=[{id:1,title:'First book',originalName:'one.fb2',inbox:true,pageCount:10}];
        }
        return invoke(command,args);
      };
    });
    await open(page);
    await expect(page.locator('.reader-import-empty')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveClass(/reader-guide-drop/);
    await page.locator('input[type=file]').setInputFiles([file('one.fb2'),file('two.fb2')]);
    await expect(page.getByRole('dialog')).not.toHaveClass(/reader-guide-drop/);
    for(let i=0;i<2;i++) {
      const row=page.locator('.import-stage');
      await expect(row).toHaveAttribute('data-import-stage','Processing');
      await expect(page.locator('.dui-dialog__footer button')).toBeDisabled();
      await expect(page.getByRole('dialog')).not.toHaveClass(/reader-guide-close/);
      await page.evaluate(()=>releaseProcessing());
      await expect(row).toHaveAttribute('data-import-stage','Saving');
      await expect(page.locator('.dui-dialog__footer button')).toBeDisabled();
      await expect(row).toContainText('Saving');
      const track=await page.locator('[data-status=uploading]').getByRole('progressbar').boundingBox(); assert.equal(track.height,8);
      await page.evaluate(()=>releaseSaving());
      await expect(page.locator('[data-status=uploaded]')).toHaveCount(i+1);
    }
    await expect(page.getByRole('dialog')).toHaveClass(/reader-guide-close/);
    await expect(page.locator('.dui-dialog__footer button')).toBeEnabled();
    await cancel(page); await open(page);
    await expect(page.getByRole('dialog')).not.toHaveClass(/reader-guide-(drop|close)/);
    await cancel(page);
  }, undefined, {emptyLibrary:true});
});

test('multi-file Browse queue stays open, reports progress, continues after error and retries', {timeout:30000}, async () => {
  await fixture(async page => {
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.evaluate(() => {
      const invoke=__TAURI__.core.invoke;let active='',fail=true;
      window.beginNames=[];
      __TAURI__.core.invoke=async (command,args)=>{
        if(command==='begin_import') { active=args.name; beginNames.push(active); }
        if(command==='append_import') await new Promise(r=>setTimeout(r,80));
        if(command==='finish_import' && active==='bad.fb2' && fail) { fail=false;throw Error('Invalid book fixture'); }
        const result = await invoke(command,args);
        if(command==='finish_import' && active==='one.fb2') result.warnings=['Duplicate image ID cover.jpg: using the first definition'];
        return result;
      };
    });
    await open(page);
    await expect(page.getByRole('dialog')).toHaveAttribute('aria-label','Import Books');
    await expect(page.getByRole('button',{name:'Browse files',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Import with history',exact:true})).toHaveCount(0);
    await expect(page.locator('.dui-dialog__footer button')).toHaveCount(1);
    const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Browse files',exact:true}).click();
    await (await chooser).setFiles([file('one.fb2'),file('bad.fb2'),file('three.pdf')]);
    await expect(page.locator('.dui-file-upload__row')).toHaveCount(3);
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    await expect(page.locator('.dui-file-upload__row[data-status=uploaded]')).toHaveCount(2);
    await expect(page.locator('.dui-file-upload__row[data-status=error]')).toHaveCount(1);
    await expect(page.locator('.import-warnings')).toContainText('one.fb2: Duplicate image ID cover.jpg');
    assert.deepEqual(await page.evaluate(()=>beginNames),['one.fb2','bad.fb2','three.pdf']);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button',{name:'Retry bad.fb2',exact:true}).click();
    await expect(page.locator('.dui-file-upload__row[data-status=uploaded]')).toHaveCount(3);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.command==='open_library_item').length),0);
    await cancel(page); assert.deepEqual(errors,[]);
  });
});

for (const method of ['button', 'cross', 'escape']) test(`Import ${method} cannot close active work; Cancel all must drain`, {timeout:30000}, async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      const invoke=__TAURI__.core.invoke; window.starts=[];let held=false;
      __TAURI__.core.invoke=async (command,args)=>{
        if(command==='begin_import') starts.push(args.name);
        if(command==='append_import'&&!held) { held=true;await new Promise(r=>window.releaseUpload=r); }
        return invoke(command,args);
      };
    });
    await open(page);await page.locator('input[type=file]').setInputFiles([file('old.fb2'),file('queued.fb2')]);
    await page.waitForFunction(()=>typeof releaseUpload==='function');
    await expect(page.locator('.dui-dialog__footer button')).toBeDisabled();
    if (method === 'button') await page.locator('.dui-dialog__footer button').evaluate(button => button.click());
    else if (method === 'cross') await page.locator('.dui-dialog__close').click();
    else await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    assert.equal(await page.evaluate(()=>calls.some(c=>c.command==='cancel_import')),false);
    await page.getByRole('button',{name:'Cancel all',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>calls.some(c=>c.command==='cancel_import'))).toBe(true);
    await expect(page.locator('.dui-dialog__footer button')).toBeDisabled();
    assert.deepEqual(await page.evaluate(()=>starts),['old.fb2']);
    await page.evaluate(()=>releaseUpload());
    await expect(page.locator('.dui-dialog__footer button')).toBeEnabled();
    await cancel(page);
    await open(page);await page.locator('input[type=file]').setInputFiles(file('new.fb2'));
    await expect(page.locator('.dui-file-upload__row[data-status=uploaded]')).toHaveCount(1);
    assert.deepEqual(await page.evaluate(()=>starts),['old.fb2','new.fb2']);
    await cancel(page);
  });
});


test('English feedback for a legacy ru preference stays above its progressbar with a Unicode filename', {timeout:30000}, async () => {
  await fixture(async page => {
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.evaluate(()=>localStorage.setItem('test-settings',JSON.stringify({version:1,language:'ru',uiTheme:'system',pageAppearance:'original',workspaceBackground:'#484c50'})));
    await page.reload();
    await page.evaluate(()=>{
      const invoke=__TAURI__.core.invoke;
      __TAURI__.event={listen:async (_,callback)=>{window.publicationEvent=callback;return()=>{window.publicationEvent=null;};}};
      __TAURI__.core.invoke=async (command,args)=>{
        if(command==='finish_import') {
          await new Promise(resolve=>window.finishProcessing=resolve);
          publicationEvent({payload:{uploadId:1,stage:'Saving'}});
          await new Promise(resolve=>window.finishSaving=resolve);
        }
        return invoke(command,args);
      };
    });
    await page.locator('[data-dui-control-id=import]').click();
    const filename='Ш'.repeat(250)+'.fb2'; // Synthetic only; 254 UTF-16 filename characters.
    await page.locator('input[type=file]').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.alloc(1048577,42)});
    const stage=page.locator('.import-stage');
    const visibleStage=async expected=>{
      await expect(stage).toHaveText(expected);
      const metrics=await stage.evaluate(element=>{
        const range=document.createRange();range.selectNodeContents(element);
        const text=range.getBoundingClientRect(),box=element.getBoundingClientRect();
        const visible={left:0,top:0,right:innerWidth,bottom:innerHeight};
        for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
          const style=getComputedStyle(ancestor),rect=ancestor.getBoundingClientRect();
          if(/auto|scroll|hidden|clip/.test(style.overflowX)){visible.left=Math.max(visible.left,rect.left);visible.right=Math.min(visible.right,rect.right);}
          if(/auto|scroll|hidden|clip/.test(style.overflowY)){visible.top=Math.max(visible.top,rect.top);visible.bottom=Math.min(visible.bottom,rect.bottom);}
        }
        const hit=document.elementFromPoint((text.left+text.right)/2,(text.top+text.bottom)/2);
        const row=element.closest('[role=listitem]'),bar=row.querySelector('[role=progressbar]').getBoundingClientRect();
        return {textVisible:text.left>=visible.left-.5&&text.right<=visible.right+.5&&text.top>=visible.top-.5&&text.bottom<=visible.bottom+.5,
          hitOnStage:hit===element||element.contains(hit),aboveBar:box.bottom<=bar.top+.5,
          matchingEntry:row.dataset.fileId===element.dataset.importId,barHeight:bar.height};
      });
      assert.equal(metrics.textVisible,true,'full stage text must intersect every clipping ancestor');
      assert.equal(metrics.hitOnStage,true,'visible stage must not be covered by another element');
      assert.equal(metrics.aboveBar,true,'stage belongs immediately above this file progressbar');
      assert.equal(metrics.matchingEntry,true);assert.equal(metrics.barHeight,8);
      await expect(page.locator('[role=listitem] [title]').filter({hasText:filename}).first()).toHaveAttribute('title',filename);
      await expect(page.locator('[role=progressbar]')).toHaveAttribute('aria-valuenow','90');
      await expect(page.locator('.dui-dialog__footer button')).toBeDisabled();
    };
    await page.waitForFunction(()=>typeof finishProcessing==='function');
    await visibleStage('Processing');
    await page.screenshot({path:testArtifact('import-regression/stage-processing-final.png')});
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.evaluate(()=>finishProcessing());
    await page.waitForFunction(()=>typeof finishSaving==='function');
    await visibleStage('Saving');
    await page.screenshot({path:testArtifact('import-regression/stage-saving-final.png')});
    await page.evaluate(()=>finishSaving());
    await expect(page.locator('.dui-file-upload__row[data-status=uploaded]')).toHaveCount(1);
    await expect(page.locator('.import-stage')).toHaveCount(0);
    await expect(page.locator('.dui-dialog__footer button')).toBeEnabled();
    assert.deepEqual(errors,[]);
  },{width:720,height:480});
});


test('per-entry stages survive other rows failing, cancellation and late native events', {timeout:40000}, async () => {
  await fixture(async page => {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.evaluate(()=>{
      const invoke=__TAURI__.core.invoke;let next=0;
      window.nativeStageCallbacks=[];window.finishQueue=[];
      __TAURI__.event={listen:async(_,callback)=>{nativeStageCallbacks.push(callback);return()=>{};}};
      __TAURI__.core.invoke=async(command,args)=>{
        if(command==='begin_import')return ++next;
        if(command==='finish_import'){
          await new Promise((resolve,reject)=>finishQueue.push({id:args.uploadId,resolve,reject}));
        }
        return invoke(command,args);
      };
    });
    await open(page);
    await page.locator('input[type=file]').setInputFiles([file('first.fb2'),file('second.fb2'),file('third.fb2')]);
    const stages=page.locator('.import-stage');
    await expect(stages).toHaveCount(1);await expect(stages).toHaveText('Processing');
    const first=await stages.getAttribute('data-import-id');
    await page.waitForFunction(()=>finishQueue.length===1);
    await page.evaluate(()=>finishQueue[0].reject(Error('Synthetic first publication failure')));
    await page.waitForFunction(()=>finishQueue.length===2);
    await expect(stages).toHaveCount(1);await expect(stages).toHaveText('Processing');
    const second=await stages.getAttribute('data-import-id');assert.notEqual(second,first);
    await expect(page.locator('[data-file-id="'+first+'"] .import-stage')).toHaveCount(0);
    await page.evaluate(()=>nativeStageCallbacks[0]({payload:{uploadId:1,stage:'Saving'}}));
    await expect(stages).toHaveAttribute('data-import-id',second);await expect(stages).toHaveText('Processing');
    await page.getByRole('button',{name:'Cancel second.fb2',exact:true}).click();
    await expect(page.locator('[data-file-id="'+second+'"] .import-stage')).toHaveCount(0);
    await page.evaluate(()=>finishQueue[1].resolve());
    await page.waitForFunction(()=>finishQueue.length===3);
    await expect(stages).toHaveCount(1);await expect(stages).toHaveText('Processing');
    const third=await stages.getAttribute('data-import-id');assert.notEqual(third,second);
    await page.evaluate(()=>{
      nativeStageCallbacks[0]({payload:{uploadId:1,stage:'Saving'}});
      nativeStageCallbacks[1]({payload:{uploadId:2,stage:'Saving'}});
    });
    await expect(stages).toHaveAttribute('data-import-id',third);await expect(stages).toHaveText('Processing');
    await page.evaluate(()=>nativeStageCallbacks[2]({payload:{uploadId:3,stage:'Saving'}}));
    await expect(stages).toHaveText('Saving');
    const geometry=await stages.evaluate(element=>{const bar=element.closest('[role=listitem]').querySelector('[role=progressbar]');return {bottom:element.getBoundingClientRect().bottom,top:bar.getBoundingClientRect().top};});
    assert.ok(geometry.bottom<=geometry.top);
    await page.evaluate(()=>finishQueue[2].resolve());
    await expect(page.locator('.dui-file-upload__row[data-status=uploaded]')).toHaveCount(1);
    await expect(page.locator('.dui-file-upload__row[data-status=error]')).toHaveCount(1);
    await expect(page.locator('.dui-file-upload__row[data-status=canceled]')).toHaveCount(1);
    await expect(stages).toHaveCount(0);await expect(page.locator('.dui-dialog__footer button')).toBeEnabled();
    assert.deepEqual(errors,[]);
  });
});
