import { LabelText } from './LabelText.js';

const nonnegative = (value, fallback, name, positive=false) => {
 const number=value ?? fallback;
 if(!Number.isFinite(number) || number<0 || positive && number===0) throw new TypeError(`Invalid ScrollingLabel ${name}`);
 return number;
};
/** Plain text with a browser-managed transform animation; no frame/timer loop. */
export class ScrollingLabel extends LabelText {
 constructor(containerOrOptions={}, maybeOptions) {
  const mounted=typeof containerOrOptions==='string' || typeof HTMLElement!=='undefined' && containerOrOptions instanceof HTMLElement;
  const options=mounted ? maybeOptions??{} : containerOrOptions??{};
  super(options);
  this.speed=nonnegative(options.speed,35,'speed',true);
  this.gap=nonnegative(options.gap,48,'gap');
  this.startDelay=nonnegative(options.startDelay,1000,'startDelay');
  this.paused=options.paused===true;
  this._intersecting=false;
  if(mounted) this.mount(containerOrOptions);
 }
 createElement() {
  const root=document.createElement('span');root.className=['dui-control','dui-scrolling-label',this.className].filter(Boolean).join(' ');root.dataset.duiControlId=this.id;
  const track=document.createElement('span');track.className='dui-scrolling-label__track';
  const first=document.createElement('span'),copy=document.createElement('span');
  first.className=copy.className='dui-scrolling-label__text';copy.setAttribute('aria-hidden','true');
  track.append(first,copy);root.append(track);this._track=track;this._first=first;this._copy=copy;
  first.textContent=copy.textContent=this.text;root.title=this.text;
  this._motion=matchMedia('(prefers-reduced-motion: reduce)');
  this.disposables.addEventListener(this._motion,'change',()=>this._measure());
  this.disposables.addEventListener(document,'visibilitychange',()=>this._syncPlayback());
  this._sizeObserver=new ResizeObserver(()=>this._measure());this._sizeObserver.observe(root);this._sizeObserver.observe(first);
  this._intersection=new IntersectionObserver(entries=>{if(this.destroyed)return;this._intersecting=entries[0]?.isIntersecting===true;this._syncPlayback();});this._intersection.observe(root);
  return root;
 }
 setText(text,options={}) {
  this._assertMutable('setText');const oldValue=this.text;this._textSource=text??'';this.text=String(text??'');this._renderText();
  if(!options.silent && oldValue!==this.text) this.events.emit('textChange',{source:this,oldValue,newValue:this.text,origin:options.origin??'api',userAction:options.userAction===true});
  return this;
 }
 refresh() { this._assertMutable('refresh');this.text=this._resolveText();this._renderText(); }
 setPaused(paused) { this._assertMutable('setPaused');this.paused=Boolean(paused);this._syncPlayback();return this; }
 setSpeed(speed) { this._assertMutable('setSpeed');this.speed=nonnegative(speed,35,'speed',true);this._measure();return this; }
 setGap(gap) { this._assertMutable('setGap');this.gap=nonnegative(gap,48,'gap');this._measure();return this; }
 _renderText() {
  if(!this._first)return;
  this._first.textContent=this._copy.textContent=this.text;this.element.title=this.text;
  this._geometry=null;this._measure();
 }
 _measure() {
  if(this.destroyed || !this.element || !this._first)return;
  const width=this.element.clientWidth, textWidth=parseFloat(getComputedStyle(this._first).width) || 0;
  const moving=width>0 && textWidth>width && !this._motion.matches;
  const signature=[width,textWidth,this.speed,this.gap,this.startDelay,moving].join('/');
  if(this._geometry===signature)return;
  this._geometry=signature;this._animation?.cancel();this._animation=null;
  this._copy.hidden=!moving;this._track.style.gap=`${this.gap}px`;
  if(moving) {
   const distance=textWidth+this.gap;
   this._animation=this._track.animate([{transform:'translateX(0)'},{transform:`translateX(${-distance}px)`}],{duration:distance/this.speed*1000,iterations:Infinity,delay:this.startDelay,easing:'linear',fill:'backwards'});
   this._syncPlayback();
  }
 }
 _syncPlayback() {
  if(!this._animation)return;
  const running=!this.paused && !this.disabled && this.visible && this._intersecting && !document.hidden;
  if(running && this._animation.playState!=='running')this._animation.play();
  else if(!running && this._animation.playState!=='paused')this._animation.pause();
 }
 _applyVisibilityState() { super._applyVisibilityState();this._syncPlayback(); }
 _applyDisabledState() { super._applyDisabledState();this._syncPlayback(); }
 destroy() {
  if(this.destroyed)return;
  this._sizeObserver?.disconnect();this._intersection?.disconnect();this._animation?.cancel();
  this._sizeObserver=this._intersection=this._animation=null;
  super.destroy();this._track=this._first=this._copy=this._motion=null;
 }
}
