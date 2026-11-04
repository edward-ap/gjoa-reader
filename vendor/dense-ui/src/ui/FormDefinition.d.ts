import type {Form,FormOptions} from './container-contracts.js';
import type {GridDefinitionEditor} from './GridDefinition.js';
import type {DefinitionHost} from './TreeDefinition.js';
export interface JSONFormLabels {labelPosition?:'left'|'top';labelWidth?:number}
export interface JSONFormField extends JSONFormLabels {
 name:string;label?:string;editor:GridDefinitionEditor;readOnly?:boolean;disabled?:boolean;
}
export interface JSONFormGroup extends JSONFormLabels {id:string;title?:string;rows:JSONFormField[][]}
export interface FormDefinition extends JSONFormLabels {
 schemaVersion:1;groups:JSONFormGroup[];data?:Record<string,string|number|boolean|null>;
 width?:number|'100%';height?:number;
}
export interface CompiledFormDefinition {
 options:FormOptions;data:Record<string,string|number|boolean|null>;
 groups:{id:string;framed:boolean;options:FormOptions & {title?:string};rows:{type:GridDefinitionEditor['type'];options:Record<string,unknown>}[][]}[];
}
export declare function compileFormDefinition(input:unknown):CompiledFormDefinition;
export declare function createFormFromJSON(input:unknown,host?:DefinitionHost):Form;
