import {hexToLch,toGamut} from './color-math.js';
// Effective sRGB colors first, relative luminance second. No OKLCH threshold.
export function parseColor(value) {
 if(typeof value==='object' && value!==null) {
  const c={r:value.r,g:value.g,b:value.b,a:value.a??1};
  if(Object.values(c).some(v=>!Number.isFinite(v)) || ['r','g','b'].some(k=>c[k]<0||c[k]>255)||c.a<0||c.a>1)throw Error('Invalid RGBA color');return c;
 }
 const text=String(value).trim();
 if(/^#[a-f\d]{3,4}$/i.test(text))return parseColor('#'+[...text.slice(1)].map(v=>v+v).join(''));
 if(/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(text)){const parts=text.slice(1).match(/../g).map(v=>parseInt(v,16));return {r:parts[0],g:parts[1],b:parts[2],a:(parts[3]??255)/255};}
 const match=text.match(/^rgba?\((.+)\)$/i);
 if(match){const parts=match[1].split(/[\s,\/]+/).filter(Boolean);if(parts.length<3||parts.length>4||parts.some(p=>!/^[-+]?(?:\d+\.?\d*|\.\d+)%?$/.test(p)))throw Error('Invalid rgb color');const channel=v=>v.endsWith('%')?parseFloat(v)*2.55:Number(v);const alpha=v=>v.endsWith('%')?parseFloat(v)/100:Number(v);return parseColor({r:channel(parts[0]),g:channel(parts[1]),b:channel(parts[2]),a:parts[3]===undefined?1:alpha(parts[3])});}
 throw Error(`Unsupported color: ${text}`);
}
export function composite(color,underlay) {
 const c=parseColor(color),b=parseColor(underlay),a=c.a+b.a*(1-c.a);
 return {r:a?(c.r*c.a+b.r*b.a*(1-c.a))/a:0,g:a?(c.g*c.a+b.g*b.a*(1-c.a))/a:0,b:a?(c.b*c.a+b.b*b.a*(1-c.a))/a:0,a};
}
export function relativeLuminance(color) {
 const c=parseColor(color);if(c.a!==1)throw Error('Luminance requires an effective opaque color');
 const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
 return .2126*linear(c.r)+.7152*linear(c.g)+.0722*linear(c.b);
}
export function effectivePair(foreground,background) {
 const descriptor=typeof background==='object'&&'color' in background?background:{color:background};
 const raw=parseColor(descriptor.color),opacity=descriptor.opacity??1;
 if(!Number.isFinite(opacity)||opacity<0||opacity>1)throw Error('Invalid layer opacity');
 if((raw.a<1||opacity<1)&&descriptor.over===undefined)throw Error('Translucent backgrounds require an explicit opaque underlay');
 const under=descriptor.over===undefined?raw:parseColor(descriptor.over);
 if(under.a!==1)throw Error('Underlay must be opaque');
 const bg=composite(raw,under),fg=composite(foreground,bg);
 return {background:composite({...bg,a:opacity},under),foreground:composite({...fg,a:opacity},under)};
}
export function effectiveContrast(foreground,background) {
 const pair=effectivePair(foreground,background),a=relativeLuminance(pair.foreground),b=relativeLuminance(pair.background);
 return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
export function resolveForeground({backgrounds,current,foundation='light',textDark='#171a1d',textLight='#ffffff',target=4.5}) {
 if(!backgrounds?.length)throw Error('A foreground family needs backgrounds');
 const score=color=>Math.min(...backgrounds.map(bg=>effectiveContrast(color,bg)));
 if(current && score(current)>=target)return {foreground:current,score:score(current),reason:'current',needsBackgroundAdjustment:false};
 const preferred=foundation==='dark'?[textLight,textDark]:[textDark,textLight];
 for(const candidate of preferred)if(score(candidate)>=target)return {foreground:candidate,score:score(candidate),reason:'theme candidate',needsBackgroundAdjustment:false};
 const fallback=foundation==='dark'?['#ffffff','#000000']:['#000000','#ffffff'];
 for(const candidate of fallback)if(score(candidate)>=target)return {foreground:candidate,score:score(candidate),reason:'pure fallback',needsBackgroundAdjustment:false};
 const best=[...new Set([...preferred,...fallback])].sort((a,b)=>score(b)-score(a))[0];
 return {foreground:best,score:score(best),reason:'background correction required',needsBackgroundAdjustment:true};
}

// Accent polarity is a design preference, bounded independently of contrast safety.
// Only derived, opaque backgrounds are changed; anchors never enter this function.
export function resolveAccentFamily({backgrounds,current,foundation='light',target=4.5,polarity='auto',maxLightnessCorrection=.16}) {
 const tones=backgrounds.map(hexToLch);
 const chromatic=tones[0].C>=.035;
 if(polarity==='auto'&&!chromatic)return {...resolveForeground({backgrounds,current,foundation,target}),backgrounds:[...backgrounds]};
 const foreground=polarity==='dark'?'#000000':'#ffffff',direction=polarity==='dark'?1:-1;
 const corrected=backgrounds.map((bg,i)=>{
  if(effectiveContrast(foreground,bg)>=target)return bg;
  const tone=tones[i],limit=Math.max(0,Math.min(1,tone.L+direction*maxLightnessCorrection));
  const at=L=>toGamut({...tone,L}).hex;
  if(effectiveContrast(foreground,at(limit))<target)return null;
  let fail=tone.L,pass=limit;
  for(let n=0;n<24;n++){const mid=(fail+pass)/2;if(effectiveContrast(foreground,at(mid))>=target)pass=mid;else fail=mid;}
  return at(pass);
 });
 if(corrected.every(Boolean))return {foreground,backgrounds:corrected,score:Math.min(...corrected.map(bg=>effectiveContrast(foreground,bg))),reason:corrected.some((bg,i)=>bg!==backgrounds[i])?'preferred polarity with bounded L correction':'preferred polarity',needsBackgroundAdjustment:false};
 return {...resolveForeground({backgrounds,current,foundation,target}),backgrounds:[...backgrounds],reason:'opposite polarity: preferred correction exceeds L budget'};
}
