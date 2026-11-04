/** Pure, bounded Painter document geometry. No DOM or application dependencies. */
export const painterTools=['select','area-select','eraser','pen','marker','line','arrow','rectangle','square','ellipse','circle','text'];
export const painterClone=value=>JSON.parse(JSON.stringify(value));
const finite=(v,name,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new TypeError(`Invalid ${name}.`);return v;};
export function painterStyle(style={}) {
  const color=style.color??'#202020';if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))throw new TypeError('Color must be #RRGGBB.');
  if(style.dash!==undefined&&!['solid','dashed'].includes(style.dash))throw new TypeError('Invalid stroke dash.');
  return {color,strokeWidth:finite(style.strokeWidth??2,'strokeWidth',.1,1000),opacity:finite(style.opacity??1,'opacity',0,1),fontSize:finite(style.fontSize??20,'fontSize',1,1000),...(style.dash==='dashed'?{dash:'dashed'}:{})};
}
export function painterSize(width,height){return {width:finite(width,'width',1,1000000),height:finite(height,'height',1,1000000)};}
export function painterTransform(value={}) {return {scale:finite(value.scale??1,'scale',.0001,10000),offsetX:finite(value.offsetX??0,'offsetX',-1e9,1e9),offsetY:finite(value.offsetY??0,'offsetY',-1e9,1e9)};}
export function painterBounds(object) {
  if(!object.points)return {x:object.x,y:object.y,width:object.width,height:object.height};
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const p of object.points){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
  return {x,y,width:right-x,height:bottom-y};
}
export function painterDocument(input) {
  if(!input||input.kind!=='DenseUI.Painter'||input.version!==1)throw new TypeError('Unsupported Painter document.');
  const size=painterSize(input.width,input.height),ids=new Set();let pointCount=0;
  if(!Array.isArray(input.objects)||input.objects.length>5000)throw new RangeError('Painter allows at most 5000 objects.');
  const objects=Array.from(input.objects,source=>{
    if(!source||typeof source.id!=='string'||!source.id.length||source.id.length>128||ids.has(source.id))throw new TypeError('Object IDs must be unique nonempty strings.');ids.add(source.id);
    if(!['pen','marker','line','arrow','rectangle','ellipse','text'].includes(source.type))throw new TypeError('Invalid Painter object type.');
    const object={id:source.id,type:source.type,style:painterStyle(source.style)};
    if(['pen','marker','line','arrow'].includes(source.type)){
      if(!Array.isArray(source.points)||!source.points.length||source.points.length>10000||(['line','arrow'].includes(source.type)&&source.points.length!==2))throw new TypeError('Invalid object points.');
      pointCount+=source.points.length;if(pointCount>200000)throw new RangeError('Painter point limit exceeded.');
      object.points=Array.from(source.points,p=>({x:finite(p?.x,'point.x',0,size.width),y:finite(p?.y,'point.y',0,size.height)}));
    }else{
      object.x=finite(source.x,'x',0,size.width);object.y=finite(source.y,'y',0,size.height);
      object.width=finite(source.width,'object width',0,size.width);object.height=finite(source.height,'object height',0,size.height);
      if(object.x+object.width>size.width+1e-7||object.y+object.height>size.height+1e-7)throw new RangeError('Object outside logical area.');
      if(source.type==='text'){if(typeof source.text!=='string'||source.text.length>10000)throw new TypeError('Invalid text.');object.text=source.text;}
    }
    return object;
  });
  return {kind:'DenseUI.Painter',version:1,...size,objects};
}
export function painterRemap(object,from,to) {
  const result=painterClone(object);
  if(result.points)result.points=result.points.map(p=>({x:to.x+(from.width?(p.x-from.x)*to.width/from.width:from.height?(p.y-from.y)*to.width/from.height:0),y:to.y+(from.height?(p.y-from.y)*to.height/from.height:from.width?(p.x-from.x)*to.height/from.width:0)}));
  else Object.assign(result,to);
  return result;
}
export const painterClamp=(v,min,max)=>Math.max(min,Math.min(max,v));
