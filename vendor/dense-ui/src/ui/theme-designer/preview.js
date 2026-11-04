import {Form,FieldGroup,TextInput,SelectInput,CheckBox,RadioGroup,Switch,TrackBar,ProgressBar,Button,CheckButton,Panel,TabBar,Grid,DateInput,TimeInput,StepProgressBar,LabelText} from '../all.js';
import {required} from '../../core/validators.js';
import {ThemeScopes,partCSS} from './theme-scopes.js';
export function createPreview(root) {
const api={},abort=new AbortController();
const adapter=document.createElement('style');adapter.textContent=partCSS;root.append(adapter);
const scopes=new ThemeScopes(),owners=[];
function host(){const el=document.createElement('div');el.className='preview-section';root.append(el);return el;}
function panel(id,parentScope,parentControl,{title,window=false,kind='panel'}={}){
 const control=parentControl?new Panel():new Panel(host());
 if(parentControl)parentControl.add(control);else owners.push(control);
 control.element.classList.add('scope-panel');
 scopes.register(control,{id,parent:parentScope,kind,window,parts:'panel',label:title??id});
 if(title)control.add(new LabelText({text:title,css:'scope-heading'}));
 return control;
}
// Exactly four visual levels, regardless of Form or FieldGroup DOM wrappers.
const main=panel('application',null,null,{title:'Project workspace',window:true,kind:'workspace'});
main.element.querySelector('.scope-heading').classList.add('preview-header');
main.add(new StepProgressBar({items:['Source','Mapping','Validate','Export'],selectedIndex:1}));
const tabsArea=panel('tabs','application',main,{kind:'tabs'});
const tabs=new TabBar({tabs:[{id:'form',text:'Form'},{id:'table',text:'Table'}],activeId:'form'});tabsArea.add(tabs);
const formLayout=panel('form-layout','tabs',tabsArea,{title:'Contact workspace'});
const tableLayout=panel('table-layout','tabs',tabsArea,{title:'Files workspace'});
for(const p of [formLayout,tableLayout])p.element.classList.add('preview-page');
tableLayout.element.hidden=true;
const form=new Form({labelWidth:80,width:'100%'});formLayout.add(form);
scopes.register(form,{id:'contact',parent:'form-layout',kind:'panel',label:'Contact form'});
const flag=shapes=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16" width="24" height="16">${shapes}</svg>`);
const select=new SelectInput({label:'Country',valueField:'id',textField:'text',imageField:'flag',searchable:true,searchPlaceholder:'Find country',popupHeight:180});
select.data.parse([
 {id:'fr',text:'France',flag:flag('<path fill="#fff" d="M0 0h24v16H0z"/><path fill="#002654" d="M0 0h8v16H0z"/><path fill="#ed2939" d="M16 0h8v16h-8z"/>')},
 {id:'de',text:'Germany',flag:flag('<path fill="#ffce00" d="M0 0h24v16H0z"/><path fill="#d00" d="M0 0h24v10.667H0z"/><path fill="#000" d="M0 0h24v5.333H0z"/>')},
 {id:'jp',text:'Japan',flag:flag('<path fill="#fff" d="M0 0h24v16H0z"/><circle fill="#bc002d" cx="12" cy="8" r="4.8"/>')}
]);select.value.set('fr');
const invalid=new TextInput({label:'Required',value:'',required:true,validators:[required('A value is required')]});
const group=new FieldGroup({title:'Contact information',labelWidth:80,width:'100%'});
const quality=new TrackBar({label:'Quality',min:0,max:100,value:68,showValue:true,thumbShape:'grip'});
const progress=new ProgressBar({label:'Progress',value:68,showText:true});
quality.disposables.add(quality.events.on('change',e=>progress.value.set(e.newValue)));
progress.disposables.add(progress.events.on('change',e=>quality.value.set(e.newValue,{silent:true})));
group.row(new TextInput({label:'Name',placeholder:'First Name',autocomplete:'given-name'}),new TextInput({label:'Last name',placeholder:'Last Name',autocomplete:'family-name',css:'preview-last-name'})).row(select).row(new CheckBox({label:'Enabled',text:'Receive updates',value:true})).row(new RadioGroup({label:'Mode',layout:'flow',items:[{value:'auto',description:'Auto'},{value:'manual',description:'Manual'}],value:'auto'})).row(new Switch({label:'Notify',value:true})).row(quality).row(progress).row(new DateInput({label:'Date',value:'2026-09-12'}),new TimeInput({label:'Time',value:'14:30',css:'preview-time'})).row(invalid);
form.row(group);invalid.validate();
scopes.register(group,{id:'contact-group',parent:'contact',boundary:false,parts:'panel',label:'Contact information'});
const actions=new Panel({width:'100%'});form.row(actions);
actions.element.classList.add('preview-actions');actions.add(new CheckButton({text:'Review',value:true,css:'preview-review'}),new Button({text:'Save changes'}),new Button({text:'Default',css:'preview-default'}),new Button({text:'Disabled',disabled:true}));
const defaultButton=actions.element.querySelector('.preview-default');for(const suffix of ['bg','bg-hover','bg-active','border','text'])defaultButton.style.setProperty(`--dui-command-button-${suffix}`,`var(--dui-button-${suffix})`);
const grid=new Grid({height:230,width:'100%',columns:[{id:'name',title:'Name',width:230},{id:'status',title:'Status',width:130}]});tableLayout.add(grid);
scopes.register(grid,{id:'files',parent:'table-layout',kind:'grid',parts:'grid',label:'Files table'});
grid.data.parse([{id:1,name:'Project overview',status:'Selected'},{id:2,name:'Documentation',status:'Ready'},{id:3,name:'Release notes',status:'Pending'},{id:4,name:'Archive',status:'Ready'}]);grid.setSelectedIds([1]);
tabs.events.on('change',e=>{formLayout.element.hidden=e.id!=='form';tableLayout.element.hidden=e.id!=='table';});
const statuses=new Panel();tabsArea.add(statuses);statuses.element.classList.add('statuses');
for(const [kind,text] of [['invalid','Error: missing value'],['warning','Warning: unsaved changes'],['success','Success: file uploaded ✓'],['info','Info: preview is interactive']]){
 const label=new LabelText({text,css:'status'});statuses.add(label);label.element.style.background=`var(--dui-color-${kind}-bg)`;label.element.style.borderColor=`var(--dui-color-${kind}-border)`;label.element.style.color=`var(--dui-on-${kind==='invalid'?'error':kind}, var(--dui-color-text))`;
}
let appliedTokens=[],inspectedAnchor=null;
api.anchorScopes=anchor=>[...scopes.entries.values()].filter(entry=>entry.boundary&&scopes.result?.definition.roles?.[scopes.states?.get(entry.id)?.role]===anchor).map(entry=>({label:entry.label,depth:scopes.states.get(entry.id).depth}));
api.highlightAnchor=anchor=>{inspectedAnchor=anchor;for(const entry of scopes.entries.values()){const state=scopes.states?.get(entry.id);entry.element.classList.toggle('distribution-highlight',Boolean(anchor&&entry.boundary&&state?.role&&scopes.result?.definition.roles[state.role]===anchor));}};

api.setScopeLabels=show=>root.classList.toggle('show-scope-labels',show);
api.applyTheme=result=>{scopes.clearOverrides();for(const name of appliedTokens)if(!(name in result.tokens))root.style.removeProperty(name);appliedTokens=Object.keys(result.tokens);for(const [name,value] of Object.entries(result.tokens))root.style.setProperty(name,value);root.style.colorScheme=result.definition.foundation??'light';root.dataset.foundation=result.definition.foundation??'clear';scopes.apply(result);api.highlightAnchor(inspectedAnchor);};
root.dataset.ready='true';
api.destroy=()=>{abort.abort();scopes.destroy();owners.reverse().forEach(c=>c.destroy());adapter.remove();};

function anchorAt(target){let entry=scopes.entries.get(target?.closest?.('[data-dui-scope-id]')?.dataset.duiScopeId);while(entry&&!entry.boundary)entry=scopes.entries.get(entry.parent);const role=entry&&scopes.states?.get(entry.id)?.role;return role?scopes.result?.definition.roles[role]??null:null;}
root.addEventListener('pointerover',e=>api.onAnchorHover?.(anchorAt(e.target)),{signal:abort.signal});
root.addEventListener('pointerout',e=>api.onAnchorHover?.(anchorAt(e.relatedTarget)),{signal:abort.signal});

return api;
}
