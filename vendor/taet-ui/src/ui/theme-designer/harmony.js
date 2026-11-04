import {clamp,normalizeHue} from './color-math.js';
export const harmonyTypes=['monochrome','analogous','complementary','split-complementary','triad','tetrad','square','fork','cross'];
export const spreadRange = type => ['fork','cross'].includes(type)?[0,180]:type==='tetrad'?[20,90]:['analogous','split-complementary'].includes(type)?[5,60]:null;
export function template(type,spread=30) {
 const a=clamp(spread,...(spreadRange(type)??[0,180]));
 return {fork:[0,180-a,180+a],cross:[0,a,180,180+a],monochrome:[0],analogous:[0,-a,a],complementary:[0,180],'split-complementary':[0,180-a,180+a],triad:[0,120,240],tetrad:[0,a,180,180+a],square:[0,90,180,270]}[type];
}
export function hues(harmony) {
 return template(harmony.type,harmony.spread).map((o,i)=>normalizeHue(harmony.baseHue+o+(!harmony.lockGeometry && i ? clamp(harmony.spokeOffsets?.[i]??0,-20,20):0)));
}
export function roles(angles,shift=0) {
 const rotated=angles.map((_,i)=>angles[((i+shift)%angles.length+angles.length)%angles.length]);
 // P/S/T/A; triad reserves its last anchor for accent.
 return [rotated[0],rotated[1]??rotated[0],rotated[2]??rotated[0],rotated.at(-1)];
}
