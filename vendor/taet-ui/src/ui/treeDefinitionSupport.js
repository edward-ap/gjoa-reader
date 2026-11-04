import {fail,object,keys,name,number,bool,list} from './definitionValidation.js';
import {icons} from './Icon.js';
export function dimensions(spec,options) {
 if('width' in spec)options.width=spec.width==='100%'?'100%':number(spec.width,'width',1,10000);
 options.height='height' in spec?number(spec.height,'height',1,10000):280;
}
export function identity(value,path) {
 if(typeof value!=='string' && typeof value!=='number')fail(path,'expected string/number ID');
 if(typeof value==='number')number(value,path);return value;
}
export function treeOptions(spec={}) {
 keys(spec,['textField','iconField','expandedIds','expandAll','expandOnClick'],'tree');const options={};
 for(const key of ['textField','iconField'])if(key in spec)options[key]=name(spec[key],'tree.'+key);
 for(const key of ['expandAll','expandOnClick'])if(key in spec)options[key]=bool(spec[key],'tree.'+key);
 if('expandedIds' in spec)options.expandedIds=list(spec.expandedIds,'tree.expandedIds',50000).map((id,i)=>identity(id,`tree.expandedIds[${i}]`));
 if(options.expandAll && options.expandedIds)fail('tree','use expandAll or expandedIds, not both');return options;
}
// Complete flat forests only. Parent links and IDs are typed; no orphan promotion.
export function treeData(data=[],options={}) {
 list(data,'data',50000);const byId=new Map();
 data.forEach((row,i)=>{
  const p=`data[${i}]`;object(row,p);identity(row.id,p+'.id');
  if(byId.has(row.id))fail(p+'.id','duplicate node ID');byId.set(row.id,row);
  if(row.parentId!=null)identity(row.parentId,p+'.parentId');
  const icon=row[options.iconField??'icon'];
  if(icon!=null && (typeof icon!=='string' || !icons.has(icon)))fail(p+'.icon','unknown registered icon');
 });
 const done=new Map();
 for(const row of data) {
  const chain=[],visiting=new Set();let current=row;
  while(current && !done.has(current.id)) {
   if(visiting.has(current.id))fail('data.parentId','cycle in hierarchy');
   visiting.add(current.id);chain.push(current);
   if(chain.length>128)fail('data.parentId','tree depth exceeds 128');
   if(current.parentId==null) {current=null;break;}
   const parent=byId.get(current.parentId);if(!parent)fail('data.parentId',`missing parent for ${current.id}`);current=parent;
  }
  let depth=current?done.get(current.id):0;
  for(let i=chain.length-1;i>=0;i--) {if(++depth>128)fail('data.parentId','tree depth exceeds 128');done.set(chain[i].id,depth);}
 }
 return data;
}
export function mountTree(Control,compiled,host) {
 const {container,...options}=host;keys(options,['width','height'],'host');
 const control=new Control({...compiled.options,...options,expandAll:false});
 try {
  control.data.parse(compiled.data,{origin:'import'});
  if(compiled.options.expandAll)control.expandAll({silent:true,origin:'import'});
  if(compiled.sort?.length)control.sortBy(compiled.sort[0].columnId,compiled.sort[0].direction,{silent:true,origin:'import'});
  if(container!==undefined)control.mount(container);return control;
 } catch(error) {control.destroy();throw error;}
}
