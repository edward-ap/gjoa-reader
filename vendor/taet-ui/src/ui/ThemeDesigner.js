import {BaseControl} from '../core/BaseControl.js';
import {createEditor} from './theme-designer/editor.js';
import {editorDefinition} from './theme-designer/editor-model.js';
import {createPreview} from './theme-designer/preview.js';
import {markup,styles,previewStyles,compactStyles} from './theme-designer/template.js';

// Static, trusted CSS and markup. No scripts, frames, requests or user HTML.
function scope(css, selector) {
 return css.replace(/(^|})([^{}]+)\{/g, (_,end,group)=>end+group.split(',').map(s=>(s.trim()===':host'?selector:s.trim().startsWith('.preview-root')?selector+s.trim():selector+' '+s.trim())).join(',')+'{');
}
export class ThemeDesigner extends BaseControl {
 constructor(containerOrOptions={},maybeOptions) {
  const mounted=typeof containerOrOptions==='string'||(typeof HTMLElement!=='undefined'&&containerOrOptions instanceof HTMLElement);
  const options=mounted?maybeOptions??{}:containerOrOptions;
  if(options.maxColors!==undefined&&(!Number.isInteger(options.maxColors)||options.maxColors<1||options.maxColors>4))throw new RangeError('maxColors must be an integer from 1 to 4');
  if(options.preset){
   if(typeof options.preset.name!=='string'||!options.preset.name.trim()||options.preset.name.length>80)throw Error('Invalid preset name');
   editorDefinition(options.preset.definition,options.maxColors);
  }
  super({ ...options, width:options.width??(options.preview?null:550) });this._controller=null;this._preview=null;
  this._bindOptionEvent('change',options.onChange);
  if(mounted)this.mount(containerOrOptions);
 }
 createElement(){
  const root=document.createElement('div');root.className='dui-control dui-theme-designer';root.dataset.duiControlId=this.id;
  root.style.cssText='min-width:0;min-height:0;overflow:auto;position:relative';
  const style=document.createElement('style');
  style.textContent=scope((styles+compactStyles).replace(/#([\w-]+)/g,(match,id)=>(id==='preset-current'||markup.includes('id="'+id+'"'))?'[data-designer-ref="'+id+'"]':match),'.dui-theme-designer')+scope(previewStyles,'.dui-theme-designer-preview');
  const body=document.createElement('div');body.className='designer dui-page dui-profile-compact';body.inert=this.disabled;
  body.innerHTML=markup.replace(/id="([^"]+)"/g,'data-designer-ref="$1"');
  if(!this.options.preview)body.classList.add('designer--compact');
  root.append(style,body);
  const previewHost=body.querySelector('[data-designer-ref="preview"]');
  if(this.options.preview){
  const previewRoot=document.createElement('div');previewRoot.className='preview-root dui-page dui-theme-designer-preview dui-profile-compact';previewHost.append(previewRoot);
  this._preview=createPreview(previewRoot);
  }else{previewHost.closest('.preview-column').remove();}
  const feedback=this._preview??{};
  this._controller=createEditor(body,{preview:feedback,toolbar:this.options.toolbar,maxColors:this.options.maxColors,host:this.options.host,storage:this.options.storage,notificationDuration:this.options.notificationDuration,
   onRender:(preset,theme,meta)=>{if(this.mounted&&!this.destroyed)this.events.emit('change',{source:this,preset,theme,...meta});}});
  if(this.options.preset)this._controller.setPreset(this.options.preset);
  return root;
 }
 _editor(){this._assertMutable('ThemeDesigner');if(!this._controller)throw Error('Mount ThemeDesigner before using its editor API');return this._controller;}
 getPreset(){return this._editor().getPreset();}
 getTheme(){return this._editor().getTheme();}
 getPresets(){return this._editor().getPresets();}
 setPreset(preset){this._editor().setPreset(preset);return this;}
 connectHost(host){return this._editor().connectHost(host);}
 disable(){super.disable();const body=this.element?.querySelector('.designer');if(body)body.inert=true;return this;}
 enable(){super.enable();const body=this.element?.querySelector('.designer');if(body)body.inert=false;return this;}
 destroy(){if(this.destroyed)return;this._controller?.destroy();this._preview?.destroy();this._controller=null;this._preview=null;super.destroy();}
}
