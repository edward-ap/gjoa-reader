import {defaultDefinition} from './serialization.js';
import {referenceHue} from './theme-generator.js';
const preset=(name,foundation='light',hue=referenceHue[foundation],type='monochrome')=>({name,definition:{...structuredClone(defaultDefinition),foundation,distribution:{mode:type==='monochrome'?'primary-only':'semantic'},harmony:{...defaultDefinition.harmony,baseHue:hue,type}}});
export const presets=[preset('Light Blue'),preset('Dark Blue','dark'),{name:'Clear',definition:{version:1,preset:'clear'}},preset('Green','light',145),preset('Warm','light',55),preset('Purple','dark',305),preset('Triad Demo','light',250,'triad'),preset('Square Demo','dark',245,'square')];

// Recovery bases cannot be overwritten, including through accidental nested mutation.
// Other bundled presets and custom records remain editable for future preset management.
function freeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);}
for(const p of presets){p.readOnly=['Light Blue','Dark Blue','Clear'].includes(p.name);if(p.readOnly)freeze(p);}
Object.freeze(presets);
