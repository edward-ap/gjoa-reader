import test from 'node:test';
import assert from 'node:assert/strict';
import { PageWindowCache, pageWindow } from '../frontend/page-window-cache.js';
const targets = (index, count = 10, width = 20) => pageWindow(index, count).map(pageIndex => ({ pageIndex, targetWidth: width, targetHeight: 30 }));
test('three-page window reuses neighbors and closes only evictions; boundaries and zoom', async () => {
  const calls = [], closed = [];
  const provider = i => async () => { calls.push(i); return { image: { close: () => closed.push(i) }, owned: true }; };
  const cache = new PageWindowCache(); cache.setWindow('a', targets(1), provider);
  await Promise.all([cache.get(1), cache.get(2), cache.get(0)]);
  cache.setWindow('a', targets(2), provider);
  await Promise.all([cache.get(2), cache.get(3), cache.get(1)]);
  assert.deepEqual(calls, [1,2,0,3]); assert.deepEqual(closed, [0]); assert.equal(cache.entries.size, 3);
  cache.setWindow('a', targets(2,10,40), provider); assert.deepEqual(closed.sort(),[0,1,2,3]);
  await cache.get(2); cache.clear(); assert.equal(cache.entries.size,0);
  assert.deepEqual(pageWindow(0,1),[0]); assert.deepEqual(pageWindow(0,4),[0,1]); assert.deepEqual(pageWindow(3,4),[2,3]);
});
test('evicted and old-document work cannot return pixels or overlap native calls', async () => {
  let release; const disposed=[]; const calls=[];
  const cache=new PageWindowCache();
  cache.setWindow('a',targets(0),i=>async()=>{calls.push(i);await new Promise(r=>release=r);return {image:{close:()=>disposed.push(i)},owned:true};});
  const pending=cache.get(0); await Promise.resolve();
  cache.setWindow('b',targets(5),i=>async()=>{calls.push(i);return {image:{close(){}},owned:true};});
  const fresh=cache.get(5);assert.deepEqual(calls,[0]);release();
  await assert.rejects(pending,{name:'AbortError'});await fresh;
  assert.deepEqual(calls,[0,5]);assert.deepEqual(disposed,[0]);assert.deepEqual([...cache.entries.keys()],[4,5,6]);cache.clear();
});
