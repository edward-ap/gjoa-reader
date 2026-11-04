import {MAX_CHROMA,migrateTone} from './base-color.js';
import {clamp,normalizeHue} from './color-math.js';
import {normalizeScopeModel} from './scope-model.js';
import {scopeCSS} from './theme-scopes.js';
import {harmonyTypes,spreadRange,template} from './harmony.js';
export const defaultDefinition={version:2,accentForeground:'auto',foundation:'light',harmony:{type:'monochrome',baseHue:246,spread:30,harmonyStrength:.5,lockGeometry:true,spokeOffsets:[]},chroma:.5,surfaceTint:.5,borderContrast:.5,stateIntensity:.5,roleShift:0};
export function normalizeDefinition(input) {
 if(!input || typeof input!=='object' || Array.isArray(input))throw Error('Theme definition must be an object.');
 if(input.version!==undefined && ![1,2].includes(input.version))throw Error('Unsupported theme version.');
 if(input.preset==='clear')return {version:2,preset:'clear'};
 if(!['light','dark'].includes(input.foundation))throw Error('Foundation must be light or dark.');
 if(input.accentForeground!==undefined&&!['auto','light','dark'].includes(input.accentForeground))throw Error('Invalid accentForeground policy.');
 if(input.preferLightAccents!==undefined && typeof input.preferLightAccents!=='boolean')throw Error('preferLightAccents must be boolean.');
 if(input.lockBase!==undefined&&typeof input.lockBase!=='boolean')throw Error('lockBase must be boolean.');
 const accentSource=input.accentSource??'reference';
 if(!['reference','spectrum'].includes(accentSource))throw Error('Unknown accent source.');
 const h=input.harmony;
 if(!h || !harmonyTypes.includes(h.type))throw Error('Unknown harmony.');
 const number=(value,min,max)=>{if(typeof value!=='number'||!Number.isFinite(value))throw Error('Theme parameters must be finite numbers.');return clamp(value,min,max);};
 if(typeof h.lockGeometry!=='boolean')throw Error('lockGeometry must be boolean.');
 const offsets=h.spokeOffsets??[];
 if(!Array.isArray(offsets)||offsets.length>4)throw Error('Invalid spoke offsets.');
 const model=normalizeScopeModel(input,template(h.type,h.spread).length);
 const range=spreadRange(h.type)??[0,180];
 let baseHue=normalizeHue(number(h.baseHue,-1e6,1e6)),baseTone;
 if(input.baseTone!==undefined){
  const t=input.baseTone;if(!t||typeof t!=='object'||Array.isArray(t))throw Error('Invalid base tone.');
  if(t.space==='oklch')baseTone={space:'oklch',L:number(t.L,0,1),C:number(t.C,0,MAX_CHROMA)};
  else if(t.space===undefined){const migrated=migrateTone({s:number(t.s,0,1),l:number(t.l,0,1)},baseHue);baseTone=migrated.tone;baseHue=migrated.H;}
  else throw Error('Unknown base tone space.');
 }
 return {version:2,lockBase:input.lockBase??false,...(baseTone?{baseTone}:{}),accentSource,roles:model.roles,distribution:model.distribution,accentForeground:input.accentForeground??(input.preferLightAccents?'light':'auto'),foundation:input.foundation,harmony:{anchors:model.anchors,type:h.type,baseHue,spread:number(h.spread,...range),harmonyStrength:number(h.harmonyStrength,0,1),lockGeometry:h.lockGeometry,spokeOffsets:template(h.type,h.spread).map((_,i)=>i?number(offsets[i]??0,-20,20):0)},chroma:number(input.chroma,0,1),surfaceTint:number(input.surfaceTint,0,1),borderContrast:number(input.borderContrast,0,1),stateIntensity:number(input.stateIntensity,0,1),roleShift:0};
}
export const serialize = definition => JSON.stringify(normalizeDefinition(definition),null,2);
export function deserialize(text) {
 if(typeof text!=='string'||text.length>20000)throw Error('Theme JSON is too large.');
 return normalizeDefinition(JSON.parse(text));
}
export function exportCSS(result) {
 return `.dui-generated-theme {\n  color-scheme: ${result.definition.foundation??'light'};\n${Object.entries(result.tokens).map(([k,v])=>`  ${k}: ${v};`).join('\n')}\n}\n${scopeCSS(result)}`;
}
