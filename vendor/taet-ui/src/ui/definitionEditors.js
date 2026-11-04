import { required } from "../core/validators.js";
import { gridEditors } from "./GridEditors.js";
import {fail,keys,text,name,number,integer,choice,bool,list} from "./definitionValidation.js";
function editorOptions(spec,path) {
  keys(spec,['type','required','placeholder','min','max','step','items'],path);
  const type=choice(spec.type,['text','number','select','checkbox','switch','radio','date','time','dateTime'],path+'.type');
  const options={};
  if ('required' in spec) options.required=bool(spec.required,path+'.required');
  if(options.required)options.validators=[required()];
  if ('placeholder' in spec) options.placeholder=text(spec.placeholder,path+'.placeholder');
  for (const key of ['min','max','step']) if (key in spec) {
    if(type!=='number')fail(path+'.'+key,'only number editors support this property');
    options[key]=number(spec[key],path+'.'+key); if(key==='step' && options[key]<=0)fail(path+'.step','must be positive');
  }
  if(options.min>options.max)fail(path,'min exceeds max');
  if ('items' in spec || ['select','radio'].includes(type)) {
    if(!['select','radio'].includes(type))fail(path+'.items','only select/radio support items');
    const values=new Set();
    if(type==='select')options.valueField='value';
    options.items=list(spec.items,path+'.items',1000).map((item,i)=>{
      const p=`${path}.items[${i}]`;keys(item,['value','text'],p);
      if(!(type==='select'?['string','number']:['string','number','boolean']).includes(typeof item.value))fail(p+'.value','unsupported choice value type');
      if(values.has(item.value))fail(p+'.value','duplicate choice value');values.add(item.value);
      return {value:item.value,text:text(item.text,p+'.text')};
    });
  }
  return {type,options};
}
function editor(spec,path) {
  const {type,options}=editorOptions(spec,path);
  return gridEditors[type](options);
}
function formatter(spec,path,registry) {
  keys(spec,['type','name','locale','currency','minimumFractionDigits','maximumFractionDigits','trueText','falseText'],path);
  const type=choice(spec.type,['number','currency','percent','boolean','registered'],path+'.type');
  const allowed= type==='registered'?['type','name']:type==='boolean'?['type','trueText','falseText']:['type','locale','minimumFractionDigits','maximumFractionDigits',...(type==='currency'?['currency']:[])];
  keys(spec,allowed,path);
  if(type==='registered') {
    const id=name(spec.name,path+'.name');
    const fn=Object.hasOwn(registry,id)?registry[id]:null;
    if(typeof fn!=='function')fail(path+'.name',`unknown client formatter ${id}`);
    return (value,row,index)=>String(fn(value,row,index) ?? '');
  }
  if(type==='boolean') {
    const yes=spec.trueText===undefined?'Yes':text(spec.trueText,path+'.trueText');
    const no=spec.falseText===undefined?'No':text(spec.falseText,path+'.falseText');
    return value=>value==null?'':value===true?yes:value===false?no:String(value);
  }
  const options={style:type==='number'?'decimal':type};
  if(type==='currency')options.currency=text(spec.currency,path+'.currency');
  for(const key of ['minimumFractionDigits','maximumFractionDigits']) if(key in spec) options[key]=integer(spec[key],path+'.'+key,0,20);
  const locale=spec.locale===undefined?'en-US':text(spec.locale,path+'.locale');
  let intl;try {intl=new Intl.NumberFormat(locale,options);}catch {fail(path,'invalid locale or number format options');}
  return value=>value==null || value===''?'':typeof value==='number'?intl.format(value):String(value);
}


export {editor,editorOptions,formatter};
