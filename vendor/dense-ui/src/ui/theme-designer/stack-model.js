import {anchorIds,paletteRoles} from './scope-model.js';
export function stackOrder(bindings,count){const active=anchorIds.slice(0,count);return [...new Set([...paletteRoles.map(r=>bindings[r]).filter(id=>active.includes(id)),...active])];}
export function stackBindings(bindings,count){const order=stackOrder(bindings,count);return Object.fromEntries(paletteRoles.map((r,i)=>[r,order[i%count]]));}
export function swapStack(bindings,count,from,to){
 if(![from,to].every(i=>Number.isInteger(i)&&i>=0&&i<count))throw Error('Invalid stack level');
 const order=stackOrder(bindings,count);[order[from],order[to]]=[order[to],order[from]];
 return Object.fromEntries(paletteRoles.map((r,i)=>[r,order[i%count]]));
}

export function moveStack(bindings,count,from,to){
 if(![from,to].every(i=>Number.isInteger(i)&&i>=0&&i<count))throw Error('Invalid distribution level');
 const order=stackOrder(bindings,count),[id]=order.splice(from,1);order.splice(to,0,id);
 return Object.fromEntries(paletteRoles.map((r,i)=>[r,order[i%count]]));
}
