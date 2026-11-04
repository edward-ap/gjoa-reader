import {BaseControl} from 'dense-ui/foundation';
import {RenderViewport, type RasterRenderer} from '../../extensions/viewport/index.js';
import {Painter, type PainterDocument} from '../../extensions/painter/index.js';
const renderer:RasterRenderer=async request=>{request.signal.throwIfAborted();return {image:new OffscreenCanvas(request.targetWidth,request.targetHeight)};};
const view=new RenderViewport({renderer,onRenderError:event=>console.error(event.error)});
const base:BaseControl=view;view.events.on('renderComplete',event=>console.log(event.request.targetWidth));
const painter=new Painter({areaWidth:800,areaHeight:1120});const model:PainterDocument=painter.getDocument();painter.importJSON(model,{silent:true});painter.events.on('change',event=>console.log(event.document.kind));
void base;
