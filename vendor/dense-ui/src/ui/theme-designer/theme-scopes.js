import {paletteRoles,resolveScope,boundaryBehaviors,boundaryDefaults} from './scope-model.js';
export const scopedTokens=[
 'color-focus-border','color-focus-bg','color-accent-bg','color-accent-text',
 'color-selection-bg','color-selection-text','window-header-bg','window-header-text','window-border',
 'command-button-bg','command-button-bg-hover','command-button-bg-active','command-button-border','command-button-text',
 'on-accent','on-command','on-selection','on-header','on-progress'
].map(name=>'--dui-'+name);
export const familyToken=(role,token)=>`--dui-family-${role}-${token.slice(6)}`;
// Adapter belongs to the prototype: core controls retain their existing token API.
export const partCSS=`
[data-dui-scope-parts] {
 --dui-scope-accent-bg: var(--dui-window-header-bg);
 --dui-scope-on-accent: var(--dui-window-header-text);
 --dui-scope-border: var(--dui-window-border);
 --dui-scope-selection: var(--dui-color-selection-bg);
}
[data-dui-scope-parts="panel"] > .dui-field-group__title,
[data-dui-scope-parts] > .scope-heading,
[data-dui-scope-parts="grid"] > .dui-grid__header {
 background:var(--dui-scope-accent-bg);color:var(--dui-scope-on-accent);border-color:var(--dui-scope-border);
}
[data-dui-scope-parts="grid"] > .dui-grid__header .dui-grid__header-cell {
 background:var(--dui-scope-accent-bg);color:var(--dui-scope-on-accent);
}
[data-dui-scope-parts="panel"].dui-field-group {border-color:var(--dui-scope-border)}
[data-dui-scope-parts="featured"] {background:var(--dui-scope-accent-bg);color:var(--dui-scope-on-accent)}
[data-dui-scope-parts="featured"] .dui-label-text {color:inherit}
`;
function neutralTokens(result){
 const t=result.tokens,v={};
 for(const name of scopedTokens){
  let source='--dui-color-border';
  if(/text$|on-/.test(name))source='--dui-color-text';
  else if(/selection-bg|focus-bg/.test(name))source='--dui-color-surface-strong';
  else if(/bg/.test(name))source='--dui-color-surface';
  v[name]=t[source];
 }
 return v;
}
export function scopeCSS(result) {
 if(!result.families)return '';
 return partCSS+'\n'+paletteRoles.map(role=>`.dui-generated-theme[data-dui-theme-role="${role}"],\n.dui-generated-theme [data-dui-theme-role="${role}"] {\n${scopedTokens.map(t=>`  ${t}: var(${familyToken(role,t)});`).join('\n')}\n  --dui-scope-accent: var(--dui-palette-${role});\n}\n`).join('\n')+`\n.dui-generated-theme [data-dui-theme-role="none"], .dui-generated-theme[data-dui-theme-role="none"] {\n${Object.entries(neutralTokens(result)).map(([k,v])=>`  ${k}: ${v};`).join('\n')}\n}\n`;
}
// Explicit prototype registry. It does not inspect DOM depth or modify control models.
export class ThemeScopes {
 constructor(){this.entries=new Map();this.result=null;this.destroyed=false;}
 register(target,{id,parent=null,boundary=true,window=false,semanticRole,themeRole,kind,behavior,parts,label=id}={}) {
  if(this.destroyed)throw Error('ThemeScopes destroyed');
  const element=target.element??target;
  if(!element?.style||!id||this.entries.has(id)||(parent&&!this.entries.has(parent)))throw Error('Invalid scope registration or parent');
  for(const role of [semanticRole,themeRole])if(role!==undefined&&!paletteRoles.includes(role))throw Error('Unknown palette role');
  if(kind!==undefined&&!(kind in boundaryDefaults))throw Error('Unknown boundary kind');
  if(behavior!==undefined&&!boundaryBehaviors.includes(behavior))throw Error('Unknown boundary behavior');
  const entry={id,parent,boundary,window,semanticRole,themeRole,kind,behavior,parts,label,element,saved:new Map(),attributes:new Map(['data-dui-theme-role','data-dui-scope-id','data-dui-scope-parts','data-dui-scope-label'].map(n=>[n,element.getAttribute(n)]))};
  this.entries.set(id,entry);element.dataset.duiScopeId=id;if(parts)element.dataset.duiScopeParts=parts;
  if(target.disposables)target.disposables.add(()=>this.unregister(id));
  if(this.result)this.apply(this.result);
  return {setRole:role=>{if(role!==null&&!paletteRoles.includes(role))throw Error('Unknown palette role');entry.themeRole=role??undefined;if(this.result)this.apply(this.result);},destroy:()=>this.unregister(id)};
 }
 restore(entry){for(const [name,old] of entry.saved){if(old.value)entry.element.style.setProperty(name,old.value,old.priority);else entry.element.style.removeProperty(name);}entry.saved.clear();}
 clearOverrides(){for(const entry of this.entries.values())this.restore(entry);}
 apply(result){
  if(this.destroyed)return;this.result=result;const states=new Map();
  for(const entry of this.entries.values()){
   this.restore(entry);
   if(!result.families){entry.element.removeAttribute('data-dui-theme-role');entry.element.removeAttribute('data-dui-scope-label');continue;}
   const parent=states.get(entry.parent),state=resolveScope(result.definition.distribution,entry,parent);states.set(entry.id,state);entry.element.removeAttribute('data-dui-theme-role');
   const anchor=state.role?result.definition.roles[state.role].toUpperCase():'–';
   entry.element.dataset.duiScopeLabel=`[${anchor}] ${entry.label} · ${state.role??'neutral'} · level ${state.depth}`;
   const explicit=entry.themeRole??(result.definition.distribution.mode==='manual'?result.definition.distribution.overrides[entry.id]:undefined);
   const boundaryApplies=result.definition.distribution.mode==='scope-cycle'&&entry.boundary;
   if(state.role!==null&&!explicit&&!boundaryApplies&&(!parent || state.role===parent.role))continue;
   entry.element.dataset.duiThemeRole=state.role??'none';
   const values=state.role?{...result.families[state.role].tokens,'--dui-scope-accent':result.families[state.role].ramp.normal}:neutralTokens(result);
   for(const [name,value] of Object.entries(values)){entry.saved.set(name,{value:entry.element.style.getPropertyValue(name),priority:entry.element.style.getPropertyPriority(name)});entry.element.style.setProperty(name,value);}
  }
  this.states=states;
 }
 unregister(id){const entry=this.entries.get(id);if(!entry)return;for(const child of [...this.entries.values()])if(child.parent===id)this.unregister(child.id);this.restore(entry);for(const [name,value] of entry.attributes)if(value===null)entry.element.removeAttribute(name);else entry.element.setAttribute(name,value);this.entries.delete(id);}
 destroy(){for(const id of [...this.entries.keys()])this.unregister(id);this.destroyed=true;this.result=null;}
}
