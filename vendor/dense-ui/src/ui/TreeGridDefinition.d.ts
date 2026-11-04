import type {TreeGrid} from './TreeGrid.js';
import type {TreeGridOptions} from './grid-options.js';
import type {GridDefinition,GridDefinitionColumn,GridDefinitionRow,GridDefinitionRegistry,GridDefinitionHost} from './GridDefinition.js';
import type {TreeDefinitionOptions} from './TreeDefinition.js';
export interface TreeGridDefinition extends Omit<GridDefinition,'columns'|'paging'|'rowReorder'> {
 columns:Omit<GridDefinitionColumn,'summary'>[];tree?:TreeDefinitionOptions;treeColumnId?:string;
}
export declare function compileTreeGridDefinition(input:unknown,registry?:GridDefinitionRegistry):{
 options:TreeGridOptions<GridDefinitionRow,string|number>;data:GridDefinitionRow[];sort?:{columnId:string;direction:'asc'|'desc'}[]
};
export declare function createTreeGridFromJSON(input:unknown,host?:GridDefinitionHost):TreeGrid<GridDefinitionRow,string|number>;
