import {hexToLch,normalizeHue} from './color-math.js';
const hex=rgb=>'#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
const delta=(a,b)=>((a-b+540)%360)-180;
// Saturated sRGB perimeter: every sample has a zero and a full channel.
// Index it by measured OKLCH hue, rather than placing RGB hue at OKLCH angles.
const corners=[[255,0,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255]];
const perimeter=corners.flatMap((start,edge)=>Array.from({length:255},(_,i)=>{
 const end=corners[(edge+1)%6],rgb=start.map((v,k)=>v+(end[k]-v)*i/255);
 return {rgb,...hexToLch(hex(rgb))};
}));
const hueCache=new Map();
export function spectrumColor(hue) {
 const H=normalizeHue(hue);if(hueCache.has(H))return hueCache.get(H);let best=null;
 for(let i=0;i<perimeter.length;i++){
  const a=perimeter[i],b=perimeter[(i+1)%perimeter.length],span=delta(b.H,a.H),offset=delta(H,a.H);
  if(Math.abs(span)<1e-12)continue;
  const t=offset/span;if(t < -1e-8 || t > 1+1e-8)continue;
  const fraction=Math.min(1,Math.max(0,t)),color=hex(a.rgb.map((v,k)=>v+(b.rgb[k]-v)*fraction));
  const candidate={...hexToLch(color),hex:color};
  // The blue edge folds slightly in OKLCH hue; retain its most chromatic match.
  if(!best||candidate.C>best.C)best=candidate;
 }
 if(!best)throw Error('Spectrum hue must be finite');
 if(hueCache.size>=720)hueCache.delete(hueCache.keys().next().value);
 hueCache.set(H,Object.freeze(best));return best;
}
// Shared by both cached rings; never recomputed while dragging or resizing.
export const spectrumColors=Object.freeze(Array.from({length:360},(_,h)=>spectrumColor(h).hex));
