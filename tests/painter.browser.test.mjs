import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep} from 'node:path';

// Exercise the actual extension through the built application's ONE Tæt UI
// import map. This page supplies synthetic geometry, not a mocked Painter.
test('local Painter browser interaction and codec contract', async t => {
  const root = resolve('dist');
  const index = await readFile(resolve(root, 'index.html'), 'utf8');
  const imports = JSON.parse(index.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  const css = index.match(/href="([^"]*taet-ui[^"<>]*\.css)"/)[1];
  const html = `<!doctype html><html><head><base href="/">
    <link rel="stylesheet" href="${css}"><link rel="stylesheet" href="/extensions/painter/styles.css">
    <script type="importmap">${JSON.stringify({imports})}</script></head><body class="dui-theme-light">
    <div id="root" style="position:relative;width:700px;height:500px;background:white"></div>
    <script type="module">import {Painter} from '/extensions/painter/index.js';window.Painter=Painter;</script></body></html>`;
  const server = createServer(async (request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname;
    if (name === '/painter-test.html') { response.setHeader('Content-Type', 'text/html');response.end(html);return; }
    const file = resolve(root, '.' + decodeURIComponent(name));
    if (!file.startsWith(root + sep)) {response.writeHead(403).end();return;}
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
      response.end(await readFile(file));
    } catch {response.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({channel:'msedge',headless:true});
    const context = await browser.newContext({viewport:{width:1000,height:750}});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const setup = async (scale = 1, options = {}) => {
      await page.goto(`http://127.0.0.1:${server.address().port}/painter-test.html`);
      await page.waitForFunction(() => typeof window.Painter === 'function');
      await page.evaluate(({scale,options}) => {
        window.p = new window.Painter(document.querySelector('#root'), {
          areaWidth:300, areaHeight:200, mode:'edit', tool:'rectangle',
          transform:{scale,offsetX:10,offsetY:10}, ...options
        });
        window.changes = [];
        p.events.on('change', event => changes.push(event.document));
      }, {scale,options});
    };
    const point = (x,y) => page.evaluate(([x,y]) => {
      const a=p.logicalToViewport(x,y), r=p.element.getBoundingClientRect();return{x:r.left+a.x,y:r.top+a.y};
    }, [x,y]);
    const drag = async (a,b) => {
      const start=await point(...a),end=await point(...b);
      await page.mouse.move(start.x,start.y);await page.mouse.down();
      await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();
    };

    await t.test('actual pointer tools preserve logical geometry and atomic changes across zoom', async () => {
      for(const scale of [.5,2]) {
        await setup(scale);
        for(const tool of ['pen','marker','line','arrow','rectangle','ellipse']) {
          await page.evaluate(tool=>p.setTool(tool),tool);await drag([20,30],[80,70]);
        }
        const result=await page.evaluate(()=>({doc:p.getDocument(),changes:changes.length}));
        assert.equal(result.doc.objects.length,6);assert.equal(result.changes,6);
        assert.equal(new Set(result.doc.objects.map(o=>o.id)).size,6);
        for(const [key,value] of Object.entries({x:20,y:30,width:60,height:40}))assert.ok(Math.abs(result.doc.objects[4][key]-value)<1.1);
        assert.equal(await page.evaluate(()=>{const json=p.exportJSON();p.importJSON(json,{silent:true});return p.exportJSON()===json;}),true);
      }
    });

    await t.test('area selection, group movement and delete are atomic undo operations', async () => {
      await setup(1.5);
      await page.evaluate(()=>{
        p.addObject({id:'a',type:'rectangle',x:20,y:20,width:50,height:30});
        p.addObject({id:'b',type:'ellipse',x:110,y:20,width:40,height:30});
        p.addObject({id:'c',type:'rectangle',x:240,y:140,width:30,height:30});p.setTool('area-select');
      });
      const before=await page.evaluate(()=>p.exportJSON()),count=await page.evaluate(()=>changes.length);
      await drag([10,10],[180,80]);
      assert.deepEqual(await page.evaluate(()=>p.selectedIds),['a','b']);
      assert.equal(await page.evaluate(()=>changes.length),count);
      await page.evaluate(()=>p.setTool('select'));await drag([40,30],[60,50]);
      assert.deepEqual(await page.evaluate(()=>p.getDocument().objects.map(o=>o.x)),[40,130,240]);
      await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>p.exportJSON()),before);
      await page.evaluate(()=>p.setTool('area-select'));await drag([10,10],[180,80]);
      await page.keyboard.press('Delete');assert.equal(await page.evaluate(()=>p.getDocument().objects.length),1);
      await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>p.exportJSON()),before);
    });

    await t.test('eraser commits once, undo restores all, Escape restores transient visibility', async () => {
      await setup();
      await page.evaluate(()=>{for(const x of [30,90])p.addObject({type:'line',points:[{x,y:30},{x,y:100}]});p.setTool('eraser');});
      const before=await page.evaluate(()=>p.exportJSON()),count=await page.evaluate(()=>changes.length);
      await drag([30,60],[90,60]);
      assert.equal(await page.evaluate(()=>p.getDocument().objects.length),0);
      assert.equal(await page.evaluate(()=>changes.length),count+1);
      await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>p.exportJSON()),before);
      const at=await point(30,60);await page.mouse.move(at.x,at.y);await page.mouse.down();
      await page.keyboard.press('Escape');await page.mouse.up();
      assert.equal(await page.evaluate(()=>p.exportJSON()),before);
      assert.equal(await page.locator('[data-painter-object][visibility=hidden]').count(),0);
    });

    await t.test('dash and constrained tools persist existing v1 primitive types', async () => {
      await setup();await page.evaluate(()=>{p.setTool('line');p.setToolSettings({dash:'dashed'});});
      await drag([20,20],[180,20]);
      await expect(page.locator('[data-painter-object] path').first()).toHaveAttribute('stroke-dasharray','8 6');
      await page.evaluate(()=>p.setTool('circle'));await drag([250,150],[290,170]);
      assert.deepEqual(await page.evaluate(()=>{const o=p.getDocument().objects[1];return{type:o.type,width:o.width,height:o.height};}),{type:'ellipse',width:40,height:40});
      await page.evaluate(()=>p.setTool('rectangle'));await page.keyboard.down('Shift');await drag([100,80],[140,100]);await page.keyboard.up('Shift');
      assert.deepEqual(await page.evaluate(()=>{const o=p.getDocument().objects[2];return{type:o.type,width:o.width,height:o.height};}),{type:'rectangle',width:40,height:40});
      const json=await page.evaluate(()=>p.exportJSON());
      assert.equal(await page.evaluate(json=>{p.importJSON(json,{silent:true});return p.exportJSON();},json),json);
    });

    await t.test('plain text markup, textarea editing and physical history shortcut contracts', async () => {
      await setup();await drag([20,20],[80,60]);
      const key=(key,code,shiftKey=false)=>page.locator('.dui-painter').dispatchEvent('keydown',{key,code,ctrlKey:true,shiftKey});
      await key('\u044f','KeyZ');assert.equal(await page.evaluate(()=>p.getDocument().objects.length),0);
      await key('\u044f','KeyY');assert.equal(await page.evaluate(()=>p.getDocument().objects.length),1);
      await page.evaluate(()=>p.setTool('text'));const at=await point(140,100);await page.mouse.click(at.x,at.y);
      const editor=page.getByRole('textbox',{name:'Text note'});await editor.fill('<img src=x>\nSecond line');
      await editor.dispatchEvent('keydown',{key:'\u044f',code:'KeyZ',ctrlKey:true});
      assert.equal(await page.evaluate(()=>p.getDocument().objects.length),1);await expect(editor).toBeVisible();
      await page.keyboard.press('Control+Enter');
      assert.equal(await page.evaluate(()=>p.getDocument().objects[1].text),'<img src=x>\nSecond line');
      assert.equal(await page.locator('.dui-painter img').count(),0);
    });

    await t.test('public disable/mode/transform cancel drafts; destroyed controls release listeners', async () => {
      await setup();await drag([30,30],[100,90]);
      for(const action of ['mode','transform','disable']) {
        await page.evaluate(()=>{p.enable();p.setMode('edit');p.setTool('pen');});
        const at=await point(30,30);await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.move(at.x+30,at.y+20);
        await page.evaluate(action=>{if(action==='mode')p.setMode('view');else if(action==='transform')p.setTransform({scale:1.5});else p.disable();},action);
        await page.mouse.up();assert.equal(await page.evaluate(()=>p.getDocument().objects.length),1);
      }
      assert.equal(await page.evaluate(()=>{const old=p.element;p.destroy();p.destroy();return old.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:9,clientX:20,clientY:30}));}),true);
      assert.equal(await page.locator('.dui-painter').count(),0);
      assert.equal(await page.evaluate(()=>{try{p.setMode('edit');return false;}catch(error){return /destroyed Painter/.test(error.message);}}),true);
    });

    await t.test('marker plane blending and view mode preserve underlying input hit testing', async () => {
      await setup();await page.evaluate(()=>{p.addObject({type:'marker',points:[{x:20,y:50},{x:200,y:50}],style:{color:'#ffff00',opacity:.5,strokeWidth:24}});p.setMode('view');});
      await expect(page.locator('[data-blend=marker]')).toHaveCSS('mix-blend-mode','multiply');
      assert.equal(await page.evaluate(()=>{const r=p.element.getBoundingClientRect();return !p.element.contains(document.elementFromPoint(r.left+50,r.top+60));}),true);
    });
    assert.deepEqual(errors,[],'No uncaught browser errors');
    await context.close();
  } finally {
    await browser?.close();await new Promise(resolve=>server.close(resolve));
  }
});
