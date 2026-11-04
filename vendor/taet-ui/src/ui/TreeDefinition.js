import {TreeList} from './TreeList.js';
import {fail,keys,bool,json} from './definitionValidation.js';
import {dimensions,treeOptions,treeData,mountTree} from './treeDefinitionSupport.js';
export function compileTreeDefinition(input) {
 const spec=json(input);keys(spec,['schemaVersion','data','tree','selection','nodeReorder','width','height'],'$');
 if(spec.schemaVersion!==1)fail('schemaVersion','only version 1 is supported');
 const options=treeOptions(spec.tree);dimensions(spec,options);
 options.nodeReorder='nodeReorder' in spec?bool(spec.nodeReorder,'nodeReorder'):false;
 if('selection' in spec){keys(spec.selection,['multiple'],'selection');if('multiple' in spec.selection)options.multiSelect=bool(spec.selection.multiple,'selection.multiple');}
 return {options,data:treeData(spec.data,options)};
}
export function createTreeFromJSON(input,host={}) {return mountTree(TreeList,compileTreeDefinition(input),host);}
