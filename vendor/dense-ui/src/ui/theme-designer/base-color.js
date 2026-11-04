import {hexToLch,normalizeHue,toGamut} from './color-math.js';
import {spectrumColor} from './wheel-spectrum.js';
export function hexToHsl(hex){
 if(!/^#[a-f\d]{6}$/i.test(hex))throw Error('Use RGB hex format #RRGGBB.');
 const [r,g,b]=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,l=(max+min)/2;
 const h=!delta?0:normalizeHue(60*(max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4));
 return {h,s:delta?delta/(1-Math.abs(2*l-1)):0,l};
}
export function hslToHex(h,s,l){const a=s*Math.min(l,1-l);return '#'+[0,8,4].map(n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');}).join('');}
// HSL helpers above are used only to migrate previously saved prototype definitions.
export const MAX_CHROMA=.4;
export function sourceColor(d,H){
 if(!d.baseTone)return spectrumColor(H);
 const {L,C}=d.baseTone;
 // Preserve the requested C in the model. Only the displayed sRGB result is mapped.
 return toGamut({L,C,H});
}
export function setBaseHex(d,hex){
 if(!/^#[a-f\d]{6}$/i.test(hex))throw Error('Use RGB hex format #RRGGBB.');
 const {L,C,H}=hexToLch(hex),neutral=C<1e-6;
 d.baseTone={space:'oklch',L,C:neutral?0:C};d.accentSource='spectrum';d.chroma=1;
 if(!neutral)d.harmony.baseHue=H;
}
export function migrateTone(tone,H){
 const hex=hslToHex(hexToHsl(spectrumColor(H).hex).h,tone.s,tone.l),color=hexToLch(hex);
 return {tone:{space:'oklch',L:color.L,C:color.C<1e-6?0:color.C},H:color.C<1e-6?H:color.H};
}
export const sectorWidth=saturation=>saturation<.05?0:Math.max(0,Math.min(1,saturation))*18;
