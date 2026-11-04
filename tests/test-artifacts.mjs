import {mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Diagnostics are never part of the public source tree. Each caller supplies a
// relative artifact name; the optional environment root supports CI collection.
const checkout = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(process.env.GJOA_EVIDENCE_DIR ?? join(tmpdir(), 'gjoa-browser-evidence'));
const folded = path => process.platform === 'win32' ? path.toLowerCase() : path;
if (folded(output) === folded(checkout) || folded(output).startsWith(folded(checkout + sep)))
  throw Error('GJOA_EVIDENCE_DIR must be outside the checkout');

export function testArtifact(name) {
  const path = resolve(output, name);
  if (!folded(path).startsWith(folded(output + sep))) throw Error('Unsafe test artifact path');
  mkdirSync(dirname(path), {recursive:true});
  return path;
}
