// Prepare accompanying legal notices and covered sources without packaging app/runtime payloads.
// Preserve exact upstream bytes and reject existing nonempty/source destinations.
import {readFile,writeFile,mkdir,readdir,lstat,realpath,copyFile} from 'node:fs/promises';
import {resolve,isAbsolute,relative,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out'||!isAbsolute(args[1]))throw Error('Usage: node scripts/package-notices.mjs --out ABSOLUTE_NEW_EMPTY_DIRECTORY');
const out=resolve(args[1]);
function outside(candidate){const key=p=>process.platform==='win32'?p.toLowerCase():p;const base=key(root),target=key(candidate);if(target===base||target.startsWith(base+sep)||base.startsWith(target+sep))throw Error('Notice output must be outside the source checkout and its ancestors');}
outside(out);
try{const stat=await lstat(out);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Output must be a plain directory');if((await readdir(out)).length)throw Error('Output must be new or empty');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(out,{recursive:true});}
outside(await realpath(out));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const forbidden=/[.](exe|dll|lib|ttf|otf|woff2?|png|jpe?g|bmp|gif|webp|ico|icns|pdf|fb2|epub|sqlite|db)$/i;
const files=new Map();
function safeRelative(file){const normalized=file.replaceAll(String.fromCharCode(92),'/');if(isAbsolute(file)||normalized.split('/').some(p=>p==='..'||!p))throw Error('Unsafe notice path');return normalized;}
async function add(source,destination=source,expected){source=safeRelative(source);destination=safeRelative(destination);if(forbidden.test(source)||forbidden.test(destination))throw Error('Runtime/artwork/book payload forbidden: '+source);const full=resolve(root,source),info=await lstat(full);if(!full.startsWith(root+sep)||!info.isFile()||info.isSymbolicLink())throw Error('Notice source must be a regular checkout file');const bytes=await readFile(full),sha256=hash(bytes);if(expected&&sha256!==expected)throw Error('Pinned notice hash differs: '+source);const old=files.get(destination);if(old&&old.sha256!==sha256)throw Error('Conflicting notice destination: '+destination);files.set(destination,{source,path:destination,bytes:bytes.length,sha256});}
async function tree(folder){for(const entry of await readdir(join(root,folder),{withFileTypes:true})){const file=folder+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Symlink in notices');if(entry.isDirectory())await tree(file);else await add(file);}}
await tree('licenses');
for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md','docs/LICENSE_SCOPE.md','docs/DEPENDENCIES.md','vendor/taet-ui/LICENSE','vendor/taet-ui/THIRD_PARTY_NOTICES.md','vendor/taet-ui/src/ui/fonts/NotoSans-OFL.txt','extensions/viewport/LICENSE','extensions/viewport/provenance.json','extensions/painter/LICENSE','extensions/painter/provenance.json','vendor/djvu-jb2/LICENSE','vendor/djvu-jb2/PATCHES.md','docs/specifications/fb2/UPSTREAM.txt'])await add(file);
for(const folder of ['src-tauri/assets/fonts','src-tauri/assets/pdfium']){
 for(const entry of await readdir(join(root,folder),{withFileTypes:true})){
  if(entry.isFile()&&/^(LICENSE|VERSION)$|[.](txt|md|json)$/i.test(entry.name))await add(folder+'/'+entry.name);
 }
}
await tree('src-tauri/assets/pdfium/licenses');
const asset=JSON.parse(await readFile(join(root,'licenses/asset-license-manifest.json'),'utf8'));
// Retain canonical source paths as well as the companion paths documented by ASSETS.md.
for(const record of asset.binaryDistributionPlan.files)await add(record.sourcePath,record.distributionPath,record.sha256);
for(const file of files.values()){
 const dest=join(out,file.path);await mkdir(dirname(dest),{recursive:true});await copyFile(join(root,file.source),dest);if(hash(await readFile(dest))!==file.sha256)throw Error('Copied notice differs: '+file.path);
}
const manifest={schemaVersion:1,applicationLicense:'MIT',applicationCopyright:'2026 Edward Aponasko',scope:'Accompanying notices and exact covered sources only; no application/runtime binaries/fonts/artwork/books',distributionClearance:false,remainingRights:'See licenses/ASSETS.md and licenses/RUST_DEPENDENCIES.md; unknown provenance is not granted by app MIT',files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
await writeFile(join(out,'NOTICES_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output:out,files:files.size,sourceOnlyNoticeBundle:true,distributionClearance:false},null,2));
