// Optional application-owned translations; component defaults remain English.
export function localize(options, text, params = {}) {
  const translated = options?.translate?.(text, params) ?? text;
  return String(translated).replace(/\{(\w+)\}/g, (all, key) => Object.hasOwn(params, key) ? String(params[key]) : all);
}
