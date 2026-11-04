const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const fail = (path, message) => { throw new TypeError(`UI definition ${path}: ${message}`); };
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value;
}
function keys(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown property');
}
function text(value, path) {
  if (typeof value !== 'string' || !value.length || value.length > 1000) fail(path, 'expected a non-empty string (max 1000 characters)');
  return value;
}
function name(value, path) { text(value,path); if (forbidden.has(value)) fail(path,'reserved name'); return value; }
function number(value, path, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `expected a finite number in [${min}, ${max}]`);
  return value;
}
function integer(value,path,min,max) { number(value,path,min,max); if (!Number.isInteger(value)) fail(path,'expected an integer'); return value; }
function choice(value, values, path) { if (!values.includes(value)) fail(path,`expected ${values.join(' / ')}`); return value; }
function bool(value,path) { if (typeof value !== 'boolean') fail(path,'expected a boolean'); return value; }
function list(value,path,max) { if (!Array.isArray(value) || value.length>max) fail(path,`expected an array (max ${max} entries)`); return value; }
// Clone only actual JSON values; never invoke getters or toJSON on object input.
function json(input) {
  if (typeof input === 'string') {
    if (input.length > 2_000_000) fail('$','JSON text exceeds 2,000,000 characters');
    try { input=JSON.parse(input); } catch { fail('$','invalid JSON'); }
  }
  let nodes=0, characters=0;
  const seen=new Set();
  function visit(value,path,depth) {
    if (++nodes>200_000 || depth>32) fail(path,'JSON complexity limit exceeded');
    if (value===null || typeof value==='boolean') return value;
    if (typeof value==='number') return number(value,path);
    if (typeof value==='string') { characters+=value.length; if(characters>2_000_000)fail(path,'total string limit exceeded'); return value; }
    if (!value || typeof value!=='object') fail(path,'expected a JSON value');
    if (seen.has(value)) fail(path,'cyclic object');
    if (!Array.isArray(value) && ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail(path,'expected a plain JSON object');
    if (Object.getOwnPropertySymbols(value).length) fail(path,'symbol properties are not JSON');
    seen.add(value);
    const out=Array.isArray(value)?[]:{};
    for (const key of Object.getOwnPropertyNames(value)) {
      if (Array.isArray(value) && key==='length') continue;
      if (forbidden.has(key)) fail(`${path}.${key}`,'reserved property');
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if (!('value' in descriptor) || !descriptor.enumerable) fail(`${path}.${key}`,'accessors/non-enumerable properties are not JSON');
      if(Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) fail(path,'array has named properties');
      out[key]=visit(descriptor.value,`${path}.${key}`,depth+1);
    }
    if(Array.isArray(value) && out.length!==value.length) fail(path,'sparse array');
    if(Array.isArray(value) && Object.keys(out).length!==value.length) fail(path,'sparse array');
    seen.delete(value); return out;
  }
  return visit(input,'$',0);
}

export { fail, object, keys, text, name, number, integer, choice, bool, list, json };
