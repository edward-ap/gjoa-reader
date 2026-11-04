// Node-only test resolver. Browser imports use the generated single-module import map.
import {readFile} from 'node:fs/promises';
const root=new URL('../vendor/dense-ui/',import.meta.url);
const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
export async function resolve(specifier,context,next){
 if(specifier==='dense-ui'||specifier.startsWith('dense-ui/')){
  const key=specifier==='dense-ui'?'.':'./'+specifier.slice(9);
  const entry=pkg.exports[key];const target=typeof entry==='string'?entry:entry?.default;
  if(!target)throw Error('Not a public Dense UI export: '+specifier);
  return {url:new URL(target,root).href,shortCircuit:true};
 }
 return next(specifier,context);
}
