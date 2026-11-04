// Prototype semantic policy: weights describe chroma influence, never pixel area.
export const roleDistribution = Object.freeze({
 P: Object.freeze({weight:1,usage:'Structural accent, commands, focus, window headers and main progress'}),
 S: Object.freeze({weight:.70,usage:'Selection family; a limited interactive accent'}),
 T: Object.freeze({weight:.45,usage:'Small secondary indicator only'}),
 A: Object.freeze({weight:.30,usage:'Sparse decorative badge only'})
});
export function tokenRole(name) {
 if(name==='--dui-theme-tertiary-bg')return 'T';
 if(name==='--dui-theme-detail-accent-bg')return 'A';
 if(/invalid|warning|success|info/.test(name))return 'status';
 if(/text|muted/.test(name))return 'neutral';
 if(/selection/.test(name))return 'S';
 if(/focus|accent|command-button|window-header|window-border/.test(name))return 'P';
 return 'neutral';
}
export const roleChroma = (role,strength) => role==='P'?1:strength*roleDistribution[role].weight;
// Cap tints at 120% of the empirical reference ramp, retaining default calibration.
export const neutralChroma = (referenceC,tint) => referenceC*(tint<=.5?2*tint:1+.4*(tint-.5));
