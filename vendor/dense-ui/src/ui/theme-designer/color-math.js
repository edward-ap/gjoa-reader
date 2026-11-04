// OKLab matrices: Björn Ottosson, public-domain reference implementation:
// https://bottosson.github.io/posts/oklab/ (2021 matrix revision).
export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const normalizeHue = h => ((h % 360) + 360) % 360;
const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const encoded = v => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
export function hexToLch(hex) {
  const [r,g,b] = hex.match(/[a-f\d]{2}/gi).map(v => linear(parseInt(v,16)/255));
  const l = Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m = Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s = Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  const L = .2104542553*l+.793617785*m-.0040720468*s;
  const a = 1.9779984951*l-2.428592205*m+.4505937099*s;
  const bb = .0259040371*l+.7827717662*m-.808675766*s;
  return {L,C:Math.hypot(a,bb),H:normalizeHue(Math.atan2(bb,a)*180/Math.PI)};
}
export function lchToLinear({L,C,H}) {
  const a=C*Math.cos(H*Math.PI/180), b=C*Math.sin(H*Math.PI/180);
  const l=(L+.3963377774*a+.2158037573*b)**3;
  const m=(L-.1055613458*a-.0638541728*b)**3;
  const s=(L-.0894841775*a-1.291485548*b)**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
}
export function toGamut(color) {
  const value={L:clamp(color.L),C:Math.max(0,color.C),H:normalizeHue(color.H)};
  const inside = c => lchToLinear(c).every(v=>v>=-1e-7 && v<=1+1e-7);
  let lo=0,hi=value.C;
  if(!inside(value)) {
    for(let i=0;i<22;i++){const mid=(lo+hi)/2;if(inside({...value,C:mid}))lo=mid;else hi=mid;}
    value.C=lo;
  }
  const hex='#'+lchToLinear(value).map(v=>Math.round(clamp(encoded(v))*255).toString(16).padStart(2,'0')).join('');
  return {...value,hex,clamped:value.C<color.C-1e-6};
}
export function contrast(a,b) {
  const luminance = hex => {
    const [r,g,b]=hex.match(/[a-f\d]{2}/gi).map(v=>linear(parseInt(v,16)/255));
    return .2126*r+.7152*g+.0722*b;
  };
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
