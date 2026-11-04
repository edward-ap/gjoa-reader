import en from './en.js';
let current = 'en';

/** Legacy language/system arguments remain accepted; application UI is English.
 * Resolving a preference never rewrites it or transforms document/user strings.
 */
export function resolveLocale(language, system = globalThis.navigator?.language ?? 'en') {
  return 'en';
}
export function setLocale(locale) { current = resolveLocale(locale); }
export function getLocale() { return current; }
export function t(key, params = {}) {
  return (en[key] ?? key).replace(/\{(\w+)\}/g, (all, name) => Object.hasOwn(params, name) ? String(params[name]) : all);
}
const sourceKeys = new Map(Object.entries(en).map(([key, value]) => [value, key]));
// Dense UI source IDs are English; interpolate only the host's explicit parameters.
export function denseText(text, params = {}) { return t(sourceKeys.get(text) ?? text, params); }
