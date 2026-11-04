import {resolveForeground} from './foreground-resolver.js';
import {Panel,Button,LabelText} from '../all.js';
import {stackOrder} from './stack-model.js';
import {sourceColor} from './base-color.js';
import {hues} from './harmony.js';
// Flat sequence rows: indentation describes depth, never color importance.
export class HarmonyStack {
 constructor(host,onMove,onInspect=()=>{}){this.host=host;this.onMove=onMove;this.onInspect=onInspect;this.levels=[];this.source=null;this.selected=null;this.hovered=null;}
 inspect(){this.paintSelection();this.onInspect(this.hovered??this.selected);}
 hover(id){if(this.hovered===id)return;this.hovered=id;this.inspect();}
 select(id){this.selected=this.selected===id?null:id;this.paintSelection();this.inspect();}
 paintSelection(){for(const {panel,button} of this.levels){const selected=panel.element.dataset.anchor===this.selected;button.element.setAttribute('aria-pressed',String(selected));panel.element.classList.toggle('distribution-selected',selected);panel.element.classList.toggle('distribution-inspected',panel.element.dataset.anchor===(this.hovered??this.selected));}}
 clearDrag(){this.source=null;for(const {panel} of this.levels)panel.element.classList.remove('distribution-drop');}
 commit(i){const from=this.source;this.clearDrag();if(from!==null&&from!==i)this.onMove(from,i);}
 rebuild(count){this.abort?.abort();this.root?.destroy();this.abort=new AbortController();this.levels=[];this.source=null;this.hovered=null;
  const options={signal:this.abort.signal};this.root=new Panel(this.host,{css:'distribution-list'});this.root.element.style.setProperty('--depth-count',count);this.root.element.setAttribute('role','list');
  for(let i=0;i<count;i++){
   const panel=new Panel({css:'distribution-row'});this.root.add(panel);panel.element.dataset.level=i;panel.element.style.setProperty('--depth',i);panel.element.setAttribute('role','listitem');
   const button=new Button({text:'',css:'distribution-marker',onClick:()=>this.select(panel.element.dataset.anchor)}),bar=new LabelText({text:'',css:'distribution-color'});
   panel.add(button,bar);button.element.draggable=true;
   bar.element.addEventListener('click',()=>this.select(panel.element.dataset.anchor),options);
   button.element.addEventListener('dragstart',e=>{this.source=i;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i));},options);
   button.element.addEventListener('dragend',()=>this.clearDrag(),options);
   button.element.addEventListener('keydown',e=>{if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const to=i+(e.key==='ArrowUp'?-1:1);if(to>=0&&to<count){this.onMove(i,to);this.levels[to].button.focus();}}},options);
   panel.element.addEventListener('dragover',e=>{if(this.source===null)return;e.preventDefault();e.dataTransfer.dropEffect='move';for(const v of this.levels)v.panel.element.classList.remove('distribution-drop');panel.element.classList.add('distribution-drop');},options);
   panel.element.addEventListener('drop',e=>{if(this.source===null)return;e.preventDefault();this.commit(i);},options);
   panel.element.addEventListener('pointerenter',()=>{this.hover(panel.element.dataset.anchor);},options);
   panel.element.addEventListener('pointerleave',()=>{this.hover(null);},options);
   panel.element.addEventListener('keydown',e=>{if(e.key==='Escape'){this.clearDrag();this.selected=null;this.hovered=null;this.paintSelection();this.inspect();}},options);
   this.levels.push({panel,button,bar});
  }
 }
 setDefinition(d){const angles=hues(d.harmony),order=stackOrder(d.roles,angles.length);if(this.levels.length!==angles.length)this.rebuild(angles.length);if(!order.includes(this.selected))this.selected=null;
  this.levels.forEach(({panel,button,bar},i)=>{const id=order[i],hex=sourceColor(d,angles['abcd'.indexOf(id)]).hex;bar.element.dataset.anchor=id.toUpperCase();bar.setText(hex,{silent:true});bar.element.style.background=hex;bar.element.style.color=resolveForeground({backgrounds:[hex]}).foreground;bar.element.setAttribute('aria-label',`${id.toUpperCase()} color ${hex}`);panel.element.dataset.anchor=id;button.element.textContent=id.toUpperCase();button.element.setAttribute('aria-label',`Inspect ${id.toUpperCase()} at ${i===0?'Root':'Level '+i}`);button.element.title=`${id.toUpperCase()} · ${i===0?'Root':'Level '+i} — highlight in Preview`;button.element.setAttribute('aria-description','Drag to reorder · Alt+Up/Down');});
  this.paintSelection();this.inspect();
 }
 destroy(){this.onInspect(null);this.abort?.abort();this.root?.destroy();this.levels=[];}
}
