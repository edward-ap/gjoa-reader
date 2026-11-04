import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('GjøaReader ships one pinned framework instance, offline WOFF2 and separate local extensions', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  assert.ok(html.includes('<title>GjøaReader</title>'));
  const imports = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  assert.equal(new Set(Object.values(imports)).size, 1);
  for (const name of ['taet-ui','taet-ui/experimental','taet-ui/inputs','taet-ui/foundation','taet-ui/components','taet-ui/advanced','taet-ui/all'])
    assert.equal(imports[name], './vendor/taet-ui/taet-ui.min.js');
  assert.match(html, /vendor\/taet-ui\/taet-ui.min.css/);
  assert.match(html, /extensions\/viewport\/viewport.css/);
  assert.match(html, /extensions\/painter\/styles.css/);
  await assert.rejects(access('dist/vendor/taet-ui/src'), {code:'ENOENT'});
  const pin = JSON.parse(await readFile('vendor/taet-ui/pin.json', 'utf8'));
  assert.equal(pin.commit, 'bfd3ddcddf1cdc539397e5d2ac5ed3cb976e72c2');
  assert.equal(pin.repository, 'https://github.com/edward-ap/taet-ui');
  const manifest = JSON.parse(await readFile('dist/vendor/taet-ui/manifest.json','utf8'));
  assert.equal(manifest.sourceCommit,pin.commit);
  assert.equal(manifest.version,'0.6.0-rc.4');
  for (const name of ['Panel','ThemeDesigner','ThemeApplicator']) assert.ok(manifest.exports.includes(name),name);
  for (const name of ['Painter','RenderViewport']) assert.ok(!manifest.exports.includes(name),name+' stays a local extension');
  for (const [name,record] of Object.entries(manifest.files)) {
    const bytes=await readFile('dist/vendor/taet-ui/'+name);
    assert.equal(bytes.length,record.bytes,name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,name);
  }
  const font=await readFile('dist/vendor/taet-ui/fonts/NotoSans-variable.woff2');
  assert.equal(createHash('sha256').update(font).digest('hex'),pin.files['src/ui/fonts/NotoSans-variable.woff2'].sha256);
  assert.deepEqual((await readdir('dist/vendor/taet-ui/fonts')).sort(),['NotoSans-OFL.txt','NotoSans-variable.woff2']);
  for (const name of ['viewport/index.js','painter/index.js']) await access('dist/extensions/'+name);
});
