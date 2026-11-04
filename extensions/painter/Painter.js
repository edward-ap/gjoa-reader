import {BaseControl} from 'taet-ui/foundation';
import {svgNode} from './svg.js';
import {painterTools,painterClone,painterStyle,painterSize,painterTransform,painterDocument,painterBounds,painterRemap,painterClamp as clamp} from './painterGeometry.js';
const USER={origin:'user',userAction:true};
let nextPainterObject=1;
/**
 * Local SVG annotation control over the public Dense UI BaseControl contract.
 *
 * The owner supplies logical-page geometry and presentation transforms. Painter
 * owns transient pointer/text drafts and bounded undo history, but never the
 * raster background, source document, native bridge, or persistence destination.
 * Committed changes emit a detached DenseUI.Painter v1 document; preview motion
 * does not emit changes. This keeps a whole gesture atomic for both undo and saves.
 */
export class Painter extends BaseControl {
  constructor(containerOrOptions={},maybeOptions){
    const mounted=typeof containerOrOptions==='string'||(typeof HTMLElement!=='undefined'&&containerOrOptions instanceof HTMLElement);
    const options=mounted?maybeOptions??{}:containerOrOptions;super({...options,tabIndex:options.tabIndex??0});
    this._painterDestroying=false;
    this._document={kind:'DenseUI.Painter',version:1,...painterSize(options.areaWidth??800,options.areaHeight??600),objects:[]};
    this._transform=painterTransform(options.transform);this._mode='view';this._tool='select';this._selected=null;this._selectedIds=[];
    this._settings=Object.fromEntries(painterTools.map(tool=>[tool,painterStyle(tool==='marker'?{color:'#ffff00',strokeWidth:18,opacity:.35}:{})]));
    this._undo=[];this._redo=[];this._gesture=null;this._textEdit=null;this._frame=null;
    this._historyLimit=options.historyLimit??50;
    if(!Number.isInteger(this._historyLimit)||this._historyLimit<0||this._historyLimit>200)throw new RangeError('historyLimit must be 0..200.');
    this.setMode(options.mode??'view');this.setTool(options.tool??'select');if(options.toolSettings)this.setToolSettings(options.toolSettings);
    if(mounted)this.mount(containerOrOptions);
  }
  createElement(){
    const root=document.createElement('div');root.className='dui-control dui-painter';root.tabIndex=0;root.dataset.duiControlId=this.id;
    root.setAttribute('role','group');root.setAttribute('aria-label',this.options.label??'Painter');
    this._svg=svgNode('svg',{width:'100%',height:'100%','aria-label':'Drawing area'});
    this._transformGroup=svgNode('g');this._area=svgNode('svg',{overflow:'hidden'});
    this._hit=svgNode('rect',{fill:'transparent',class:'dui-painter__hit'});
    this._objects=document.createElement('div');this._objects.className='dui-painter__objects';this._draft=document.createElement('div');this._draft.className='dui-painter__draft';this._selection=svgNode('g',{'pointer-events':'none'});
    this._selectionPlane=this._plane();this._selectionArea=this._selectionPlane.lastElementChild.lastElementChild;this._selectionArea.append(this._selection);
    this._area.append(this._hit);this._transformGroup.append(this._area);this._svg.append(this._transformGroup);root.append(this._svg,this._objects,this._draft,this._selectionPlane);
    for(const [name,handler] of [['pointerdown',e=>this._down(e)],['pointermove',e=>this._move(e)],['pointerup',e=>this._up(e)],['pointercancel',()=>this.cancel()],['lostpointercapture',()=>{if(this._gesture)this.cancel();}],['keydown',e=>this._key(e)],['dblclick',e=>this._doubleClick(e)]])this.disposables.addEventListener(root,name,handler);
    this.disposables.addEventListener(root,'contextmenu',e=>{if(this._mode==='edit'){e.preventDefault();this.cancel();}});
    this._render();return root;
  }
  mount(container){super.mount(container);this._applyMode();return this;}
  get mode(){return this._mode;}get tool(){return this._tool;}get selectedId(){return this._selected;}
  get selectedIds(){return [...this._selectedIds];}
  get canUndo(){return this._undo.length>0;}get canRedo(){return this._redo.length>0;}
  getDocument(){return painterClone(this._document);}getTransform(){return {...this._transform};}getToolSettings(){return {...this._settings[this._tool]};}
  setMode(mode){this._assertPainterMutable('setMode');if(!['view','edit'].includes(mode))throw new TypeError('Mode must be view or edit.');this.cancel();this._mode=mode;this._applyMode();return this;}
  setTool(tool){this._assertPainterMutable('setTool');if(!painterTools.includes(tool))throw new TypeError('Unknown Painter tool.');this.cancel();this._tool=tool;this._applyMode();return this;}
  setToolSettings(settings){this._assertPainterMutable('setToolSettings');this._settings[this._tool]=painterStyle({...this._settings[this._tool],...settings});return this;}
  setTransform(transform){this._assertPainterMutable('setTransform');const next=painterTransform(transform);if(JSON.stringify(next)===JSON.stringify(this._transform))return this;this.cancel();this._transform=next;this._render();return this;}
  setAreaSize(width,height,options={}){return this._commit({...this._document,...painterSize(width,height)},options);}
  logicalToViewport(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))throw new TypeError('Coordinates must be finite.');const t=this._transform;return {x:x*t.scale+t.offsetX,y:y*t.scale+t.offsetY};}
  viewportToLogical(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))throw new TypeError('Coordinates must be finite.');const t=this._transform;return {x:(x-t.offsetX)/t.scale,y:(y-t.offsetY)/t.scale};}
  exportJSON(){return JSON.stringify(this._document);}
  // Validate a complete replacement before touching the live model or history.
  // silent is for loading saved state: it must not schedule a new persistence write.
  importJSON(input,options={}){
    this._assertPainterMutable('importJSON');const doc=painterDocument(typeof input==='string'?JSON.parse(input):input);
    this.cancel();this._undo=[];this._redo=[];this._document=doc;this._selected=null;this._selectedIds=[];this._render();this._notify(options,true);return this;
  }
  addObject(object,options={}){this._assertPainterMutable('addObject');const value={...object,id:object.id??this._newId()};this._commit({...this._document,objects:[...this._document.objects,value]},options);return value.id;}
  updateObject(id,patch,options={}){this._assertPainterMutable('updateObject');const old=this._document.objects.find(o=>o.id===id);if(!old)return false;
    this._commit({...this._document,objects:this._document.objects.map(o=>o.id===id?{...o,...patch,id:o.id,type:o.type,style:{...o.style,...patch.style}}:o)},options);return true;}
  select(id,options={}){return this.selectMany(id===null?[]:[id],options);}
  selectMany(ids,options={}){this._assertPainterMutable('select');if(!Array.isArray(ids)||ids.length>5000)throw new TypeError('Invalid selection IDs.');
    const next=[...new Set(ids)],available=new Set(this._document.objects.map(o=>o.id));if(next.some(id=>!available.has(id)))return false;
    if(JSON.stringify(next)===JSON.stringify(this._selectedIds))return true;this.cancel();this._selectedIds=next;this._selected=next[0]??null;this._drawSelection();
    if(!options.silent)this.events.emit('selectionChange',{source:this,id:this._selected,ids:this.selectedIds,...this._origin(options)});return true;}
  deleteSelected(options={}){this._assertPainterMutable('deleteSelected');if(!this._selectedIds.length)return false;const ids=new Set(this._selectedIds);this._commit({...this._document,objects:this._document.objects.filter(o=>!ids.has(o.id))},options);return true;}
  clear(options={}){return this._commit({...this._document,objects:[]},options);}
  undo(options={}){return this._travel(this._undo,this._redo,options);}redo(options={}){return this._travel(this._redo,this._undo,options);}
  _travel(from,to,options){this._assertPainterMutable('history');this.cancel();if(!from.length)return false;to.push(this.exportJSON());this._document=JSON.parse(from.pop());this._trimHistory();this._selected=null;this._selectedIds=[];this._render();this._notify(options,true);return true;}
  _commit(value,options={}){
    this._assertPainterMutable('change');const doc=painterDocument(value),before=this.exportJSON();this.cancel();if(JSON.stringify(doc)===before)return this;
    if(this._historyLimit)this._undo.push(before);this._redo=[];this._trimHistory();this._document=doc;
    const ids=this._selectedIds.filter(id=>doc.objects.some(o=>o.id===id)),deselected=ids.length!==this._selectedIds.length;this._selectedIds=ids;this._selected=ids[0]??null;
    this._render();this._notify(options,deselected);return this;
  }
  _trimHistory(){let size=this._undo.concat(this._redo).reduce((n,s)=>n+s.length*2,0);while(this._undo.length+this._redo.length>this._historyLimit||size>8*1024*1024){const stack=this._undo.length?this._undo:this._redo;size-=stack.shift().length*2;}}
  _origin(options){return {origin:options.origin??'api',userAction:options.userAction===true};}
  // Application listeners may destroy the owner at every notification boundary.
  _notify(options,selection){if(options.silent||this.destroyed)return;const meta={source:this,...this._origin(options)};
    this.events.emit('change',{...meta,document:this.getDocument()});if(this.destroyed)return;
    if(selection)this.events.emit('selectionChange',{...meta,id:this._selected,ids:this.selectedIds});if(this.destroyed)return;
    this.events.emit('historyChange',{...meta,canUndo:this.canUndo,canRedo:this.canRedo});
  }
  _newId(){let id;do{id=`painter-${nextPainterObject++}`;}while(this._document.objects.some(o=>o.id===id));return id;}
  _applyMode(){if(!this.element)return;this.element.tabIndex=this._mode==='edit'&&!this.disabled?(this.tabIndex??0):-1;this.element.dataset.mode=this._mode;this.element.dataset.tool=this._tool;this.element.dataset.editable=String(this._mode==='edit'&&!this.disabled);this._drawSelection();}
  // Use only public lifecycle methods: BaseControl's private disabled-state
  // hooks are intentionally not an extension dependency.
  enable(){this._assertPainterMutable('enable');super.enable();this._applyMode();}
  disable(){this._assertPainterMutable('disable');super.disable();this.cancel();this._applyMode();}
  _assertPainterMutable(operation){
    if(this.destroyed||this._painterDestroying)throw new Error(`Cannot call ${operation}() on destroyed Painter ${this.id}.`);
  }
  _point(event){const rect=this.element.getBoundingClientRect();return this.viewportToLogical(event.clientX-rect.left,event.clientY-rect.top);}
  _bounded(p){return {x:clamp(p.x,0,this._document.width),y:clamp(p.y,0,this._document.height)};}
  _down(event){
    if(event.target.closest('textarea')){event.stopPropagation();return;}
    if(this.disabled||this._mode!=='edit'||event.button!==0||event.isPrimary===false||this._gesture)return;
    const p=this._point(event);if(p.x<0||p.y<0||p.x>this._document.width||p.y>this._document.height)return;
    event.preventDefault();event.stopPropagation();this.element.focus({preventScroll:true});if(this._textEdit)this._finishText();if(this.destroyed)return;
    const handle=event.target.closest('[data-handle]'),hit=event.target.closest('[data-painter-object]');
    if(this._tool==='area-select'){
      this.select(null,USER);if(this.destroyed||this.disabled||this._mode!=='edit'||this._tool!=='area-select')return;this._gesture={pointer:event.pointerId,start:p,bounds:{x:p.x,y:p.y,width:0,height:0},kind:'area'};
    }else if(this._tool==='eraser'){
      this.select(null,USER);if(this.destroyed||this.disabled||this._mode!=='edit'||this._tool!=='eraser')return;this._gesture={pointer:event.pointerId,ids:new Set(),kind:'erase'};this._eraseAt(event);
    }else if(this._tool==='select'){
      const id=handle?this._selected:hit?.getAttribute('data-painter-object')??null;if(!id||!this._selectedIds.includes(id))this.select(id,USER);if(this.destroyed||!id||this.disabled||this._mode!=='edit'||this._tool!=='select')return;
      if(this._selectedIds.length>1){const objects=this._document.objects.filter(o=>this._selectedIds.includes(o.id)).map(painterClone);this._gesture={pointer:event.pointerId,start:p,objects,drafts:objects.map(painterClone),kind:'group'};}
      else {
      const object=this._document.objects.find(o=>o.id===id);if(!object)return;this._gesture={pointer:event.pointerId,start:p,object:painterClone(object),draft:painterClone(object),handle:handle?.getAttribute('data-handle'),kind:'edit'};
      }
    }else if(this._tool==='text'){
      const width=Math.min(220,this._document.width-p.x),height=Math.min(90,this._document.height-p.y);if(width<1||height<1)return;
      this._startText({id:this._newId(),type:'text',x:p.x,y:p.y,width,height,text:'',style:this.getToolSettings()},true);return;
    }else{
      const object={id:this._newId(),type:this._tool==='square'?'rectangle':this._tool==='circle'?'ellipse':this._tool,style:this.getToolSettings()};
      if(['pen','marker','line','arrow'].includes(this._tool))object.points=[p,{...p}];else Object.assign(object,{x:p.x,y:p.y,width:0,height:0});
      this._gesture={pointer:event.pointerId,start:p,object,draft:painterClone(object),constrained:['square','circle'].includes(this._tool),kind:'draw'};
    }
    this.element.setPointerCapture(event.pointerId);this._paintDraft();
  }
  _move(event){const g=this._gesture;if(!g||event.pointerId!==g.pointer)return;event.preventDefault();event.stopPropagation();const p=this._bounded(this._point(event));
    if(g.kind==='erase'){this._eraseAt(event);this._paintDraft();return;}
    if(g.kind==='area')Object.assign(g.bounds,{x:Math.min(g.start.x,p.x),y:Math.min(g.start.y,p.y),width:Math.abs(p.x-g.start.x),height:Math.abs(p.y-g.start.y)});
    else if(g.kind==='group'){
      const bounds=g.objects.map(painterBounds),left=Math.min(...bounds.map(b=>b.x)),top=Math.min(...bounds.map(b=>b.y)),right=Math.max(...bounds.map(b=>b.x+b.width)),bottom=Math.max(...bounds.map(b=>b.y+b.height));
      const dx=clamp(p.x-g.start.x,-left,this._document.width-right),dy=clamp(p.y-g.start.y,-top,this._document.height-bottom);
      g.drafts=g.objects.map((o,i)=>painterRemap(o,bounds[i],{...bounds[i],x:bounds[i].x+dx,y:bounds[i].y+dy}));g.changed=dx!==0||dy!==0;
    }else if(g.kind==='edit'){
      if(p.x!==g.start.x||p.y!==g.start.y)g.changed=true;
      const b=painterBounds(g.object);let to;
      if(g.handle){const left=g.handle.includes('w')?Math.min(p.x,b.x+b.width):b.x,right=g.handle.includes('e')?Math.max(p.x,b.x):b.x+b.width,top=g.handle.includes('n')?Math.min(p.y,b.y+b.height):b.y,bottom=g.handle.includes('s')?Math.max(p.y,b.y):b.y+b.height;to={x:left,y:top,width:right-left,height:bottom-top};}
      else to={...b,x:clamp(b.x+p.x-g.start.x,0,this._document.width-b.width),y:clamp(b.y+p.y-g.start.y,0,this._document.height-b.height)};
      g.draft=painterRemap(g.object,b,to);
    }else if(['pen','marker'].includes(g.object.type)){
      const points=g.draft.points,last=points.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)*this._transform.scale>=.75){if(points.length>=10000){this.cancel();this.events.emit('error',{source:this,error:new RangeError('Stroke point limit exceeded.')});return;}points.push(p);}
    }else if(g.draft.points)g.draft.points[1]=p;
    else {
      let end=p;
      if(g.constrained||event.shiftKey){const sx=p.x<g.start.x?-1:1,sy=p.y<g.start.y?-1:1,size=Math.min(Math.max(Math.abs(p.x-g.start.x),Math.abs(p.y-g.start.y)),sx<0?g.start.x:this._document.width-g.start.x,sy<0?g.start.y:this._document.height-g.start.y);end={x:g.start.x+sx*size,y:g.start.y+sy*size};}
      Object.assign(g.draft,{x:Math.min(g.start.x,end.x),y:Math.min(g.start.y,end.y),width:Math.abs(end.x-g.start.x),height:Math.abs(end.y-g.start.y)});
    }
    if(this._frame===null)this._frame=requestAnimationFrame(()=>{this._frame=null;this._paintDraft();});
  }
  _eraseAt(event){const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-painter-object]');if(hit&&this.element.contains(hit))this._gesture.ids.add(hit.getAttribute('data-painter-object'));}
  _up(event){const g=this._gesture;if(!g||g.pointer!==event.pointerId)return;this._move(event);if(this._gesture!==g)return;
    if(g.kind==='area'){const b=g.bounds,ids=this._document.objects.filter(o=>{const a=painterBounds(o);return a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;}).map(o=>o.id);this.cancel();this.selectMany(ids,USER);return;}
    if(g.kind==='erase'){this.cancel();if(g.ids.size)this._commit({...this._document,objects:this._document.objects.filter(o=>!g.ids.has(o.id))},USER);return;}
    if(g.kind==='group'){this.cancel();if(g.changed){const drafts=new Map(g.drafts.map(o=>[o.id,o]));this._commit({...this._document,objects:this._document.objects.map(o=>drafts.get(o.id)??o)},USER);}return;}
    const object=painterClone(g.draft);this.cancel();
    const bounds=painterBounds(object);if(g.kind==='draw'&&!['pen','marker'].includes(object.type)&&bounds.width+bounds.height<1e-6)return;
    if(this._acceptUserObject(object,g.kind==='draw')&&!this.destroyed&&g.kind==='draw')this.select(object.id,USER);
  }
  cancel(){
    const g=this._gesture;this._gesture=null;if(this._frame!==null){cancelAnimationFrame(this._frame);this._frame=null;}
    if(g&&this.element?.hasPointerCapture(g.pointer))this.element.releasePointerCapture(g.pointer);
    if(this._textEdit){const edit=this._textEdit;this._textEdit=null;edit.host.remove();}
    this._draft?.replaceChildren();if(this._objects)for(const el of this._objects.querySelectorAll('[data-painter-object]'))el.removeAttribute('visibility');this._drawSelection();return this;
  }
  _doubleClick(event){if(this._mode!=='edit'||this.disabled||this._tool!=='select')return;const id=event.target.closest('[data-painter-object]')?.getAttribute('data-painter-object')??this._selected;const object=this._document.objects.find(o=>o.id===id);if(object?.type==='text'){event.stopPropagation();this.cancel();this._startText(painterClone(object),false);}}
  _startText(object,isNew){
    const host=svgNode('foreignObject',{x:object.x,y:object.y,width:object.width,height:object.height});
    const input=document.createElement('textarea');input.className='dui-painter__text-editor';input.setAttribute('aria-label','Text note');input.maxLength=10000;input.wrap='off';input.value=object.text;input.style.fontSize=`${object.style.fontSize}px`;
    host.append(input);this._selectionArea.append(host);this._textEdit={object,isNew,host,input};
    input.addEventListener('blur',()=>{if(this._textEdit?.input===input)this._finishText();},{once:true});input.focus();input.select();
  }
  _finishText(){const edit=this._textEdit;if(!edit)return;const object={...edit.object,text:edit.input.value};this.cancel();if(!object.text.trim()&&edit.isNew)return;
    if(this._acceptUserObject(object,edit.isNew)&&!this.destroyed)this.select(object.id,USER);
  }
  _acceptUserObject(object,isNew){
    try{painterDocument({...this._document,objects:isNew?[...this._document.objects,object]:this._document.objects.map(o=>o.id===object.id?object:o)});}
    catch(error){this.events.emit('error',{source:this,error});return false;}
    if(isNew)this.addObject(object,USER);else this.updateObject(object.id,object,USER);return true;
  }
  _key(event){if(this._mode!=='edit'||this.disabled)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.cancel();this.element.focus();return;}
    if(event.target.closest('textarea')){event.stopPropagation();if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();this._finishText();this.element?.focus();}return;}
    const mod=event.ctrlKey||event.metaKey;
    const shortcut=event.code==='KeyZ'?'z':event.code==='KeyY'?'y':event.code?'':event.key.toLowerCase();
    if(mod&&['z','y'].includes(shortcut)){event.preventDefault();event.stopPropagation();if(shortcut==='y'||event.shiftKey)this.redo(USER);else this.undo(USER);}
    else if(['Delete','Backspace'].includes(event.key)){event.preventDefault();event.stopPropagation();this.deleteSelected(USER);}
  }
  // Each marker owns a multiply plane in source order; grouping all markers
  // would change compositing against intervening ordinary annotations.
  _plane(marker=false){const d=this._document,t=this._transform,svg=svgNode('svg',{width:'100%',height:'100%',class:'dui-painter__plane'}),group=svgNode('g',{transform:`translate(${t.offsetX} ${t.offsetY}) scale(${t.scale})`}),area=svgNode('svg',{width:d.width,height:d.height,viewBox:`0 0 ${d.width} ${d.height}`,overflow:'hidden'});group.append(area);svg.append(group);if(marker){svg.style.mixBlendMode='multiply';svg.dataset.blend='marker';}return svg;}
  _render(){if(!this._area)return;const d=this._document,t=this._transform;this._transformGroup.setAttribute('transform',`translate(${t.offsetX} ${t.offsetY}) scale(${t.scale})`);
    for(const el of [this._area,this._hit]){el.setAttribute('width',d.width);el.setAttribute('height',d.height);}this._area.setAttribute('viewBox',`0 0 ${d.width} ${d.height}`);
    const plane=this._selectionPlane;plane.firstElementChild.setAttribute('transform',`translate(${t.offsetX} ${t.offsetY}) scale(${t.scale})`);
    for(const [name,value] of Object.entries({width:d.width,height:d.height,viewBox:`0 0 ${d.width} ${d.height}`}))this._selectionArea.setAttribute(name,value);
    this._objects.replaceChildren();let normal=null;
    for(const object of d.objects){const marker=object.type==='marker';if(marker||!normal){const layer=this._plane(marker);this._objects.append(layer);normal=layer.firstElementChild.firstElementChild;}normal.append(this._shape(object));if(marker)normal=null;}
    this._drawSelection();
  }
  _shape(o){
    const s=o.style,g=svgNode('g',{'data-painter-object':o.id,opacity:s.opacity});
    const attrs={stroke:s.color,'stroke-width':s.strokeWidth,'stroke-linecap':'round','stroke-linejoin':'round',fill:'none'};
    if(s.dash==='dashed')attrs['stroke-dasharray']=`${s.strokeWidth*4} ${s.strokeWidth*3}`;
    let shape;
    if(o.points){const points=o.points;shape=svgNode('path',{...attrs,d:points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')});g.append(shape);
      if(o.type==='arrow'){const [a,b]=points,angle=Math.atan2(b.y-a.y,b.x-a.x),length=Math.max(8,s.strokeWidth*4);g.append(svgNode('path',{...attrs,d:`M${b.x-length*Math.cos(angle-.45)} ${b.y-length*Math.sin(angle-.45)} L${b.x} ${b.y} L${b.x-length*Math.cos(angle+.45)} ${b.y-length*Math.sin(angle+.45)}`}));}
    }else if(o.type==='rectangle')shape=svgNode('rect',{...attrs,x:o.x,y:o.y,width:o.width,height:o.height});
    else if(o.type==='ellipse')shape=svgNode('ellipse',{...attrs,cx:o.x+o.width/2,cy:o.y+o.height/2,rx:o.width/2,ry:o.height/2});
    else {shape=svgNode('svg',{x:o.x,y:o.y,width:o.width,height:o.height,overflow:'hidden'});const text=svgNode('text',{fill:s.color,'font-size':s.fontSize,'font-family':'var(--dui-font-family, sans-serif)'});
      o.text.split('\n').forEach((line,i)=>text.append(svgNode('tspan',{x:0,y:s.fontSize*(1+i*1.2)},line)));shape.append(text);shape.append(svgNode('rect',{width:o.width,height:o.height,fill:'transparent'}));}
    if(!shape.parentNode)g.append(shape);return g;
  }
  _drawSelection(object){if(!this._selection)return;this._selection.replaceChildren();if(this._mode!=='edit'||this.disabled||this._textEdit)return;
    if(!object&&this._selectedIds.length>1){const unit=1/this._transform.scale;for(const o of this._document.objects.filter(o=>this._selectedIds.includes(o.id)))this._selection.append(svgNode('rect',{...painterBounds(o),fill:'none',stroke:'var(--dui-color-accent-bg, #1976d2)','stroke-width':unit,'stroke-dasharray':`${4*unit} ${3*unit}`}));return;}
    const selected=object??this._document.objects.find(o=>o.id===this._selected);if(!selected)return;const b=painterBounds(selected),unit=1/this._transform.scale;
    this._selection.append(svgNode('rect',{...b,fill:'none',stroke:'var(--dui-color-accent-bg, #1976d2)','stroke-width':unit,'stroke-dasharray':`${4*unit} ${3*unit}`}));
    if(this._tool==='select')for(const [key,x,y] of [['nw',b.x,b.y],['ne',b.x+b.width,b.y],['sw',b.x,b.y+b.height],['se',b.x+b.width,b.y+b.height]])this._selection.append(svgNode('rect',{'data-handle':key,x:x-4*unit,y:y-4*unit,width:8*unit,height:8*unit,fill:'var(--dui-color-bg, white)',stroke:'var(--dui-color-accent-bg, #1976d2)','stroke-width':unit,'pointer-events':'all'}));
  }
  _paintDraft(){const g=this._gesture;if(!g||!this._draft)return;
    if(g.kind==='erase'){for(const el of this._objects.querySelectorAll('[data-painter-object]'))if(g.ids.has(el.getAttribute('data-painter-object')))el.setAttribute('visibility','hidden');return;}
    if(g.kind==='area'){const layer=this._plane(),unit=1/this._transform.scale;layer.firstElementChild.firstElementChild.append(svgNode('rect',{...g.bounds,fill:'none',stroke:'var(--dui-color-accent-bg, #1976d2)','stroke-width':unit,'stroke-dasharray':`${4*unit} ${3*unit}`}));this._draft.replaceChildren(layer);return;}
    if(g.kind==='group'){const layer=this._plane();for(const o of g.drafts)layer.firstElementChild.firstElementChild.append(this._shape(o));this._draft.replaceChildren(layer);for(const el of this._objects.querySelectorAll('[data-painter-object]'))if(this._selectedIds.includes(el.getAttribute('data-painter-object')))el.setAttribute('visibility','hidden');return;}
    if(g.kind==='edit'&&!g.changed){this._draft.replaceChildren();this._drawSelection(g.draft);return;}const layer=this._plane(g.draft.type==='marker');layer.firstElementChild.firstElementChild.append(this._shape(g.draft));this._draft.replaceChildren(layer);if(g.kind==='edit')for(const el of this._objects.querySelectorAll('[data-painter-object]'))if(el.getAttribute('data-painter-object')===g.object.id)el.setAttribute('visibility','hidden');this._drawSelection(g.draft);}
  destroy(){
    if(this.destroyed||this._painterDestroying)return;
    // Mark our own teardown before releasing capture/focus: those DOM operations
    // can synchronously reenter application callbacks and this control.
    this._painterDestroying=true;
    try{this.cancel();super.destroy();}
    finally{
      this._undo=[];this._redo=[];this._document.objects=[];
      this._svg=this._area=this._objects=this._draft=this._selection=this._transformGroup=this._hit=this._selectionPlane=this._selectionArea=null;
    }
  }
}
