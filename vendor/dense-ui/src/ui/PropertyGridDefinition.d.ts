import type {PropertyGrid,PropertyGridOptions} from './collection-contracts.js';
import type {GridDefinitionEditor} from './GridDefinition.js';
import type {DefinitionHost} from './TreeDefinition.js';
export interface JSONPropertyDefinition {
 name:string;label?:string;description?:string;readOnly?:boolean;
 editor?:GridDefinitionEditor;children?:JSONPropertyDefinition[];
}
export interface PropertyGridDefinition {
 schemaVersion:1;groups:{id:string;title:string;properties:JSONPropertyDefinition[]}[];
 data?:Record<string,unknown>;showCategories?:boolean;sortMode?:'categorized'|'alphabetical'|'none';
 labelWidth?:number;width?:number|'100%';height?:number;
}
export declare function compilePropertyGridDefinition(input:unknown):{options:PropertyGridOptions;names:string[]};
export declare function createPropertyGridFromJSON(input:unknown,host?:DefinitionHost):PropertyGrid;
export declare function getPropertyGridValues(grid:PropertyGrid):Record<string,unknown>;
