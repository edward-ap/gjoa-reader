import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../frontend/i18n/en.js';
import legacyRu from '../frontend/i18n/ru.js';
import {t,setLocale,getLocale,resolveLocale,denseText} from '../frontend/i18n/i18n.js';
test('English presentation accepts legacy language and system preferences without changing user text',()=>{
 assert.equal(legacyRu,en);
 assert.equal(t('app.title'),'GjøaReader');
 for(const language of ['en','ru','ru-RU','system','de',null,undefined])
   for(const system of ['ru-RU','en-US','de-DE'])assert.equal(resolveLocale(language,system),'en');
 setLocale('ru');assert.equal(getLocale(),'en');assert.equal(t('settings.title'),'Settings');
 const name='\u0410\u0432\u0442\u043e\u0440 {foo}<b>\u00f8';
 assert.equal(denseText('Actions for {name}',{name}),'Actions for '+name);
 assert.equal(t('unknown'),'unknown');setLocale('system');assert.equal(t('settings.title'),'Settings');
});

test('literal translation keys used by the shell exist',async()=>{
 const {readdir,readFile}=await import('node:fs/promises');
 for(const file of await readdir('frontend')) if(file.endsWith('.js')) {
  const source=await readFile('frontend/'+file,'utf8');
  for(const match of source.matchAll(/\bt\('([^']+)'\s*[,)]/g)) assert.ok(Object.hasOwn(en,match[1]),file+': '+match[1]);
 }
});
