import {createNotice} from './notice.js';
import {createPresetToolbar} from './preset-toolbar.js';
import {CircularSlider,LabelText,RGBColorPicker,Switch,CheckBox,TrackBar,IconButton,RadioLetter} from '../all.js';
import {generateTheme} from './theme-generator.js';
import {presets} from './theme-presets.js';
import {hues} from './harmony.js';
import {withRayCount} from './wheel-geometry.js';
import {HarmonyStack} from './stack.js';
import {stackBindings,moveStack} from './stack-model.js';
import {HarmonyWheel} from './wheel.js';
import {MAX_CHROMA,sourceColor,setBaseHex} from './base-color.js';
import {spectrumColors} from './wheel-spectrum.js';
import {editorDefinition} from './editor-model.js';
import {createHostConnection} from './host-api.js';
export function createEditor(root,options={}) {
const maxColors=options.maxColors??4;
const normalize=input=>editorDefinition(input,maxColors);
const find=selector=>root.querySelector(selector.replace(/#([\w-]+)/g,'[data-designer-ref="$1"]'))??root.querySelector(selector);
const body=options.body??root,storage=options.storage??null,hostConnection=createHostConnection(options.host);
const getPreview=()=>options.preview??preview.contentWindow;
const owners=[],fields={},storageKey='taet-ui.theme-editor.v1',legacyStorageKey='dense-ui.theme-editor.v1';
let lastReported='',changeMeta={origin:'api',userAction:false};
let definition=loadPreset(presets[0]),result,frame=null,disposed=false,custom=[],selected='builtin:0',inspectedRay='a';
const notice=createNotice(root,options.notificationDuration);owners.push(notice);
const preview=find('#preview');
function attempt(action){try{action();}catch(e){notice.show(e.message);}}
try{const saved=JSON.parse(storage?.getItem(storageKey)??storage?.getItem(legacyStorageKey)??'[]');if(!Array.isArray(saved)||saved.length>50)throw Error('Invalid preset storage');custom=saved.map(p=>{if(typeof p.name!=='string'||typeof p.id!=='string')throw Error('Invalid preset');return {id:p.id,name:p.name.slice(0,80),deleted:p.deleted===true,definition:normalize(p.definition)};});}catch(e){notice.show(`Saved presets unavailable: ${e.message}`);}
const own=c=>(owners.push(c),c);
own(new LabelText(find('#distribution-caption'),{text:'Distribution'}));
own(new LabelText(find('#theme-caption'),{text:'Theme'}));



// Always edit a copy: built-in recovery presets and stored presets stay untouched.
function loadPreset(p){const d=normalize(p.definition);if(d.preset!=='clear')d.lockBase=true;return d;}
function clearDraft(){const d=loadPreset(presets[0]);setBaseHex(d,generateTheme({version:2,preset:'clear'}).tokens['--dui-window-header-bg']);return d;}
function editable(){if(definition.preset==='clear')definition=clearDraft();}
function modify(fn){changeMeta={origin:'user',userAction:true};editable();const draft=structuredClone(definition);fn(draft);definition=normalize(draft);}
function records(){return [...presets.map((p,i)=>({...p,id:`builtin:${i}`})).map(p=>p.readOnly?p:(custom.find(c=>c.id===p.id)??p)),...custom.filter(p=>!p.id.startsWith('builtin:'))].filter(p=>!p.deleted);}
function current(){const p=records().find(p=>p.id===selected);return {...p,definition:structuredClone(definition)};}
function persist(next){if(next.length>50)throw Error('Maximum 50 saved presets.');storage?.setItem(storageKey,JSON.stringify(next));custom=next;}
function refreshPresets(){toolbar.refresh();}
function choose(p){changeMeta={origin:'api',userAction:false};selected=p.id;definition=loadPreset(p);refreshPresets();schedule();}
function create(name,d){if(records().some(p=>p.name.toLowerCase()===name.toLowerCase()))throw Error('A preset with this name already exists.');const p={id:'custom:'+crypto.randomUUID(),name,definition:normalize(d)};persist([...custom,p]);choose(p);notice.show('Preset created locally.','success');}
if(options.toolbar===false)find('#preset-toolbar').hidden=true;
const toolbar=options.toolbar===false?{refresh(){}}:own(createPresetToolbar(find('#preset-toolbar'),{
 scoped:Boolean(options.preview),callHost:hostConnection.callHost,current,message:(text,kind)=>notice.show(text,kind),create,
 open:p=>{const match=records().find(r=>r.name.toLowerCase()===p.name.toLowerCase());if(match?.readOnly){choose(match);return;}if(match){definition=loadPreset(p);selected=match.id;refreshPresets();schedule();}else create(p.name,p.definition);},
 save:p=>{if(p.readOnly)throw Error('Recovery preset is read-only.');persist([...custom.filter(c=>c.id!==p.id),{id:p.id,name:p.name,definition:p.definition}]);notice.show('Preset saved locally.','success');},
 remove:p=>{if(p.readOnly)throw Error('Recovery preset is read-only.');const next=custom.filter(c=>c.id!==p.id);if(p.id.startsWith('builtin:'))next.push({...p,deleted:true});persist(next);choose({...presets[0],id:'builtin:0'});notice.show('Preset deleted.','success');}
}));
// The host can connect after the editor loads; no parent application is assumed.

const foundation=own(new Switch(find('#foundation-toggle'),{label:'Dark foundation',offIcon:'theme-light',onIcon:'theme-dark',offText:'Light',onText:'Dark',value:false}));
foundation.element.title='Light / dark foundation';
foundation.events.on('change',e=>{modify(d=>d.foundation=e.newValue?'dark':'light');schedule();});
for(const [key,label] of [['surfaceTint','Surface'],['borderContrast','Border'],['stateIntensity','State']]) {
 const control=own(new CircularSlider(find('#ui-dials'),{label,min:0,max:100,step:1}));
 fields[key]=control;
 control.events.on('change',()=>{if(disposed)return;modify(d=>d[key]=control.value.get()/100);schedule();});
}
function useSpectrum(d){if(d.accentSource!=='spectrum'){d.accentSource='spectrum';d.chroma=1;}}
function changeHarmony(h){modify(d=>{useSpectrum(d);if(hues(h).length!==hues(d.harmony).length)d.roles=stackBindings(d.roles,hues(h).length);d.harmony=h;});schedule();}
const less=own(new IconButton(find('#wheel-center'),{text:'Fewer rays',icon:'chevron-left',onClick:()=>{editable();changeHarmony(withRayCount(definition.harmony,hues(definition.harmony).length-1));}}));
const rayCount=own(new RadioLetter(find('#wheel-center'),{items:[{value:'count',letter:'1',description:''}],readOnly:true}));rayCount.element.setAttribute('aria-live','polite');let shownRayCount=1;
const more=own(new IconButton(find('#wheel-center'),{text:'More rays',icon:'chevron-right',onClick:()=>{editable();changeHarmony(withRayCount(definition.harmony,hues(definition.harmony).length+1));}}));
less.element.setAttribute('aria-label','Fewer rays');more.element.setAttribute('aria-label','More rays');
const hueSlider=own(new TrackBar(find('#base-hue'),{label:'Base hue',orientation:'vertical',min:0,max:359.9,step:.1,thumbShape:'line'}));
const saturationSlider=own(new TrackBar(find('#base-saturation'),{label:'Saturation',orientation:'vertical',min:0,max:100,step:1,thumbShape:'line'}));
const lightness=own(new TrackBar(find('#base-lightness'),{label:'Lightness',orientation:'vertical',min:0,max:100,step:1,thumbShape:'line'}));
// Decorative captions retain explicit accessible slider names and native tooltips.
for(const [control,name,kind] of [[hueSlider,'Base hue','hue'],[lightness,'Lightness','lightness'],[saturationSlider,'Saturation','saturation']]){
 const caption=control.element.querySelector('.dui-trackbar__label');caption.textContent='';caption.classList.add('synth-slider-icon','synth-slider-icon--'+kind);caption.setAttribute('aria-hidden','true');caption.title=name;control.element.title=name;control.element.querySelector('input').setAttribute('aria-label',name);
 if(kind!=='hue'){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',kind==='lightness'?'M12 3V1M12 23v-2M3 12H1M23 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0':'M12 2C10 6 5 11 5 15a7 7 0 0 0 14 0c0-4-5-9-7-13zM9 16c0 2 1 3 3 3');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.6');path.setAttribute('stroke-linecap','round');svg.append(path);caption.append(svg);
 }
}
const baseHex=own(new RGBColorPicker(find('#base-fields'),{label:'Base color RGB',value:'#000000',labelPosition:'top',allowEmpty:false}));
const lockBase=own(new CheckBox(find('#base-lock'),{text:'Lock',value:false}));lockBase.element.title='Keep A fixed while dragging the wheel. In four-ray mode the opposite C stays fixed too.';
lockBase.events.on('change',()=>{modify(d=>d.lockBase=lockBase.value.get());schedule();});
function ensureTone(d){d.accentSource='spectrum';d.chroma=1;}
hueSlider.events.on('change',()=>{modify(d=>{ensureTone(d);d.harmony.baseHue=hueSlider.value.get();});schedule();});
saturationSlider.events.on('change',()=>{modify(d=>{ensureTone(d);d.baseTone.C=saturationSlider.value.get()/100*MAX_CHROMA;});schedule();});
lightness.events.on('change',()=>{modify(d=>{ensureTone(d);d.baseTone.L=lightness.value.get()/100;});schedule();});
baseHex.events.on('change',()=>{attempt(()=>{modify(d=>setBaseHex(d,baseHex.value.get()));schedule();});});
find('#base-hue').style.setProperty('--hue-gradient','linear-gradient(to top,'+spectrumColors.filter((_,i)=>i%3===0).join(',')+')');
const stack=own(new HarmonyStack(find('#harmony-stack'),(from,to)=>{modify(d=>d.roles=moveStack(d.roles,hues(d.harmony).length,from,to));schedule();},anchor=>{if(disposed)return;getPreview().highlightAnchor?.(anchor);wheel.highlight(anchor);}));
const wheel=new HarmonyWheel(find('#wheel'),h=>changeHarmony(h),id=>{inspectedRay=id;stack.select(id);schedule();},id=>stack.hover(id));
function sync(){
 const d=definition.preset==='clear'?clearDraft():definition,h=d.harmony;
 const values={surfaceTint:d.surfaceTint*100,borderContrast:d.borderContrast*100,stateIntensity:d.stateIntensity*100};

 for(const [key,value] of Object.entries(values))fields[key].value.set(value,{silent:true});
 foundation.value.set(d.foundation==='dark',{silent:true});
 const count=hues(h).length;if(count!==shownRayCount){rayCount.setItems([{value:'count',letter:String(count),description:''}],{silent:true});shownRayCount=count;}less[count===1?'disable':'enable']();more[count>=maxColors?'disable':'enable']();
 const color=sourceColor(d,h.baseHue).hex,tone=d.baseTone;hueSlider.value.set(h.baseHue,{silent:true});saturationSlider.value.set(tone.C/MAX_CHROMA*100,{silent:true});lightness.value.set(tone.L*100,{silent:true});baseHex.value.set(color,{silent:true});lightness.element.title=`Lightness · OKLCH L ${tone.L.toFixed(4)}`;saturationSlider.element.title=`Saturation · requested OKLCH C ${tone.C.toFixed(4)} (100% = ${MAX_CHROMA})`;
 lockBase.value.set(d.lockBase??false,{silent:true});
 stack.setDefinition(d);
 wheel.setDefinition(d,Math.max(0,['a','b','c','d'].indexOf(inspectedRay)));
}
function updateInspectionTooltips(){
 const d=result.definition;if(d.preset==='clear')return;
 const angles=hues(d.harmony);
 for(let i=0;i<angles.length;i++){
  const id='abcd'[i],hex=sourceColor(d,angles[i]).hex,uses=getPreview().anchorScopes?.(id)??[];
  const depths=[...new Set(uses.map(s=>s.depth))].sort((a,b)=>a-b);
  const description=`Anchor ${id.toUpperCase()}\nHEX ${hex}\nDepth level ${depths.join(', ')||'—'}\nApplied to: ${[...new Set(uses.map(s=>s.label))].join(', ')||'—'}`;
  for(const {panel,button,bar} of stack.levels)if(panel.element.dataset.anchor===id){panel.element.title=description;button.element.title=description;bar.element.title=description;}
 }
}
function render(){if(frame!==null)cancelAnimationFrame(frame);frame=null;if(disposed)return;const started=performance.now();result=generateTheme(definition);definition=result.definition;sync();
 getPreview().onAnchorHover=id=>stack.hover(id);getPreview().applyTheme?.(result);updateInspectionTooltips();const previewName=find('#preview-name');if(previewName)previewName.textContent=definition.preset==='clear'?'Clear (reference)':definition.foundation;
 toolbar.refresh();body.dataset.ready='true';const signature=JSON.stringify(current());if(signature!==lastReported){lastReported=signature;options.onRender?.(structuredClone(current()),structuredClone(result),changeMeta);}body.dataset.renderMs=(performance.now()-started).toFixed(2);
}
function schedule(){if(frame===null&&!disposed)frame=requestAnimationFrame(render);}
if(!options.preview)preview.addEventListener('load',schedule);
refreshPresets();render();
return Object.freeze({
 connectHost:hostConnection.connectHost,
 getPresets:()=>records().map(p=>({...structuredClone(p),definition:normalize(p.definition)})),
 getPreset:()=>structuredClone(current()),
 getTheme:()=>structuredClone(generateTheme(definition)),
 setPreset(p){
  changeMeta={origin:'api',userAction:false};
  if(disposed)throw Error('Theme Designer is destroyed');
  if(typeof p?.name!=='string'||!p.name.trim()||p.name.length>80)throw Error('Invalid preset name');
  const draft=normalize(p.definition),match=records().find(r=>r.name===p.name);
  if(match?.readOnly){choose(match);render();return;}
  if(match){selected=match.id;definition=draft;}else{if(custom.length>=50)throw Error('Maximum 50 presets.');const item={id:'external:'+crypto.randomUUID(),name:p.name,definition:draft};custom.push(item);selected=item.id;definition=draft;}
  refreshPresets();render();
 },
 destroy(){if(disposed)return;disposed=true;preview?.removeEventListener('load',schedule);if(frame!==null)cancelAnimationFrame(frame);wheel.destroy();owners.reverse().forEach(c=>c.destroy());hostConnection.destroy();}
});
}
