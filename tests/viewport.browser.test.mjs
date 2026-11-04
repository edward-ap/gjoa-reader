// SPDX-License-Identifier: MIT
// Synthetic browser rendering/automated pointer tests; no native bridge or books.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const fixtureScript = String.raw`
import { RenderViewport } from '/extensions/viewport/index.js';
window.RenderViewport = RenderViewport;
window.viewport = null;
window.requests = []; window.events = [];
window.raster = (color = 'red') => {
  const image = document.createElement('canvas'); image.width = 60; image.height = 40;
  image.getContext('2d').fillStyle = color; image.getContext('2d').fillRect(0, 0, 60, 40);
  return { image };
};
window.makeViewport = (options = {}) => {
  window.viewport?.destroy(); window.requests = []; window.events = [];
  const viewport = new RenderViewport({ width:'100%',height:'100%',contentWidth:1200,contentHeight:800,
    renderer:request=>new Promise((resolve,reject)=>requests.push({request,resolve,reject})),...options });
  for(const type of ['viewportChange','renderStart','renderComplete','renderError'])
    viewport.events.on(type,e=>events.push({type,origin:e.origin,userAction:e.userAction}));
  window.viewport=viewport; viewport.mount('#host');
};
window.paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
window.pixel=()=>[...viewport.element.querySelector('canvas').getContext('2d').getImageData(300,200,1,1).data];
window.ready=true;
`;

test('viewport browser contract on the pinned published foundation', async t => {
  const root=resolve('dist');
  const appHTML=await readFile(resolve(root,'index.html'),'utf8');
  const importmap=appHTML.match(/<script type="importmap">(.*?)<\/script>/s)?.[1];
  assert.ok(importmap,'Build the application before browser tests');
  const map=JSON.parse(importmap);
  for(const key of Object.keys(map.imports)) map.imports[key]='/'+map.imports[key].replace(/^\.\//,'');
  assert.ok(map.imports['taet-ui/foundation'],'One framework bundle must expose foundation');
  const frameworkCSS=[...appHTML.matchAll(/href="([^"]+\.css)"/g)].map(m=>m[1]).find(p=>/taet-ui/.test(p));
  assert.ok(frameworkCSS,'Matching Tæt CSS must be included');
  const html='<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/'+frameworkCSS.replace(/^\.\//,'')+'">'+
    '<link rel="stylesheet" href="/extensions/viewport/viewport.css"><style>body{margin:16px}#host{width:602px;height:402px}</style><div id="host"></div>'+
    '<script type="importmap">'+JSON.stringify(map)+'</script><script type="module">'+fixtureScript+'</script>';
  const server=createServer(async(req,res)=>{
    if(req.url==='/__viewport-fixture'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(await readFile(file));}
    catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    const open=async(options={},dpr=1)=>{
      const context=await browser.newContext({viewport:{width:1000,height:800},deviceScaleFactor:dpr});
      const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/__viewport-fixture');
      await page.waitForFunction(()=>window.ready);await page.evaluate(options=>makeViewport(options),options);
      await page.waitForFunction(()=>requests.length===1);
      return {context,page,errors};
    };
    await t.test('DPR sizes requests and the visible display canvas',async()=>{
      const {context,page,errors}=await open({},2);
      try {
        assert.deepEqual(await page.evaluate(()=>{const c=viewport.element.querySelector('canvas');return {canvas:[c.width,c.height],css:[c.clientWidth,c.clientHeight],target:[requests[0].request.targetWidth,requests[0].request.targetHeight]};}),{canvas:[1200,800],css:[600,400],target:[1200,800]});
        await page.evaluate(async()=>{requests[0].resolve(raster('blue'));await paint();});
        assert.deepEqual(await page.evaluate(()=>pixel()),[0,0,255,255]);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('stale work cannot replace accepted pixels; errors preserve prior raster',async()=>{
      const {context,page,errors}=await open();
      try {
        const req=await page.evaluate(()=>{const {signal,...r}=requests[0].request;return {...r,aborted:signal.aborted,frozen:Object.isFrozen(requests[0].request)};});
        assert.equal(req.frozen,true);assert.equal(req.contentWidth,1200);assert.equal(req.targetWidth,600);assert.equal(req.aborted,false);
        await page.evaluate(async()=>{requests[0].resolve(raster('red'));await paint();viewport.setZoom(1);});
        await page.waitForFunction(()=>requests.length===2);await page.evaluate(()=>viewport.setZoom(1.5));
        assert.equal(await page.evaluate(()=>requests[1].request.signal.aborted),true);
        await page.waitForFunction(()=>requests.length===3);
        await page.evaluate(async()=>{requests[2].resolve(raster('blue'));await paint();requests[1].resolve(raster('lime'));await paint();});
        assert.deepEqual(await page.evaluate(()=>pixel()),[0,0,255,255]);
        await page.evaluate(()=>{void viewport.refresh();});await page.waitForFunction(()=>requests.length===4);
        await page.evaluate(async()=>{requests[3].reject(Error('synthetic failure'));await paint();});
        assert.deepEqual(await page.evaluate(()=>({status:viewport.renderStatus,message:viewport.lastError.message,pixel:pixel()})),{status:'error',message:'synthetic failure',pixel:[0,0,255,255]});
        await page.evaluate(()=>{viewport.setRenderer(()=>raster('yellow'));});await page.waitForFunction(()=>viewport.renderStatus==='ready');await page.evaluate(()=>paint());
        assert.deepEqual(await page.evaluate(()=>pixel()),[255,255,0,255]);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('ImageBitmap ownership closes accepted, stale and late-destroyed results',async()=>{
      const {context,page,errors}=await open();
      try {
        const result=await page.evaluate(async()=>{
          const canvas=raster('lime').image,borrowed=await createImageBitmap(canvas),owned=await createImageBitmap(canvas);
          const htmlImage=new Image();htmlImage.src=canvas.toDataURL();await htmlImage.decode();
          const offscreen=new OffscreenCanvas(60,40);offscreen.getContext('2d').drawImage(canvas,0,0);
          const imageData=canvas.getContext('2d').getImageData(0,0,60,40),accepted=[];
          for(const image of [canvas,borrowed,htmlImage,offscreen,imageData]){
            viewport.setRenderer(()=>({image}));accepted.push(await viewport.refresh());await paint();
            if(pixel()[1]!==255)throw Error('Accepted image type was not drawn');
          }
          viewport.setRenderer(()=>({image:borrowed}));await viewport.refresh();viewport.setRenderer(()=>({image:owned,owned:true}));await viewport.refresh();
          viewport.setRenderer(()=>({image:canvas}));await viewport.refresh();
          const closedOnReplace=owned.width,borrowedAlive=borrowed.width;
          let finish;viewport.setRenderer(()=>new Promise(resolve=>finish=resolve));const pending=viewport.refresh();
          const stale=await createImageBitmap(canvas);viewport.setRenderer(()=>({image:canvas}));finish({image:stale,owned:true});await pending;
          let afterDestroy;viewport.setRenderer(()=>new Promise(resolve=>afterDestroy=resolve));const late=viewport.refresh();
          const lateImage=await createImageBitmap(canvas);viewport.destroy();afterDestroy({image:lateImage,owned:true});await late;
          const outcome={accepted,closedOnReplace,borrowedAlive,staleClosed:stale.width,lateClosed:lateImage.width,destroyed:viewport.destroyed};borrowed.close();return outcome;
        });
        assert.deepEqual(result,{accepted:[true,true,true,true,true],closedOnReplace:0,borrowedAlive:60,staleClosed:0,lateClosed:0,destroyed:true});assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('public resize delivery preserves manual center and recalculates fit',async()=>{
      const {context,page,errors}=await open();
      try {
        await page.evaluate(()=>{document.querySelector('#host').style.width='802px';});await page.waitForFunction(()=>viewport.viewportSize.width===800);
        await page.evaluate(()=>viewport.fit('fit-width'));assert.ok(Math.abs(await page.evaluate(()=>viewport.zoom)-2/3)<1e-10);
        const before=await page.evaluate(()=>{viewport.setZoom(2);const p=viewport.viewportToContent(400,200);document.querySelector('#host').style.height='502px';return p;});
        await page.waitForFunction(()=>viewport.viewportSize.height===500);
        assert.deepEqual(await page.evaluate(()=>viewport.viewportToContent(400,250)),before);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('automated pointer pan and wheel anchor; disabled input stays inert',async()=>{
      const {context,page,errors}=await open({zoom:1,renderDelay:80});
      try {
        await page.evaluate(async()=>{requests[0].resolve(raster('red'));await paint();});
        const anchored=await page.evaluate(async()=>{const rect=viewport.element.getBoundingClientRect(),before=viewport.viewportToContent(200,120),start=events.length;for(let i=0;i<20;i++)viewport.element.dispatchEvent(new WheelEvent('wheel',{deltaY:-5,ctrlKey:true,cancelable:true,clientX:rect.left+1+200,clientY:rect.top+1+120}));await paint();return {before,after:viewport.viewportToContent(200,120),changes:events.slice(start).filter(e=>e.type==='viewportChange')};});
        assert.ok(Math.abs(anchored.before.x-anchored.after.x)<1e-8);assert.ok(Math.abs(anchored.before.y-anchored.after.y)<1e-8);assert.equal(anchored.changes.length,1);
        assert.equal(anchored.changes[0].origin,'user');
        const start=await page.evaluate(()=>viewport.pan);await page.mouse.move(250,200);await page.mouse.down();await page.mouse.move(310,230,{steps:5});await page.mouse.up();await page.evaluate(()=>paint());
        const end=await page.evaluate(()=>viewport.pan);assert.ok(Math.abs(end.x-start.x-60)<1e-5);assert.ok(Math.abs(end.y-start.y-30)<1e-5);
        await page.evaluate(()=>viewport.disable());const disabled=await page.evaluate(()=>viewport.getViewportState());
        await page.mouse.move(250,200);await page.mouse.down();await page.mouse.move(350,260);await page.mouse.up();await page.keyboard.press('+');await page.evaluate(()=>paint());
        assert.deepEqual(await page.evaluate(()=>viewport.getViewportState()),disabled);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('silent rendering changes pixels without semantic events; cancelled changes stay atomic',async()=>{
      const {context,page,errors}=await open();
      try{
        const result=await page.evaluate(async()=>{
          requests[0].resolve(raster('red'));await paint();events.length=0;
          viewport.setRenderer(()=>raster('blue'),{silent:true});viewport.setZoom(2,{silent:true});await viewport.refresh({silent:true});await paint();
          const silentEvents=events.length;viewport.events.once('beforeViewportChange',e=>{e.cancel=true;});
          return {silentEvents,accepted:viewport.setZoom(3),zoom:viewport.zoom,pixel:pixel()};
        });
        assert.deepEqual(result,{silentEvents:0,accepted:false,zoom:2,pixel:[0,0,255,255]});assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('destroy cleans listeners and observer before notifying reentrant abort callbacks',async()=>{
      const {context,page,errors}=await open();
      try{
        const result=await page.evaluate(async()=>{
          viewport.destroy();requests=[];events=[];
          const Observer=window.ResizeObserver,add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
          let disconnections=0,listeners=[];
          window.ResizeObserver=class extends Observer{disconnect(){disconnections++;super.disconnect();}};
          EventTarget.prototype.addEventListener=function(type,listener,options){if(this===window||this instanceof MediaQueryList||this instanceof HTMLElement)listeners.push({target:this,type,listener});return add.call(this,type,listener,options);};
          EventTarget.prototype.removeEventListener=function(type,listener,options){listeners=listeners.filter(e=>e.target!==this||e.type!==type||e.listener!==listener);return remove.call(this,type,listener,options);};
          makeViewport({zoom:2});
          await new Promise(resolve=>setTimeout(resolve,20));
          const root=viewport.element,pending=requests[0],count=events.length;let destroyedAtAbort=false;
          pending.request.signal.addEventListener('abort',()=>{destroyedAtAbort=viewport.destroyed;viewport.destroy();});
          viewport.destroy();const bitmap=await createImageBitmap(raster().image);pending.resolve({image:bitmap,owned:true});await paint();
          root.dispatchEvent(new WheelEvent('wheel',{deltaY:-200,ctrlKey:true}));window.dispatchEvent(new Event('resize'));
          const outcome={aborted:pending.request.signal.aborted,destroyedAtAbort,closed:bitmap.width,eventsAfter:events.length-count,disconnections,listeners:listeners.length,connected:root.isConnected};
          window.ResizeObserver=Observer;EventTarget.prototype.addEventListener=add;EventTarget.prototype.removeEventListener=remove;return outcome;
        });
        assert.deepEqual(result,{aborted:true,destroyedAtAbort:true,closed:0,eventsAfter:0,disconnections:1,listeners:0,connected:false});assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
