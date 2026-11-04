import {hues,roles as legacyRoles} from './harmony.js';
export const anchorIds=['a','b','c','d'];
export const paletteRoles=['primary','secondary','tertiary','accent'];
export const boundaryDefaults={workspace:'fixed',panel:'advance',grid:'advance',tabs:'advance',simple:'inherit',leaf:'inherit'};
export const boundaryBehaviors=['inherit','advance','fixed','none'];
export const distributionModes=['primary-only','semantic','scope-cycle','manual'];
export function activeAnchors(definition) {
 return hues(definition.harmony).map((hue,i)=>({...definition.harmony.anchors[i],hue}));
}
export function defaultBindings(count,shift=0) {
 const ids=legacyRoles(anchorIds.slice(0,count),shift);
 return Object.fromEntries(paletteRoles.map((role,i)=>[role,ids[i]]));
}
export function rotateBindings(bindings,direction=1) {
 return Object.fromEntries(paletteRoles.map((role,i)=>[role,bindings[paletteRoles[(i+direction+4)%4]]]));
}
export function normalizeScopeModel(input,count) {
 if(input.roleShift!==undefined&&(!Number.isInteger(input.roleShift)||Math.abs(input.roleShift)>3))throw Error('Invalid legacy role shift.');
 const raw=input.harmony.anchors;
 if(raw!==undefined && (!Array.isArray(raw)||raw.length!==4))throw Error('Four stable anchor metadata records are required.');
 const anchors=anchorIds.map((id,i)=>{
  const a=raw?.[i]??{id,name:id.toUpperCase(),chromaWeight:1};
  if(a.id!==id||typeof a.name!=='string'||a.name.length>48||typeof a.chromaWeight!=='number'||!Number.isFinite(a.chromaWeight)||a.chromaWeight<0||a.chromaWeight>1)throw Error('Invalid anchor metadata. IDs a/b/c/d are stable; names are aliases.');
  return {id,name:a.name,chromaWeight:a.chromaWeight};
 });
 const rawRoles=input.roles??defaultBindings(count,input.roleShift??0);
 if(!rawRoles||typeof rawRoles!=='object'||Array.isArray(rawRoles))throw Error('Invalid role bindings.');
 const roles=Object.fromEntries(paletteRoles.map(role=>{
  if(!anchorIds.slice(0,count).includes(rawRoles[role]))throw Error(`Role ${role} refers to an inactive or unknown anchor.`);
  return [role,rawRoles[role]];
 }));
 const rawD=input.distribution??{mode:input.version===2?'primary-only':'semantic'};
 if(!rawD||!distributionModes.includes(rawD.mode))throw Error('Invalid distribution mode.');
 const sequence=rawD.sequence??paletteRoles;
 if(!Array.isArray(sequence)||sequence.length<1||sequence.length>8||sequence.some(r=>!paletteRoles.includes(r)))throw Error('Invalid scope sequence.');
 const cycleAfter=rawD.cycleAfter??sequence.length;
 if(!Number.isInteger(cycleAfter)||cycleAfter<1||cycleAfter>sequence.length)throw Error('Invalid cycle length.');
 const restartAtWindow=rawD.restartAtWindow??true;
 if(typeof restartAtWindow!=='boolean'||(rawD.inheritLeaves!==undefined&&rawD.inheritLeaves!==true))throw Error('Leaves must inherit; restartAtWindow must be boolean.');
 const afterLast=rawD.afterLast??'cycle';
 if(!['cycle','stay'].includes(afterLast))throw Error('Invalid after-last behavior.');
 const defaults={...boundaryDefaults,...rawD.boundaryDefaults};
 for(const [kind,behavior] of Object.entries(defaults))if(!(kind in boundaryDefaults)||!boundaryBehaviors.includes(behavior)||(kind==='leaf'&&behavior!=='inherit'))throw Error('Invalid boundary default.');
 const overrides=rawD.overrides??{};
 if(typeof overrides!=='object'||!overrides||Array.isArray(overrides)||Object.keys(overrides).length>32)throw Error('Invalid manual scope overrides.');
 const safe={};for(const [id,role] of Object.entries(overrides)) {
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(id)||!paletteRoles.includes(role))throw Error('Invalid scope role override.');
  safe[id]=role;
 }
 return {anchors,roles,distribution:{mode:rawD.mode,sequence:[...sequence],cycleAfter,restartAtWindow,inheritLeaves:true,afterLast,boundaryDefaults:defaults,overrides:safe}};
}
// Scope depth is supplied by the registry, never read from DOM ancestry.
export function resolveScope(distribution,scope,parent) {
 const behavior=scope.behavior??distribution.boundaryDefaults?.[scope.kind]??(scope.boundary===false?'inherit':'advance');
 const advance=behavior==='advance'||behavior==='fixed';
 const depth=scope.window&&distribution.restartAtWindow?0:parent?parent.depth+(advance?1:0):0;
 const explicit=scope.themeRole??(distribution.mode==='manual'?distribution.overrides[scope.id]:undefined);
 let role=parent?.role??'primary';
 if(behavior==='none')role=null;
 else if(explicit)role=explicit;
 else if(behavior==='inherit'&&parent?.role===null)role=null;
 else if(distribution.mode==='primary-only')role='primary';
 else if(distribution.mode==='semantic')role=scope.semanticRole??role;
 else if(distribution.mode==='scope-cycle'){
  if(behavior==='fixed')role='primary';
  else if(behavior==='inherit'&&parent)role=parent.role;
  else role=distribution.sequence[distribution.afterLast==='stay'?Math.min(depth,distribution.cycleAfter-1):depth%distribution.cycleAfter];
 }
 return {role,depth};
}
