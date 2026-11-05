import {repositoryRoot} from './runtime.js';
import {createRequire} from 'node:module';
import {resolveLibraries} from '../h5p/dependencies.js';
import {FileLibraryRepository} from '../h5p/libraries.js';
import type {Native, Activity} from '../domain/types.js';

import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readBounded} from './media.js';
import {limit} from '../domain/limits.js';
const hash = (data: Native) => createHash('sha256').update(data).digest('hex');
export async function nativeManifest(root: string, activity: Activity, mathematics: Native) {
  const libraries: Record<string, Native> = {};
  let total = 0, files = 0;
  async function digestFile(filename: string) {
    const data = await readBounded(filename, limit('ASSET_BYTES', 67108864));
    total += data.length;
    if (++files > limit('ZIP_MEMBERS', 20000) || total > limit('ZIP_BYTES', 536870912)) throw new Error('Manifest file budget exceeded');
    return hash(data);
  }
  const graph=await resolveLibraries(new FileLibraryRepository(root),activity,mathematics.detected);
  for(const [name,node] of graph) {
    const entry = libraries[name] = {patch:node.metadata.patchVersion, files:{} as Record<string,string>};
    const base = path.join(root, `${node.version.machineName}-${node.version.majorVersion}.${node.version.minorVersion}`);
    async function walk(dir: string, depth = 0) {
      if (depth > 32) throw new Error('Library path too deep');
      for (const file of (await fs.readdir(dir, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
        const full = path.join(dir, file.name);
        if (file.isSymbolicLink()) throw new Error('Library symlinks are unsupported');
        if (file.isDirectory()) await walk(full, depth + 1);
        else entry.files[path.relative(base, full).split(path.sep).join('/')] = await digestFile(full);
      }
    }
    await walk(base);
  }
  const assets: Record<string,string> = {};
  for (const [id, file] of Object.entries(activity.assets || {})) assets[id] = await digestFile(file);
  const backend: Record<string,string> = {};
  for(const name of ['authoring-v1.json','authoring-adapters-v1.json'])backend['contract/'+name]=hash(await fs.readFile(path.join(repositoryRoot,'h5p_mcp/contracts',name)));
  const load=createRequire(import.meta.url);
  for(const name of ['sanitize-html','magic-bytes.js','yazl','yauzl-promise','@node-rs/crc32','probe-image-size','ajv','yaml','saxes'])
    backend['package/'+name]=hash(await fs.readFile(load.resolve(name+'/package.json')));
  const saxDependencies=createRequire(load.resolve('saxes/package.json'));
  backend['package/xmlchars']=hash(await fs.readFile(saxDependencies.resolve('xmlchars/package.json')));
  // re2js exports its entry point, but not its package.json subpath.
  backend['package/re2js']=hash(await fs.readFile(path.resolve(path.dirname(load.resolve('re2js')),'../package.json')));
  backend['package/p-map']=hash(await fs.readFile(path.join(path.dirname(load.resolve('p-map')),'package.json')));
  // Ported rules have their own provenance; legacy manifests cannot hide a core change.
  const coreRoot=fileURLToPath(new URL('../',import.meta.url));
  async function coreFiles(dir:string):Promise<void> {
    for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()) await coreFiles(full);
      else if(entry.name.endsWith('.js')||entry.name.endsWith('.ts')&&!entry.name.endsWith('.d.ts')) backend['core/'+path.relative(coreRoot,full).split(path.sep).join('/')]=hash(await fs.readFile(full));
    }
  }
  await coreFiles(coreRoot);
  return {version:2, engine:'native-content-v1', libraries, assets, backend};
}
export function sameNativeManifest(a: Native,b: Native) {
  const canonical = (value: Native): Native => Array.isArray(value)?value.map(canonical):value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
