import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('GjøaReader ships one pinned framework instance, offline WOFF2 and separate local extensions', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  assert.ok(html.includes('<title>GjøaReader</title>'));
  const imports = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  assert.equal(new Set(Object.values(imports)).size, 1);
  for (const name of ['dense-ui','dense-ui/experimental','dense-ui/inputs','dense-ui/foundation','dense-ui/components','dense-ui/advanced','dense-ui/all'])
    assert.equal(imports[name], './vendor/dense-ui/dense-ui.min.js');
  assert.match(html, /vendor\/dense-ui\/dense-ui.min.css/);
  assert.match(html, /extensions\/viewport\/viewport.css/);
  assert.match(html, /extensions\/painter\/styles.css/);
  await assert.rejects(access('dist/vendor/dense-ui/src'), {code:'ENOENT'});
  const pin = JSON.parse(await readFile('vendor/dense-ui/pin.json', 'utf8'));
  assert.equal(pin.commit, '7e4b2983bcac5c640de250bc7fa1b17d8e6d369e');
  assert.equal(pin.repository, 'https://github.com/edward-ap/dense-ui');
  const manifest = JSON.parse(await readFile('dist/vendor/dense-ui/manifest.json','utf8'));
  assert.equal(manifest.sourceCommit,pin.commit);
  assert.equal(manifest.version,'0.6.0-rc.1');
  for (const name of ['Panel','ThemeDesigner','ThemeApplicator']) assert.ok(manifest.exports.includes(name),name);
  for (const name of ['Painter','RenderViewport']) assert.ok(!manifest.exports.includes(name),name+' stays a local extension');
  for (const [name,record] of Object.entries(manifest.files)) {
    const bytes=await readFile('dist/vendor/dense-ui/'+name);
    assert.equal(bytes.length,record.bytes,name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,name);
  }
  const font=await readFile('dist/vendor/dense-ui/fonts/NotoSans-variable.woff2');
  assert.equal(createHash('sha256').update(font).digest('hex'),pin.files['src/ui/fonts/NotoSans-variable.woff2'].sha256);
  assert.deepEqual((await readdir('dist/vendor/dense-ui/fonts')).sort(),['NotoSans-OFL.txt','NotoSans-variable.woff2']);
  for (const name of ['viewport/index.js','painter/index.js']) await access('dist/extensions/'+name);
});
