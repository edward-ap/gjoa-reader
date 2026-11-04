import {clamp,hexToLch,toGamut,contrast} from './color-math.js';
import {sourceColor} from './base-color.js';
import {hues} from './harmony.js';
import {activeAnchors,paletteRoles} from './scope-model.js';
import {scopedTokens,familyToken} from './theme-scopes.js';
import {normalizeDefinition} from './serialization.js';
import {tokenRole,roleChroma,neutralChroma,roleDistribution} from './role-distribution.js';
import {resolveForeground,resolveAccentFamily,effectiveContrast} from './foreground-resolver.js';
import {references} from './reference-tokens.js';
export const referenceHue=Object.fromEntries(['light','dark'].map(k=>[k,hexToLch(references[k]['--dui-color-accent-bg']).H]));
export function tokenFamily(name) {
 if(name.startsWith('--dui-theme-'))return 'detail';
 if(/invalid|warning|success|info/.test(name))return 'status';
 if(/text|muted/.test(name))return 'text';
 if(/focus|selection/.test(name))return 'state';
 if(/command-button|window-header|window-border|accent/.test(name))return 'accent';
 if(/border|scrollbar/.test(name))return 'border';
 return 'surface';
}
function generateCore(input,{baseTokens,scale=1}={}) {
 const definition=normalizeDefinition(input),tokens={},clamps=[],adjustments=[],checks=[];
 if(definition.preset==='clear')return {definition,tokens:{...references.clear},palette:[],clamps,adjustments,checks,warnings:['Clear preserves the existing neutral preset; generated contrast correction is not applied.']};
 const d=definition, dark=d.foundation==='dark',reference=references[d.foundation];
 const anchors=activeAnchors(d),assigned=paletteRoles.map(role=>anchors.find(a=>a.id===d.roles[role]).hue);
 const weights=paletteRoles.map(role=>anchors.find(a=>a.id===d.roles[role]).chromaWeight);
 const primary=assigned[0],rotation=primary-referenceHue[d.foundation];
 const spectra=d.accentSource==='spectrum'?assigned.map(H=>sourceColor(d,H)):null;
 const palette=assigned.map((H,i)=>({role:['P','S','T','A'][i],...toGamut(spectra?{L:spectra[i].L,C:spectra[i].C*d.chroma*weights[i]*scale,H:spectra[i].H}:{L:dark?.72:.67,C:.14*d.chroma*2*roleChroma(['P','S','T','A'][i],d.harmony.harmonyStrength)*weights[i]*scale,H})}));
 for(const [name,raw] of Object.entries(reference)) {
  if(!raw.startsWith('#')){tokens[name]=dark?'#77879a':'#526879';continue;}
  const original=hexToLch(raw),family=tokenFamily(name),bucket=tokenRole(name);let {L,C,H}=original;
  if(family==='text'){C=0;}
  else if(family==='status') {C*=.7+.6*d.chroma; if(name.endsWith('-bg'))L+=(dark?1:-1)*.04*(d.stateIntensity-.5);}
  else {
   H+=rotation;
   if(family==='surface') C=neutralChroma(C,d.surfaceTint);
   else if(family==='border') {C=neutralChroma(C,d.surfaceTint);L+=(dark?1:-1)*.14*(d.borderContrast-.5);}
   else {
    const role=bucket==='S'&&d.distribution.mode==='semantic'?1:0;
    H+=assigned[role]-primary;
    // Same-hue reuse retains the calibrated monochrome preset exactly.
    C*=2*d.chroma*weights[role]*scale*(assigned[role]===primary?1:roleChroma(bucket,d.harmony.harmonyStrength));
   }
   if(/hover|active|selection|focus/.test(name)) {L+=(dark?1:-1)*.08*(d.stateIntensity-.5);C*=.5+d.stateIntensity;}
  }
  if(spectra && !/text|disabled/.test(name) && /--dui-(command-button|window-header|window-border|color-(accent|focus|selection))/.test(name)){
   const role=bucket==='S'&&d.distribution.mode==='semantic'?1:0,source=spectra[role];
   H=source.H;C=source.C*d.chroma*weights[role]*scale;L=source.L;
   if(/selection-bg|focus-bg/.test(name)){L=original.L+(dark?1:-1)*.08*(d.stateIntensity-.5);C*=.12+.18*d.stateIntensity;}
   else if(/hover|active/.test(name))L=clamp(L+(dark?1:-1)*(/active/.test(name)?.06:.03)*(.5+d.stateIntensity));
  }
  const color=toGamut({L:clamp(L),C,H});tokens[name]=color.hex;
  if(color.clamped)clamps.push({token:name,requestedC:C,actualC:color.C});
 }
 if(baseTokens)for(const name of Object.keys(tokens))if(['neutral','status'].includes(tokenRole(name)))tokens[name]=baseTokens[name];
 // T/A have no permission over large core surfaces. Their only consumers are
 // opt-in, small prototype indicators; these four properties travel in CSS export.
 for(const [role,prefix] of [['T','tertiary'],['A','detail-accent']]) {
  const color=d.distribution.mode==='primary-only'?palette[0]:palette.find(p=>p.role===role);
  tokens[`--dui-theme-${prefix}-bg`]=color.hex;
  tokens[`--dui-theme-${prefix}-text`]=contrast('#161616',color.hex)>=contrast('#ffffff',color.hex)?'#161616':'#ffffff';
  if(color.clamped)clamps.push({token:`--dui-theme-${prefix}-bg`,requestedC:.14*d.chroma*2*roleChroma(role,d.harmony.harmonyStrength),actualC:color.C});
 }
 // Focus is a non-text indicator. Adjust only its L, keeping its chosen hue.
 const focus='--dui-color-focus-border',adjacent=['--dui-color-bg','--dui-color-surface'];
 const oldFocus=tokens[focus],c=hexToLch(oldFocus);
 for(let i=0;i<100&&adjacent.some(bg=>contrast(tokens[focus],tokens[bg])<3);i++){c.L=clamp(c.L+(dark?.005:-.005));tokens[focus]=toGamut(c).hex;}
 if(oldFocus!==tokens[focus])adjustments.push(`${focus}: lightness adjusted for focus contrast`);
 for(const bg of adjacent)checks.push({foreground:focus,background:bg,ratio:contrast(tokens[focus],tokens[bg]),target:3});
 // Capture the source before foreground policy derives corrected surfaces.
 const sourceAccent=tokens['--dui-window-header-bg'];
 const resolutions=[];
 const guard=(fg,bgs,target=4.5)=>{
  const old=tokens[fg];
  const accent=['--dui-color-accent-text','--dui-window-header-text','--dui-command-button-text','--dui-on-progress'].includes(fg);
  const choice=accent
   ? resolveAccentFamily({backgrounds:bgs.map(bg=>tokens[bg]),current:old,foundation:d.foundation,target,polarity:d.accentForeground})
   : resolveForeground({backgrounds:bgs.map(bg=>tokens[bg]),current:old,foundation:d.foundation,target});
  if(choice.backgrounds)for(const [i,bg] of bgs.entries()){
   if(tokens[bg]!==choice.backgrounds[i])adjustments.push(`${bg}: ${tokens[bg]} → ${choice.backgrounds[i]} (${choice.reason})`);
   tokens[bg]=choice.backgrounds[i];
  }
  tokens[fg]=choice.foreground;
  if(choice.needsBackgroundAdjustment)for(const bg of bgs){
   const before=tokens[bg],c=hexToLch(before);
   for(let i=0;i<200&&effectiveContrast(tokens[fg],tokens[bg])<target;i++){
    c.L=clamp(c.L+(tokens[fg]==='#ffffff'?-.005:.005));tokens[bg]=toGamut(c).hex;
   }
   if(before!==tokens[bg])adjustments.push(`${bg}: ${before} → ${tokens[bg]} (last-resort background L correction)`);
  }
  if(old!==tokens[fg])adjustments.push(`${fg}: ${old??'unset'} → ${tokens[fg]} (${choice.reason})`);
  resolutions.push({token:fg,...choice,backgrounds:bgs});
  for(const bg of bgs)checks.push({foreground:fg,background:bg,ratio:effectiveContrast(tokens[fg],tokens[bg]),target});
 };
 guard('--dui-theme-tertiary-text',['--dui-theme-tertiary-bg']);
 guard('--dui-theme-detail-accent-text',['--dui-theme-detail-accent-bg']);
 guard('--dui-color-text',['--dui-color-bg','--dui-color-surface','--dui-color-surface-strong','--dui-color-surface-raised','--dui-color-invalid-bg','--dui-color-warning-bg','--dui-color-success-bg','--dui-color-info-bg']);
 guard('--dui-color-muted',['--dui-color-bg','--dui-color-surface']);
 guard('--dui-color-accent-text',['--dui-color-accent-bg']);
 guard('--dui-window-header-text',['--dui-window-header-bg']);
 guard('--dui-color-selection-text',['--dui-color-selection-bg']);
 guard('--dui-button-text',['--dui-button-bg','--dui-button-bg-hover','--dui-button-bg-active']);
 guard('--dui-command-button-text',['--dui-command-button-bg','--dui-command-button-bg-hover','--dui-command-button-bg-active']);
 const aliases={'surface':'--dui-color-text','surface-muted':'--dui-color-muted',accent:'--dui-color-accent-text',command:'--dui-command-button-text',selection:'--dui-color-selection-text',header:'--dui-window-header-text'};
 for(const [name,token] of Object.entries(aliases))tokens[`--dui-on-${name}`]=tokens[token];
 for(const name of ['error','warning','success','info']){
  const token=`--dui-on-${name}`;tokens[token]=tokens['--dui-color-text'];guard(token,[`--dui-color-${name==='error'?'invalid':name}-bg`]);
 }
 tokens['--dui-on-progress']=tokens['--dui-color-text'];guard('--dui-on-progress',['--dui-color-focus-border']);
 tokens['--dui-on-progress-track']=tokens['--dui-button-text'];guard('--dui-on-progress-track',['--dui-button-bg']);
 // Aliases must resolve in this scope, not inherit resolved values from the editor root.
 tokens['--dui-grid-frozen-bg']=tokens['--dui-color-bg'];tokens['--dui-grid-frozen-hover-bg']=tokens['--dui-color-surface'];
 // Recheck final colors: accent polarity may have darkened focus/progress.
 for(const check of checks)check.ratio=effectiveContrast(tokens[check.foreground],tokens[check.background]);
 const warnings=checks.filter(c=>c.ratio<c.target).map(c=>`${c.foreground} / ${c.background}: ${c.ratio.toFixed(2)} < ${c.target}`);
 return {definition,tokens,palette,clamps,adjustments,checks,warnings,distribution:roleDistribution,resolutions,sourceAccent};
}

