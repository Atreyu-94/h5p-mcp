import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(process.argv[2]),load=createRequire(path.join(root,'package.json'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
assert(!JSON.stringify(manifest).includes('@lumieducation'));
assert.throws(()=>load.resolve('@lumieducation/h5p-server'));
assert.equal(await fs.access(path.join(root,'h5p_mcp/lumi')).then(()=>true,()=>false),false);
const forbidden=['h5p/editor.js','h5p/export.js','h5p/validation.js','h5p/preparation.js','h5p/compatibility.js','infrastructure/manifest.js'];
for(const name of forbidden)assert.equal(await fs.access(path.join(root,'dist/core',name)).then(()=>true,()=>false),false,name);
let modules=0;
async function walk(dir){
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())await walk(file);
  else if(entry.name.endsWith('.js')){modules++;assert(!/@lumieducation|legacyRoot|extraction\.cjs/.test(await fs.readFile(file,'utf8')),file);}
 }
}
await walk(path.join(root,'dist/core'));
console.log(JSON.stringify({distribution:'passed',modules,lumi_resolvable:false,legacy_files:false}));
