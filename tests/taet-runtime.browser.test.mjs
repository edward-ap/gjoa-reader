// Public integration contracts for the published Tæt migration. All data is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './shell-fixture.mjs';
test('one Tæt foundation owns both extensions and accepts legacy theme storage without eager writes',async()=>{
 await fixture(async page=>{
  const result=await page.evaluate(async()=>{
   const ui=await import('taet-ui'),foundation=await import('taet-ui/foundation'),advanced=await import('taet-ui/advanced');
   const {RenderViewport}=await import('/extensions/viewport/index.js'),{Painter}=await import('/extensions/painter/index.js');
   const seed=new ui.ThemeDesigner(document.body,{toolbar:false});const definition=seed.getPreset().definition;seed.destroy();
   const legacy=JSON.stringify([{id:'custom:migration',name:'Legacy synthetic theme',definition}]);
   const run=current=>{const reads=[],writes=[],storage={getItem:key=>{reads.push(key);return key==='taet-ui.theme-editor.v1'?current:key==='dense-ui.theme-editor.v1'?legacy:null;},setItem:(key,value)=>writes.push({key,value})};const editor=new ui.ThemeDesigner(document.body,{toolbar:false,storage});const names=editor.getPresets().map(p=>p.name);editor.destroy();return{names,reads,writes};};
   return {same:ui.BaseControl===foundation.BaseControl&&ui.ThemeDesigner===advanced.ThemeDesigner,viewport:RenderViewport.prototype instanceof foundation.BaseControl,painter:Painter.prototype instanceof foundation.BaseControl,fallback:run(null),empty:run('[]'),resources:performance.getEntriesByType('resource').map(x=>x.name)};
  });
  assert.equal(result.same,true);assert.equal(result.viewport,true);assert.equal(result.painter,true);
  assert.ok(result.fallback.names.includes('Legacy synthetic theme'));assert.deepEqual(result.fallback.writes,[]);
  assert.ok(!result.empty.names.includes('Legacy synthetic theme'));assert.deepEqual(result.empty.writes,[]);
  assert.deepEqual(result.empty.reads,['taet-ui.theme-editor.v1']);
  assert.ok(!result.resources.some(x=>/vendor\/dense-ui\//.test(x)));
 });
});
