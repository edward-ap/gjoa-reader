import {withRayCount} from './wheel-geometry.js';
import {stackBindings} from './stack-model.js';
import {normalizeDefinition} from './serialization.js';
import {generateTheme} from './theme-generator.js';
import {setBaseHex} from './base-color.js';
import {hues} from './harmony.js';
import {paletteRoles,boundaryDefaults} from './scope-model.js';
// The editor has one distribution policy; legacy modes remain supported by the engine.
export function editorDefinition(input,maxColors=4){
 if(!Number.isInteger(maxColors)||maxColors<1||maxColors>4)throw new RangeError('maxColors must be an integer from 1 to 4');
 const d=normalizeDefinition(input);if(d.preset==='clear')return d;
 // Resolve the original anchor before limiting geometry: existing bindings may
 // still refer to D until stackBindings adapts them to the reduced ray count.
 if(!d.baseTone)setBaseHex(d,generateTheme(d).sourceAccent);
 if(hues(d.harmony).length>maxColors)d.harmony=withRayCount(d.harmony,maxColors);
 const count=hues(d.harmony).length;
 d.accentSource='spectrum';d.chroma=1;d.roles=stackBindings(d.roles,count);
 d.distribution={mode:count===1?'primary-only':'scope-cycle',sequence:paletteRoles.slice(0,count),cycleAfter:count,restartAtWindow:true,inheritLeaves:true,afterLast:'cycle',boundaryDefaults:{...boundaryDefaults},overrides:{}};
 return normalizeDefinition(d);
}
