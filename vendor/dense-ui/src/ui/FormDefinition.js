import {Form} from './Form.js';
import {FieldGroup} from './FieldGroup.js';
import {TextInput} from './TextInput.js';
import {NumberInput} from './NumberInput.js';
import {SelectInput} from './SelectInput.js';
import {CheckBox} from './CheckBox.js';
import {Switch} from './Switch.js';
import {RadioGroup} from './RadioGroup.js';
import {DateInput,TimeInput,DateTimeInput} from './DateTimeInput.js';
import {fail,object,keys,text,name,number,choice,bool,list,json} from './definitionValidation.js';
import {editorOptions} from './definitionEditors.js';
const controls={text:TextInput,number:NumberInput,select:SelectInput,checkbox:CheckBox,
 switch:Switch,radio:RadioGroup,date:DateInput,time:TimeInput,dateTime:DateTimeInput};
function labels(spec,path,defaults={}) {
 const out={...defaults};
 if('labelPosition' in spec)out.labelPosition=choice(spec.labelPosition,['left','top'],path+'.labelPosition');
 if('labelWidth' in spec)out.labelWidth=number(spec.labelWidth,path+'.labelWidth',1,10000);
 return out;
}
/** Validate and compile without constructing controls. Groups -> rows -> fields. */
export function compileFormDefinition(input) {
 const spec=json(input);keys(spec,['schemaVersion','groups','data','labelPosition','labelWidth','width','height'],'$');
 if(spec.schemaVersion!==1)fail('schemaVersion','only version 1 is supported');
 const data=object(spec.data??{},'data'),names=new Set(),ids=new Set();let count=0;
 const options=labels(spec,'$',{labelPosition:'left'});
 if('width' in spec)options.width=spec.width==='100%'?'100%':number(spec.width,'width',1,10000);
 if('height' in spec)options.height=number(spec.height,'height',1,10000);
 const defaults=labels(spec,'$',{labelPosition:'left'});
 const groups=list(spec.groups,'groups',256).map((group,i)=>{
  const p=`groups[${i}]`;keys(group,['id','title','rows','labelPosition','labelWidth'],p);
  const id=name(group.id,p+'.id');if(ids.has(id))fail(p+'.id','duplicate group ID');ids.add(id);
  const groupOptions={...labels(group,p,defaults),width:'100%'};
  const framed='title' in group;if(framed)groupOptions.title=text(group.title,p+'.title');
  const rows=list(group.rows,p+'.rows',2000).map((row,j)=>{
   const path=`${p}.rows[${j}]`;list(row,path,24);if(!row.length)fail(path,'empty row');
   return row.map((field,k)=>{
    const fp=`${path}[${k}]`;keys(field,['name','label','editor','readOnly','disabled','labelPosition','labelWidth'],fp);
    const fieldName=name(field.name,fp+'.name');if(names.has(fieldName))fail(fp+'.name','duplicate field name');names.add(fieldName);
    if(++count>2000)fail(fp,'field count exceeds 2000');
    const compiled=editorOptions(field.editor,fp+'.editor');
    compiled.options={...compiled.options,...labels(field,fp,labels(group,p,defaults)),name:fieldName,label:fieldName};
    if('label' in field)compiled.options.label=text(field.label,fp+'.label');
    for(const key of ['readOnly','disabled'])if(key in field)compiled.options[key]=bool(field[key],fp+'.'+key);
    if(Object.hasOwn(data,fieldName)) {
     const value=data[fieldName];if(value!==null && typeof value==='object')fail('data.'+fieldName,'expected scalar field value');
     compiled.options.value=value;
    }
    return compiled;
   });
  });
  return {id,framed,options:groupOptions,rows};
 });
 for(const key of Object.keys(data))if(!names.has(key))fail('data.'+key,'unknown field');
 return {options,groups,data};
}
export function createFormFromJSON(input,{container,...host}={}) {
 keys(host,['width','height'],'host');const compiled=compileFormDefinition(input);
 const form=new Form({...compiled.options,...host});const created=[];
 try {
  for(const group of compiled.groups) {
   const owner=group.framed?new FieldGroup(group.options):new Form(group.options);created.push(owner);
   form.row(owner);
   for(const row of group.rows) {
    const fields=row.map(({type,options})=>{
     const field=new controls[type](options);created.push(field);
     if(type==='select')field.data.parse(options.items,{silent:true,origin:'import'});
     return field;
    });
    owner.row(...fields);
   }
   owner.setCleanValue(owner.value.get(),{silent:true,origin:'import'});
  }
  form.setCleanValue(form.value.get(),{silent:true,origin:'import'});
  if(container!==undefined)form.mount(container);
  return form;
 }catch(error){
  form.destroy();
  // A failed constructor/row attachment can leave a control outside the owner tree.
  for(const control of created.reverse())if(!control.destroyed)control.destroy();
  throw error;
 }
}
