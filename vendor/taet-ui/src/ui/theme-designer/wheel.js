import {normalizeHue} from './color-math.js';
import {spectrumColors} from './wheel-spectrum.js';
import {sourceColor,sectorWidth,MAX_CHROMA} from './base-color.js';
import {hues} from './harmony.js';
import {dragRay} from './wheel-geometry.js';
// Custom visualization only: all ordinary controls are Tæt UI instances.
export class HarmonyWheel {
 constructor(canvas,onChange,onSelect=()=>{},onHover=()=>{}) {
  this.onHover=onHover;this.canvas=canvas;this.onChange=onChange;this.onSelect=onSelect;this.abort=new AbortController();
  const options={signal:this.abort.signal};
  canvas.addEventListener('pointerdown',e=>{
   if(e.button!==0||!this.definition)return;
   const p=this.point(e),angles=hues(this.definition.harmony);
   const candidates=angles.map((h,i)=>({i,d:Math.hypot(p.x-Math.cos(h*Math.PI/180)*this.radius,p.y-Math.sin(h*Math.PI/180)*this.radius)})).filter(v=>v.d<22).sort((a,b)=>a.d-b.d);
   this.drag=candidates.find(v=>v.i===this.selectedIndex)?.i??candidates[0]?.i??-1;
   if(this.drag<0)return;
   this.start=p;this.dragHarmony=structuredClone(this.definition.harmony);this.onSelect(['a','b','c','d'][this.drag]);canvas.setPointerCapture(e.pointerId);e.preventDefault();
  },options);
  canvas.addEventListener('pointerleave',()=>this.onHover(null),options);
  canvas.addEventListener('pointermove',e=>{if(this.drag<0&&this.definition){const p=this.point(e),index=hues(this.definition.harmony).findIndex(h=>Math.hypot(p.x-Math.cos(h*Math.PI/180)*this.radius,p.y-Math.sin(h*Math.PI/180)*this.radius)<15);this.onHover(index<0?null:'abcd'[index]);}if(this.drag>=0&&Math.hypot(this.point(e).x-this.start.x,this.point(e).y-this.start.y)>3)this.move(e);},options);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{this.drag=-1;},options);
  window.addEventListener('resize',()=>this.draw(),options);
  this.drag=-1;this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(canvas);
 }
 point(e){const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2};}
 move(e){if(this.definition.lockBase&&(this.drag===0||(hues(this.dragHarmony).length===4&&this.drag===2)))return;const p=this.point(e),angle=normalizeHue(Math.atan2(p.y,p.x)*180/Math.PI);
  const h=dragRay(this.dragHarmony,this.drag,angle,{lockBase:this.definition.lockBase});this.onChange(h);
 }
 highlight(anchor){if(this.highlighted===anchor)return;this.highlighted=anchor;this.canvas.dataset.highlightAnchor=anchor??'';this.draw();}
 setDefinition(d,selectedIndex=0){this.definition=d;this.selectedIndex=selectedIndex;this.draw();}
 draw(){if(!this.definition)return;const canvas=this.canvas,r=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;if(r.width<=56||r.height<=56)return;
  canvas.width=Math.max(1,Math.round(r.width*dpr));canvas.height=Math.max(1,Math.round(r.height*dpr));const c=canvas.getContext('2d');c.scale(dpr,dpr);c.translate(r.width/2,r.height/2);const radius=Math.min(r.width,r.height)/2-28;this.radius=radius;
  const toneKey=JSON.stringify(this.definition.baseTone??null);
  if(this.toneKey!==toneKey || !this.ring || this.ring.width!==canvas.width || this.ring.height!==canvas.height || this.dpr!==dpr) {
   this.toneKey=toneKey;this.ring=document.createElement('canvas');this.ring.width=canvas.width;this.ring.height=canvas.height;this.dpr=dpr;
   const ring=this.ring.getContext('2d');ring.scale(dpr,dpr);ring.translate(r.width/2,r.height/2);ring.lineWidth=18;
   for(const ringRadius of [radius,38])for(let i=0;i<360;i++){ring.lineWidth=ringRadius===radius?18:4.5;ring.strokeStyle=this.definition.baseTone?sourceColor(this.definition,i).hex:spectrumColors[i];ring.beginPath();ring.arc(0,0,ringRadius,i*Math.PI/180,(i+1.5)*Math.PI/180);ring.stroke();}
  }
  c.drawImage(this.ring,-r.width/2,-r.height/2,r.width,r.height);
  hues(this.definition.harmony).forEach((h,i)=>{const color=sourceColor(this.definition,h),width=sectorWidth((this.definition.baseTone?.C??MAX_CHROMA)/MAX_CHROMA),angle=h*Math.PI/180,half=width*Math.PI/360;
   if(width>0){c.beginPath();c.arc(0,0,radius-10,angle-half,angle+half);c.arc(0,0,41,angle+half,angle-half,true);c.closePath();c.fillStyle=color.hex;c.fill();}
   const x=Math.cos(h*Math.PI/180)*radius,y=Math.sin(h*Math.PI/180)*radius;c.strokeStyle='#334155';c.lineWidth=1.5;if(width===0){c.beginPath();c.moveTo(Math.cos(h*Math.PI/180)*41,Math.sin(h*Math.PI/180)*41);c.lineTo(x,y);c.stroke();}if(this.highlighted==='abcd'[i]){c.save();c.strokeStyle='#527fa3';c.lineWidth=1;c.shadowColor='#527fa3';c.shadowBlur=3;c.beginPath();c.arc(x,y,15,0,Math.PI*2);c.stroke();c.restore();}c.beginPath();c.arc(x,y,12,0,Math.PI*2);c.fillStyle='#fff';c.fill();c.stroke();c.fillStyle='#17212d';c.font='bold 11px "Noto Sans",sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(['A','B','C','D'][i],x,y);});

 }
 destroy(){this.abort.abort();this.resize.disconnect();}
}
