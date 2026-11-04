import {hues} from './harmony.js';
import {normalizeHue} from './color-math.js';
export function withRayCount(h,count){
 if(!Number.isInteger(count)||count<1||count>4)throw Error('Ray count must be 1–4');
 return {...structuredClone(h),type:['monochrome','complementary','fork','cross'][count-1],spread:count===4?90:60,lockGeometry:true,spokeOffsets:[]};
}
const half=angle=>{const a=normalizeHue(angle);return a<=180?a:a<270?180:0;};
export function dragRay(h,index,angle,{lockBase=false}={}){
 const count=hues(h).length,next=structuredClone(h),angles=hues(h);
 if(index===0||(count===4&&index===2)){
  if(lockBase)return next;
  next.baseHue=normalizeHue(h.baseHue+angle-angles[index]);return next;
 }
 if(count===2||count===3){
  next.type='fork';next.spread=180-half(index===2?h.baseHue-angle:angle-h.baseHue);
  // Snap a closed fork to the complementary pair; allow subpixel pointer error.
  if(next.spread<=0.5){next.type='complementary';next.spread=0;}
 }else if(count===4){next.type='cross';next.spread=half(angle-h.baseHue-(index===3?180:0));}
 next.lockGeometry=true;next.spokeOffsets=[];return next;
}
