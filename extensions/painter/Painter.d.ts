import {BaseControl} from 'dense-ui/foundation';
import type {BaseControlOptions,ControlEvent,MutationOptions} from 'dense-ui/foundation';
export type PainterTool='select'|'area-select'|'eraser'|'pen'|'marker'|'line'|'arrow'|'rectangle'|'square'|'ellipse'|'circle'|'text';
export interface PainterPoint {x:number;y:number}
export interface PainterStyle {color:string;strokeWidth:number;opacity:number;fontSize:number;dash?:'solid'|'dashed'}
export interface PainterTransform {scale:number;offsetX:number;offsetY:number}
interface PainterBase {id:string;style:PainterStyle}
export type PainterObject=(PainterBase&{type:'pen'|'marker'|'line'|'arrow';points:PainterPoint[]})|(PainterBase&{type:'rectangle'|'ellipse';x:number;y:number;width:number;height:number})|(PainterBase&{type:'text';x:number;y:number;width:number;height:number;text:string});
type Draft<T>=T extends PainterObject?Omit<T,'id'|'style'>&{id?:string;style?:Partial<PainterStyle>}:never;
export type PainterObjectInput=Draft<PainterObject>;
export interface PainterDocument {kind:'DenseUI.Painter';version:1;width:number;height:number;objects:PainterObject[]}
export interface PainterEvents {
 error:{source:Painter;error:Error};
 change:ControlEvent<Painter>&{document:PainterDocument};
 selectionChange:ControlEvent<Painter>&{id:string|null;ids:string[]};
 historyChange:ControlEvent<Painter>&{canUndo:boolean;canRedo:boolean};
}
export interface PainterOptions extends BaseControlOptions<Painter> {areaWidth?:number;areaHeight?:number;mode?:'view'|'edit';tool?:PainterTool;toolSettings?:Partial<PainterStyle>;transform?:Partial<PainterTransform>;historyLimit?:number;label?:string}
export declare class Painter extends BaseControl<PainterEvents,HTMLElement> {
 constructor(options?:PainterOptions);constructor(container:string|HTMLElement,options?:PainterOptions);
 readonly mode:'view'|'edit';readonly tool:PainterTool;readonly selectedId:string|null;readonly canUndo:boolean;readonly canRedo:boolean;
 readonly selectedIds:string[];
 getDocument():PainterDocument;getTransform():PainterTransform;getToolSettings():PainterStyle;
 setMode(mode:'view'|'edit'):this;setTool(tool:PainterTool):this;setToolSettings(settings:Partial<PainterStyle>):this;
 setTransform(transform:Partial<PainterTransform>):this;setAreaSize(width:number,height:number,options?:MutationOptions):this;
 logicalToViewport(x:number,y:number):PainterPoint;viewportToLogical(x:number,y:number):PainterPoint;
 exportJSON():string;importJSON(input:PainterDocument|string,options?:MutationOptions):this;
 addObject(object:PainterObjectInput,options?:MutationOptions):string;
 updateObject(id:string,patch:Partial<PainterObjectInput>,options?:MutationOptions):boolean;
 select(id:string|null,options?:MutationOptions):boolean;deleteSelected(options?:MutationOptions):boolean;clear(options?:MutationOptions):this;
 selectMany(ids:string[],options?:MutationOptions):boolean;
 undo(options?:MutationOptions):boolean;redo(options?:MutationOptions):boolean;cancel():this;
}