// Generate complete contextual ramps, then let scopes bind the existing token API.
export function generateTheme(input) {
 const root=generateCore(input);
 if(root.definition.preset==='clear')return root;
 root.anchors=activeAnchors(root.definition);
 root.families={};
 for(const [i,role] of paletteRoles.entries()) {
  const anchor=root.definition.roles[role],d=structuredClone(root.definition);
  d.roles=Object.fromEntries(paletteRoles.map(r=>[r,anchor]));
  const family=generateCore(d,{baseTokens:root.tokens,scale:d.accentSource==='spectrum'||['scope-cycle','manual'].includes(d.distribution.mode)?1:roleChroma(['P','S','T','A'][i],d.harmony.harmonyStrength)});
  const tokens=Object.fromEntries(scopedTokens.map(name=>[name,family.tokens[name]]));
  const ramp={strong:tokens['--dui-command-button-bg-active'],normal:tokens['--dui-command-button-bg'],hover:tokens['--dui-command-button-bg-hover'],active:tokens['--dui-command-button-bg-active'],soft:tokens['--dui-color-focus-bg'],faint:tokens['--dui-color-selection-bg'],border:tokens['--dui-color-focus-border'],onColor:tokens['--dui-command-button-text']};
  root.families[role]={anchorId:anchor,sourceAccent:family.sourceAccent,ramp,tokens,checks:family.checks,warnings:family.warnings,resolutions:family.resolutions,adjustments:family.adjustments};
  root.tokens[`--dui-palette-${role}`]=ramp.normal;
  for(const [name,value] of Object.entries(ramp))root.tokens[`--dui-palette-${role}-${name}`]=value;
  for(const [name,value] of Object.entries(tokens))root.tokens[familyToken(role,name)]=value;
  root.warnings.push(...family.warnings.map(w=>`${role} scope: ${w}`));
 }
 return root;
}
