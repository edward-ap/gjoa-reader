import { Grid } from "./Grid.js";
import {fail,object,keys,text,name,number,integer,choice,bool,list,json} from "./definitionValidation.js";
import {editor,formatter} from "./definitionEditors.js";

/** Validate a JSON definition completely before constructing any live controls. */
export function compileGridDefinition(input, {formatters={}}={}) {
  const spec=json(input);
  keys(spec,['schemaVersion','columns','data','selection','paging','sort','width','height','rowReorder'],'$');
  if(spec.schemaVersion!==1)fail('schemaVersion','only version 1 is supported');
  const options={};const ids=new Set();
  options.columns=list(spec.columns,'columns',256).map((col,i)=>{
    const p=`columns[${i}]`;
    keys(col,['id','field','title','width','minWidth','maxWidth','dataType','align','hidden','frozen','sortable','filterable','resizable','editable','editor','format','summary'],p);
    const id=name(col.id,p+'.id');if(ids.has(id))fail(p+'.id','duplicate column id');ids.add(id);
    const out={id};
    for(const key of ['field','title'])if(key in col)out[key]=key==='field'?name(col[key],p+'.'+key):text(col[key],p+'.'+key);
    for(const key of ['width','minWidth','maxWidth'])if(key in col)out[key]=number(col[key],p+'.'+key,1,10000);
    if(out.minWidth>out.maxWidth)fail(p,'minWidth exceeds maxWidth');
    for(const key of ['hidden','sortable','filterable','resizable'])if(key in col)out[key]=bool(col[key],p+'.'+key);
    if('editable' in col) { out.readOnly=!bool(col.editable,p+'.editable'); if(col.editable && !col.editor)fail(p+'.editable','requires an editor'); }
    if('dataType' in col)out.dataType=choice(col.dataType,['text','number','boolean','date'],p+'.dataType');
    if('align' in col)out.align=choice(col.align,['left','center','right'],p+'.align');
    if('frozen' in col)out.frozen=choice(col.frozen,['left','right',null],p+'.frozen');
    if('editor' in col) {
      if((out.field??id)==='id')fail(p+'.editor','record identity is not editable');
      out.editor=editor(col.editor,p+'.editor');
      out.dataType??=col.editor.type==='number'?'number':['checkbox','switch'].includes(col.editor.type)?'boolean':'text';
    }
    if('format' in col)out.render=formatter(col.format,p+'.format',formatters);
    if('summary' in col) {
      const summary=typeof col.summary==='string'?{kind:col.summary}:col.summary;
      keys(summary,['kind','scope'],p+'.summary');
      out.summary={kind:choice(summary.kind,['count','total','min','max','average'],p+'.summary.kind'),scope:choice(summary.scope??'filtered',['page','filtered','all','selection'],p+'.summary.scope')};
      if(out.summary.kind!=='count' && out.dataType!=='number')fail(p+'.summary','numeric summaries require dataType number');
    }
    return out;
  });
  if(!options.columns.length)fail('columns','at least one column is required');
  if('selection' in spec){keys(spec.selection,['multiple','range'],'selection');if('multiple' in spec.selection)options.multiSelect=bool(spec.selection.multiple,'selection.multiple');if('range' in spec.selection)options.rowRangeSelection=choice(spec.selection.range,['rows','cells'],'selection.range')==='rows';}
  if('paging' in spec){keys(spec.paging,['pageSize'],'paging');options.statusBar={pagination:{pageSize:integer(spec.paging.pageSize,'paging.pageSize',1,50000)}};}
  if('sort' in spec)options.sortModel=list(spec.sort,'sort',256).map((rule,i)=>{
    const p=`sort[${i}]`;keys(rule,['columnId','direction'],p);
    if(!options.columns.some(c=>c.id===rule.columnId && c.sortable))fail(p+'.columnId','requires a sortable column');
    return {columnId:rule.columnId,direction:choice(rule.direction,['asc','desc'],p+'.direction')};
  });
  if('rowReorder' in spec)options.rowReorder=bool(spec.rowReorder,'rowReorder');
  if('width' in spec)options.width=spec.width==='100%'?'100%':number(spec.width,'width',1,10000);
  options.height='height' in spec?number(spec.height,'height',1,10000):280;
  const data=list(spec.data??[],'data',50000), rowIds=new Set();
  data.forEach((row,i)=>{
    object(row,`data[${i}]`);
    if(!Object.hasOwn(row,'id') || !['number','string'].includes(typeof row.id))fail(`data[${i}].id`,'requires a string or finite number ID');
    if(rowIds.has(row.id))fail(`data[${i}].id`,'duplicate row id');rowIds.add(row.id);
  });
  return {options,data};
}

export function createGridFromJSON(input, {container,formatters,...host}={}) {
  keys(host,['width','height'],'host');
  const compiled=compileGridDefinition(input,{formatters});
  const grid=new Grid({...compiled.options,...host});
  try {
    grid.data.parse(compiled.data,{origin:'import'});
    if(container!==undefined)grid.mount(container);
    return grid;
  } catch(error) {grid.destroy();throw error;}
}
