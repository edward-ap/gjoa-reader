import type {TreeList,TreeListOptions} from './collection-contracts.js';
import type {GridDefinitionRow} from './GridDefinition.js';
export interface TreeDefinitionOptions {
 textField?:string; iconField?:string; expandedIds?:(string|number)[];
 expandAll?:boolean; expandOnClick?:boolean;
}
export interface TreeDefinition {
 schemaVersion:1; data?:GridDefinitionRow[]; tree?:TreeDefinitionOptions;
 selection?:{multiple?:boolean}; nodeReorder?:boolean; width?:number|'100%'; height?:number;
}
export interface DefinitionHost {container?:HTMLElement|string; width?:number|string; height?:number|string}
export declare function compileTreeDefinition(input:unknown):{options:TreeListOptions<GridDefinitionRow,string|number>;data:GridDefinitionRow[]};
export declare function createTreeFromJSON(input:unknown,host?:DefinitionHost):TreeList<GridDefinitionRow,string|number>;
