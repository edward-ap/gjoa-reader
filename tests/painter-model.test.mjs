import test from 'node:test';
import assert from 'node:assert/strict';
import {Painter} from '../extensions/painter/index.js';
import {painterBounds,painterRemap} from '../extensions/painter/painterGeometry.js';
const rect={type:'rectangle',x:10,y:20,width:100,height:80,style:{color:'#123456',opacity:.4}};
test('Painter schema round trip, stable IDs and detached snapshots',()=>{
 const p=new Painter();const id=p.addObject(rect);const json=p.exportJSON();const other=new Painter();other.importJSON(json);assert.equal(other.exportJSON(),json);assert.equal(other.getDocument().objects[0].id,id);
 const doc=p.getDocument();doc.objects[0].x=500;assert.equal(p.getDocument().objects[0].x,10);
 const before=p.exportJSON();for(const bad of [{...rect,id}, {...rect,id:'x',x:-1},{...rect,id:'x',style:{color:'url(bad)'}},{...rect,id:'x',width:Infinity}])assert.throws(()=>p.addObject(bad));assert.equal(p.exportJSON(),before);p.destroy();other.destroy();
});
test('undo/redo, import reset, silent notifications and branching',()=>{
 const p=new Painter();let changed=0;p.events.on('change',()=>changed++);const id=p.addObject(rect,{silent:true});assert.equal(changed,0);assert.ok(p.canUndo);p.updateObject(id,{x:20});p.undo();assert.equal(p.getDocument().objects[0].x,10);p.redo();assert.equal(p.getDocument().objects[0].x,20);
 p.undo();p.updateObject(id,{x:30});assert.equal(p.canRedo,false);p.select(id);p.deleteSelected();assert.equal(p.selectedId,null);p.undo();assert.equal(p.getDocument().objects.length,1);p.importJSON(p.exportJSON());assert.equal(p.canUndo,false);p.destroy();assert.throws(()=>p.addObject(rect));
});
test('bounded coordinates, transform inverses, history limits and invalid import atomicity',()=>{
 const p=new Painter({areaWidth:300,areaHeight:200,historyLimit:2});p.setTransform({scale:2.5,offsetX:-15,offsetY:28});const a=p.logicalToViewport(80,60);assert.deepEqual(p.viewportToLogical(a.x,a.y),{x:80,y:60});p.addObject(rect);assert.throws(()=>p.setAreaSize(20,20));assert.throws(()=>p.importJSON({kind:'bad'}));assert.equal(p.getDocument().width,300);
 p.addObject({...rect,id:'b'});p.addObject({...rect,id:'c'});assert.equal(p.undo(),true);assert.equal(p.undo(),true);assert.equal(p.undo(),false);p.destroy();
});
test('path resize maps logical points without changing IDs or styles',()=>{
 const object={id:'pen',type:'pen',points:[{x:20,y:10},{x:30,y:20},{x:50,y:40}],style:{color:'#000000'}};
 const mapped=painterRemap(object,painterBounds(object),{x:10,y:20,width:60,height:60});assert.deepEqual(mapped.points,[{x:10,y:20},{x:30,y:40},{x:70,y:80}]);assert.equal(mapped.id,'pen');assert.deepEqual(object.points[0],{x:20,y:10});
});

test('stroke limits, invalid import and zero-size axis resizing are explicit',()=>{
 const p=new Painter();assert.throws(()=>p.importJSON({kind:'DenseUI.Painter',version:1,width:100,height:100,objects:new Array(1)}));assert.throws(()=>p.addObject({type:'pen',points:new Array(2)}));assert.throws(()=>p.addObject({type:'pen',points:Array.from({length:10001},()=>({x:1,y:1}))}),/points/);
 assert.throws(()=>p.addObject({type:'line',points:[{x:1,y:1}]}));assert.throws(()=>p.logicalToViewport(NaN,0));
 const id=p.addObject(rect);const json=p.exportJSON();const invalid=p.getDocument();invalid.objects.push(invalid.objects[0]);assert.throws(()=>p.importJSON(invalid));assert.equal(p.exportJSON(),json);assert.equal(p.getDocument().objects[0].id,id);
 const line={id:'l',type:'line',points:[{x:0,y:0},{x:100,y:0}]};assert.deepEqual(painterRemap(line,painterBounds(line),{x:0,y:0,width:100,height:50}).points,[{x:0,y:0},{x:100,y:50}]);p.destroy();
});

test('multi-selection deletion is atomic, IDs are detached and legacy styles stay unchanged',()=>{
 const p=new Painter();const a=p.addObject(rect),b=p.addObject({...rect,x:130}),c=p.addObject({...rect,x:250});
 assert.ok(p.selectMany([a,b]));const ids=p.selectedIds;ids.push(c);assert.deepEqual(p.selectedIds,[a,b]);
 assert.equal(p.selectMany(['missing']),false);assert.deepEqual(p.selectedIds,[a,b]);
 let changed=0;p.events.on('change',()=>changed++);p.deleteSelected();assert.equal(changed,1);assert.deepEqual(p.getDocument().objects.map(o=>o.id),[c]);assert.deepEqual(p.selectedIds,[]);
 p.undo();assert.equal(p.getDocument().objects.length,3);assert.equal(p.getDocument().objects[0].style.dash,undefined);
 p.select(a);assert.deepEqual(p.selectedIds,[a]);p.destroy();
});

test('optional dashed stroke survives import, edit and undo without accepting invalid dash',()=>{
 const p=new Painter();const id=p.addObject({type:'line',points:[{x:20,y:30},{x:200,y:30}],style:{dash:'dashed'}});
 const json=p.exportJSON();p.importJSON(json);assert.equal(p.exportJSON(),json);p.updateObject(id,{style:{dash:'solid'}});assert.equal(p.getDocument().objects[0].style.dash,undefined);
 p.undo();assert.equal(p.getDocument().objects[0].style.dash,'dashed');assert.throws(()=>p.updateObject(id,{style:{dash:'bad'}}));assert.equal(p.getDocument().objects[0].style.dash,'dashed');
 for(const type of ['select','area-select','eraser','square','circle'])assert.throws(()=>p.addObject({...rect,type}));p.destroy();
});

// The extension must not depend on BaseControl's private mutation hooks.
test('public lifecycle cancels editing and rejects reentrant teardown mutations',()=>{
 const p=new Painter({disabled:true});p.enable();assert.equal(p.disabled,false);p.disable();assert.equal(p.disabled,true);
 let checked=false;p.disposables.add(()=>{checked=true;assert.throws(()=>p.addObject(rect),/destroyed Painter/);});
 p.destroy();p.destroy();assert.equal(checked,true);assert.throws(()=>p.setMode('edit'),/destroyed Painter/);
});
