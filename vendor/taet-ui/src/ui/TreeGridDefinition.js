import {TreeGrid} from './TreeGrid.js';
import {compileGridDefinition} from './GridDefinition.js';
import {fail,object,keys,name,list,json} from './definitionValidation.js';
import {treeOptions,treeData,mountTree} from './treeDefinitionSupport.js';
export function compileTreeGridDefinition(input,registry={}) {
 const spec=json(input);keys(spec,['schemaVersion','columns','data','tree','treeColumnId','selection','sort','width','height'],'$');
 if(spec.schemaVersion!==1)fail('schemaVersion','only version 1 is supported');
 const {tree,treeColumnId,...gridSpec}=spec;
 list(spec.columns,'columns',256).forEach((col,i)=>{
  object(col,`columns[${i}]`);
  if('summary' in col)fail(`columns[${i}].summary`,'TreeGrid does not support summaries');
  if(col && col.editor && (col.field??col.id)==='parentId')fail(`columns[${i}].editor`,'parent identity is not editable');
 });
 if(spec.sort && list(spec.sort,'sort',1).length>1)fail('sort','TreeGrid supports one sibling sort');
 const compiled=compileGridDefinition(gridSpec,registry);
 Object.assign(compiled.options,treeOptions(tree));
 if(treeColumnId!==undefined) {
  name(treeColumnId,'treeColumnId');
  if(!compiled.options.columns.some(c=>c.id===treeColumnId))fail('treeColumnId','unknown column');
  compiled.options.treeColumnId=treeColumnId;
 }
 compiled.sort=compiled.options.sortModel;delete compiled.options.sortModel;
 treeData(compiled.data,compiled.options);return compiled;
}
export function createTreeGridFromJSON(input,{formatters,...host}={}) {return mountTree(TreeGrid,compileTreeGridDefinition(input,{formatters}),host);}
