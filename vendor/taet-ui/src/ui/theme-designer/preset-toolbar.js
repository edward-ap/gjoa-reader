import {Toolbar,ToolButton,Dialog,TextInput,LabelText} from '../all.js';
import {serialize,deserialize} from './serialization.js';
import {generateTheme} from './theme-generator.js';
import {callHost as defaultCallHost,connectHost} from './host-api.js';
export {connectHost};
export function createPresetToolbar(host,api){
 const callHost=api.callHost??defaultCallHost;
 const toolbar=new Toolbar(host,{name:'Preset actions'}),buttons={},abort=new AbortController();
 let busy=false,disposed=false,dialog=null;
 const presetName=new LabelText({text:'',css:'preset-name'});
 const alive=()=>{if(disposed)throw new DOMException('Editor closed','AbortError');};
 const ask=async(title,text,{name}={})=>{
  const input=name!==undefined?new TextInput({label:'Preset name',value:name,width:'100%'}):null;
  const d=new Dialog({title,content:input??text,destroyContent:true,buttons:[{text:'OK',result:'ok',primary:true},{text:'Cancel',result:'cancel'}]});dialog=d;
  try{const promise=d.showModal();if(input)queueMicrotask(()=>{if(!disposed)input.focus();});const result=await promise;alive();return result==='ok'?(input?input.value.get().trim():true):null;}finally{d.destroy();if(input&&!input.destroyed)input.destroy();dialog=null;}
 };
 const named=async(title,definition,suggestion='')=>{
  const name=await ask(title,'',{name:suggestion});if(name===null)return;
  if(!name||name.length>80)throw Error('Use a preset name between 1 and 80 characters.');
  api.create(name,definition);
 };
 const pick=async purpose=>{
  const directory=await callHost('getPresetDirectory',{signal:abort.signal});alive();if(directory==null)return null;
  const record=await callHost('openPresetExplorer',{directory,purpose,signal:abort.signal});alive();
  if(record==null)return null;
  if(typeof record.name!=='string'||!record.name.trim()||record.name.length>80)throw Error('Host returned an invalid preset name.');
  return {...record,definition:deserialize(serialize(record.definition))};
 };
 const actions={
  New:()=>named('New preset',api.current().definition),
  Open:async()=>{const p=await pick('open');if(p)api.open(p);},
  Save:async()=>{const p=api.current();if(p.readOnly)throw Error('This recovery preset is read-only. Use New or Copy.');if(await ask('Save preset',`Save changes to "${p.name}"?`))api.save(p);},
  Copy:async()=>{const p=await pick('copy');if(p)await named('Copy preset',p.definition,p.name+' copy');},
  Import:()=>{file.value='';file.click();},
  Export:()=>{
   const p=api.current(),text=JSON.stringify({format:'taet-ui-theme',version:1,name:p.name,definition:JSON.parse(serialize(p.definition))},null,2);
   const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=p.name.replace(/[^a-z0-9_-]/gi,'-')+'.taet-theme.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  Delete:async()=>{const p=api.current();if(p.readOnly)throw Error('This recovery preset is read-only.');if(await ask('Delete preset',`Permanently delete "${p.name}"?`))api.remove(p);},
  Apply:async()=>{const p=api.current();await callHost('applyPreset',{preset:{name:p.name,definition:JSON.parse(serialize(p.definition))},theme:generateTheme(p.definition),signal:abort.signal});alive();api.message('Preset applied by the host application.','success');}
 };
 async function run(action){if(busy||disposed)return;busy=true;refresh();try{await action();}catch(e){if(!disposed&&e.name!=='AbortError')api.message(e.message);}finally{busy=false;if(!disposed)refresh();}}
 const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;toolbar.element.append(file);
 file.addEventListener('change',()=>run(async()=>{
  const selected=file.files[0];if(!selected)return;if(selected.size>24000)throw Error('Theme file is too large.');
  const text=await selected.text();alive();const data=JSON.parse(text);
  if(data.format!==undefined&&(!['taet-ui-theme','dense-ui-theme'].includes(data.format)||data.version!==1))throw Error('Unsupported theme file format.');
  const definition=deserialize(data.format?JSON.stringify(data.definition):text);
  await named('Import preset',definition,typeof data.name==='string'?data.name:'Imported theme');
 }),{signal:abort.signal});
 for(const [name,icon] of [['New','add'],['Open','folder'],['Save','save'],['Copy','copy'],['Import','import'],['Export','export'],['Delete','trash'],['Apply','check']]){
  if(name==='Apply'){toolbar.add(presetName);if(api.scoped)presetName.element.dataset.designerRef='preset-current';else presetName.element.id='preset-current';presetName.element.setAttribute('aria-label','Current preset');}
  const button=new ToolButton({text:name,tooltip:name,icon,shape:'square',css:'preset-action preset-action--'+name.toLowerCase(),onClick:()=>run(actions[name])});buttons[name]=button;toolbar.add(button);
  if(['New','Open','Copy','Export'].includes(name))toolbar.addSeparator();
 }
 function refresh(){const p=api.current(),readonly=p.readOnly;presetName.setText(p.name);presetName.element.title=p.name+(readonly?' · Read-only recovery preset':'');for(const [name,button] of Object.entries(buttons))button[busy||(readonly&&['Save','Delete'].includes(name))?'disable':'enable']();}
 refresh();return {refresh,destroy(){disposed=true;abort.abort();dialog?.destroy();toolbar.destroy();}};
}
