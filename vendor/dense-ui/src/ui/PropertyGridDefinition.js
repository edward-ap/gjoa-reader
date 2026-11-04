import {PropertyGrid} from './PropertyGrid.js';
import {fail,object,keys,text,name,number,choice,bool,list,json} from './definitionValidation.js';
import {editor} from './definitionEditors.js';
import {dimensions} from './treeDefinitionSupport.js';
const definitions=new WeakMap();
export function compilePropertyGridDefinition(input) {
 const spec=json(input);keys(spec,['schemaVersion','groups','data','showCategories','sortMode','labelWidth','width','height'],'$');
 if(spec.schemaVersion!==1)fail('schemaVersion','only version 1 is supported');
 const data=object(spec.data??{},'data'),names=new Set(),groupIds=new Set();let count=0;
 function properties(items,path,depth=0) {
  if(depth>16)fail(path,'property depth exceeds 16');
  return list(items,path,2000).map((item,i)=>{
   const p=`${path}[${i}]`;keys(item,['name','label','description','readOnly','editor','children'],p);
   const id=name(item.name,p+'.name');if(names.has(id))fail(p+'.name','duplicate property name');names.add(id);
   if(++count>2000)fail(path,'property count exceeds 2000');
   const out={name:id,path:id,type:'readonly',value:Object.hasOwn(data,id)?data[id]:null};
   for(const key of ['label','description'])if(key in item)out[key]=text(item[key],p+'.'+key);
   if('readOnly' in item)out.readOnly=bool(item.readOnly,p+'.readOnly');
   if('editor' in item) {
    out.editor=editor(item.editor,p+'.editor');
    out.type=item.editor.type==='checkbox'?'boolean':item.editor.type;
    if(item.editor.items)out.options=item.editor.items;
   }
   if('children' in item)out.children=properties(item.children,p+'.children',depth+1);
   return out;
  });
 }
 const groups=list(spec.groups,'groups',256).map((group,i)=>{
  const p=`groups[${i}]`;keys(group,['id','title','properties'],p);const id=name(group.id,p+'.id');
  if(groupIds.has(id))fail(p+'.id','duplicate group ID');groupIds.add(id);
  return {id,name:id,title:text(group.title,p+'.title'),properties:properties(group.properties,p+'.properties')};
 });
 for(const key of Object.keys(data))if(!names.has(key))fail('data.'+key,'unknown property');
 const options={source:{groups}};dimensions(spec,options);
 if('showCategories' in spec)options.showCategories=bool(spec.showCategories,'showCategories');
 if('sortMode' in spec)options.sortMode=choice(spec.sortMode,['categorized','alphabetical','none'],'sortMode');
 if('labelWidth' in spec)options.labelWidth=number(spec.labelWidth,'labelWidth',1,10000);
 return {options,names:[...names]};
}
export function createPropertyGridFromJSON(input,{container,...host}={}) {
 keys(host,['width','height'],'host');const compiled=compilePropertyGridDefinition(input);
 const grid=new PropertyGrid({...compiled.options,...host});
 try {if(container!==undefined)grid.mount(container);definitions.set(grid,new Map(compiled.names.map(key=>[key,grid.getPropertyControl(key).property])));return grid;}
 catch(error){grid.destroy();throw error;}
}
/** Snapshot committed values only. Editing drafts are not implicitly committed. */
export function getPropertyGridValues(grid) {
 if(!definitions.has(grid) || grid.destroyed)throw new TypeError('Expected a live JSON-created PropertyGrid');
 const values={};
 for(const [key,property] of definitions.get(grid)) {
  const row=grid.getPropertyControl(key);
  if(!row || row.property!==property)throw new Error('PropertyGrid definition was replaced; create a new JSON adapter');
  values[key]=row.property.value;
 }
 return json(values);
}
