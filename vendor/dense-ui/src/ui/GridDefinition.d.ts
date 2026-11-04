import type { Grid } from './Grid.js';
import type { GridOptions } from './grid-options.js';
export type GridDefinitionRow = {id: string | number} & Record<string, unknown>;
export type GridDefinitionEditor = {required?:boolean; placeholder?:string} & (
 | {type:'text'|'checkbox'|'switch'|'date'|'time'|'dateTime'}
 | {type:'number'; min?:number; max?:number; step?:number}
 | {type:'select'; items:{value:string|number; text:string}[]}
 | {type:'radio'; items:{value:string|number|boolean; text:string}[]}
);
export type GridDefinitionFormat =
 | {type:'number'|'percent'; locale?:string; minimumFractionDigits?:number; maximumFractionDigits?:number}
 | {type:'currency'; currency:string; locale?:string; minimumFractionDigits?:number; maximumFractionDigits?:number}
 | {type:'boolean'; trueText?:string; falseText?:string}
 | {type:'registered'; name:string};
export interface GridDefinitionColumn {
 id:string; field?:string; title?:string; width?:number; minWidth?:number; maxWidth?:number;
 dataType?:'text'|'number'|'boolean'|'date'; align?:'left'|'center'|'right';
 hidden?:boolean; frozen?:'left'|'right'|null; sortable?:boolean; filterable?:boolean;
 resizable?:boolean; editable?:boolean; editor?:GridDefinitionEditor; format?:GridDefinitionFormat;
 summary?:'count'|'total'|'min'|'max'|'average' | {kind:'count'|'total'|'min'|'max'|'average';scope?:'page'|'filtered'|'all'|'selection'};
}
export interface GridDefinition {
 schemaVersion:1; columns:GridDefinitionColumn[]; data?:GridDefinitionRow[];
 selection?:{multiple?:boolean;range?:'rows'|'cells'}; paging?:{pageSize:number};
 sort?:{columnId:string;direction:'asc'|'desc'}[];
 rowReorder?:boolean; width?:number|'100%'; height?:number;
}
export interface GridDefinitionRegistry {
 formatters?: Record<string,(value:unknown,row:GridDefinitionRow,index:number)=>string|number|boolean|null|undefined>;
}
export interface GridDefinitionHost extends GridDefinitionRegistry {container?:HTMLElement|string;width?:number|string;height?:number|string;}
/** Accepts untrusted JSON text or JSON values; validates and copies them. No controls mounted. */
export declare function compileGridDefinition(input:unknown, registry?:GridDefinitionRegistry):{options:GridOptions<GridDefinitionRow,string|number>;data:GridDefinitionRow[]};
/** Returns an owned-by-caller Grid; destroy it with its screen. */
export declare function createGridFromJSON(input:unknown, host?:GridDefinitionHost):Grid<GridDefinitionRow,string|number>;
