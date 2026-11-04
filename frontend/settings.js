import { SelectInput, ReadonlyText, Button, Panel } from 'dense-ui';
import { ColorPicker, FieldGroup, Dialog, ThemeDesigner, ThemeApplicator } from 'dense-ui/experimental';
import { t, denseText } from './i18n/i18n.js';
export const defaults = Object.freeze({ version: 1, language: 'en', uiTheme: 'system', pageAppearance: 'original', workspaceBackground: '#484c50' });
export function pageColor(appearance) {
  const rgb = appearance?.custom ?? ({ original: [255,255,255], sepia: [244,236,216], night: [17,17,17] }[appearance] ?? [255,255,255]);
  return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
}
export function colorAppearance(color, previous) {
  if (color === pageColor(previous)) return previous;
  if (color === '#ffffff') return 'original';
  return { custom: [1,3,5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) };
}
let themeApplicator;
const themeScopes = [
  {selector:'.reader-annotation-rail',role:'primary',parts:['sidePanel']},
  {selector:'.reader-statusbar',parts:['surface']},
  {selector:'.reader-body > .dui-hiding-side-panel',role:'secondary',parts:['sidePanel']},
  {selector:'.reader-left-dock',parts:['surface']},
  {selector:'.reader-left-dock .dui-field-group,.settings-dialog .dui-field-group',role:'tertiary',parts:['fieldGroup']},
  {selector:'.reader-left-dock .dui-tree-explorer',role:'tertiary'},
  {selector:'.dui-dialog:not(.reader-theme-designer-dialog)',parts:['dialog']},
  {selector:'.import-books-dialog',parts:['progress']}
];
export function effectiveFoundation(settings, dark = matchMedia('(prefers-color-scheme: dark)').matches) {
  return settings.uiTheme === 'custom' ? settings.customTheme?.foundation ?? (dark ? 'dark' : 'light')
    : settings.uiTheme === 'system' ? (dark ? 'dark' : 'light') : settings.uiTheme;
}
function applyCustomTokens(theme) {
  themeApplicator ??= new ThemeApplicator(document.body,{scopes:themeScopes});
  if (!Object.keys(theme?.tokens ?? {}).length) { themeApplicator.clear(); return; }
  themeApplicator.apply({tokens:theme.tokens,families:Object.fromEntries(
    Object.entries(theme.families ?? {}).map(([role,tokens])=>[role,{tokens}])
  )});
}
export function disposeTheme() { themeApplicator?.destroy(); themeApplicator = undefined; }
function themeSnapshot(designer) {
  const theme = designer.getTheme();
  return {foundation:theme.definition.foundation ?? 'light', definition:designer.getPreset().definition,
    tokens:theme.tokens, families:Object.fromEntries(Object.entries(theme.families ?? {}).map(([role,family])=>[role,family.tokens]))};
}
async function editCustomTheme(owner, current, settings) {
  const designer = new ThemeDesigner({toolbar:false, maxColors:3, preview:false,
    onChange:()=>applyChrome({...settings,uiTheme:'custom',customTheme:themeSnapshot(designer)})});
  const dialog = new Dialog({title:t('settings.customTitle'),translate:denseText,width:590,
    content:designer,destroyContent:true,className:'reader-theme-designer-dialog',
    buttons:[{text:t('common.cancel'),result:'cancel'},{text:t('common.ok'),result:'ok',primary:true}]});
  owner.disposables.add(() => dialog.destroy());
  try {
    const result = dialog.showModal();
    const base = current.definition ?? designer.getPresets().find(p=>p.name===(current.foundation==='dark'?'Dark Blue':'Light Blue')).definition;
    designer.setPreset({name:'Custom',definition:base});
    // Opening alone does not change the application. Changes preview through onChange.
    applyChrome({...settings,uiTheme:'custom',customTheme:current});
    return await result === 'ok' ? themeSnapshot(designer) : null;
  } finally { dialog.destroy(); }
}
export function applyChrome(settings, dark = matchMedia('(prefers-color-scheme: dark)').matches) {
  const theme = effectiveFoundation(settings, dark);
  applyCustomTokens(settings.uiTheme === 'custom' ? settings.customTheme : null);
  document.body.classList.toggle('reader-custom-theme', settings.uiTheme === 'custom' && !!Object.keys(settings.customTheme?.tokens ?? {}).length);
  document.body.classList.toggle('dui-theme-dark-blue', theme === 'dark');
  document.body.classList.toggle('dui-theme-light', theme !== 'dark');
  document.documentElement.style.setProperty('--reader-workspace-background', settings.workspaceBackground);
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(settings.workspaceBackground.slice(offset, offset + 2), 16));
  document.documentElement.style.setProperty('--reader-pencil-color',
    .2126 * r + .7152 * g + .0722 * b > 150 ? '#434950' : '#d4d8dc');
  document.documentElement.style.colorScheme = theme;
}
export async function settingsDialog(library, settings, book, save) {
  let language, theme, appearance, background, customButton, customError, customEditing = false;
  let customTheme = structuredClone(settings.customTheme ?? null), accepted = settings;
  const select = (panel, label, value, choices) => {
    const field = new SelectInput({ label, labelWidth: 155, width: '100%', searchable: false });
    panel.add(field); field.data.parse(choices.map(([id, text]) => ({ id, text }))); field.value.set(value); return field;
  };
  try { await library.resourceDialog(t('settings.title'), panel => {
    // Legacy stored values remain readable; an accepted dialog saves English.
    language = select(panel, t('settings.language'), 'en', [['en','English']]);
    const appearanceGroup = new FieldGroup({title:t('settings.appearanceGroup'),width:'100%'});
    panel.add(appearanceGroup);
    const themeRow = new Panel({width:'100%',css:'settings-theme-row'}); appearanceGroup.add(themeRow);
    theme = select(themeRow, t('settings.uiTheme'), settings.uiTheme, ['system','light','dark','custom'].map(id=>[id,t('settings.'+id)]));
    customButton = new Button({text:t('settings.customButton'),disabled:settings.uiTheme!=='custom',onClick:async()=>{
      if (customEditing) return;
      customEditing = true; customError.hide();
      try {
        customTheme ??= {foundation:effectiveFoundation(settings),definition:null,tokens:{},families:{}};
        const updated = await editCustomTheme(customButton, customTheme, settings);
        if (updated) customTheme = updated;
      } catch(error) {
        if(!customError.destroyed) { customError.setText(String(error?.message ?? error)); customError.show(); }
      } finally {
        customEditing = false;
        applyChrome(theme.destroyed ? settings : {...settings,uiTheme:theme.value.get(),customTheme});
        if (!customButton.destroyed) customButton.enable();
      }
    }}); themeRow.add(customButton);
    customError = new ReadonlyText({text:"",role:"alert",width:"100%"}); appearanceGroup.add(customError); customError.hide();
    theme.events.on('change', event=>{
      if(event.newValue==='custom') {
        customTheme ??= {foundation:effectiveFoundation({...settings,uiTheme:event.oldValue}),definition:null,tokens:{},families:{}};
        customButton.enable();
      } else customButton.disable();
      applyChrome({...settings,uiTheme:event.newValue,customTheme});
    });
    appearance = new ColorPicker({ translate:denseText, label:t('settings.appearance'), labelWidth:155, width:'100%', value:pageColor(settings.pageAppearance), allowEmpty:false });
    appearanceGroup.add(appearance);
    if (book && !book.supportsPageAppearance) appearance.disable();
    background = new ColorPicker({ translate: denseText, label: t('settings.background'), labelWidth:155, width:'100%', value:settings.workspaceBackground, allowEmpty:false });
    appearanceGroup.add(background);
    appearanceGroup.add(new ReadonlyText({text:t('settings.fixed'),width:'100%'}));
    return null;
  }, { secondaryAction: { text:t('settings.restoreDefaults'), onClick:() => {
    customTheme = null; customButton.disable();
    language.value.set(defaults.language); theme.value.set(defaults.uiTheme);
    appearance.value.set(pageColor(defaults.pageAppearance)); background.value.set(defaults.workspaceBackground);
  } }, accept: async () => {
    const next = { version:1, language:language.value.get(), uiTheme:theme.value.get(), pageAppearance:colorAppearance(appearance.value.get(), settings.pageAppearance), workspaceBackground:background.value.get() };
    if(customTheme) next.customTheme = customTheme;
    await save(next); accepted = next;
  } }); } finally { applyChrome(accepted); }
}
