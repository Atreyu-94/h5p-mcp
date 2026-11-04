import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

// Clock the installed methods in-process without modifying their implementation.
const [baseArg,stagesArg]=process.argv.slice(2);
const base=path.resolve(baseArg),out=path.resolve(stagesArg);
const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const original=await json(path.join(base,'samples/environment.json'));
const work=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-prepare-bench-'));
const preload=path.join(work,'measure.mjs');
const core=path.dirname(original.entry);
await fs.writeFile(preload,`
import {Vault} from ${JSON.stringify(pathToFileURL(path.join(core,'storage/vault.js')).href)};
import {Pool} from ${JSON.stringify(pathToFileURL(path.join(core,'infrastructure/pool.js')).href)};
import fs from 'node:fs/promises';
let spans;
function wrap(proto,key){
 const fn=proto[key];
 proto[key]=async function(...args){
  if(!spans)return fn.apply(this,args);
  const start=performance.now();
  try{return await fn.apply(this,args);}finally{spans.push({key,ms:performance.now()-start});}
 };
}
wrap(Vault.prototype,'snapshot');wrap(Pool.prototype,'run');
const prepare=Vault.prototype.prepare;
Vault.prototype.prepare=async function(...args){
 spans=[];const start=performance.now();
 try{return await prepare.apply(this,args);}
 finally{
  const log={total:performance.now()-start,spans};spans=undefined;
  await fs.writeFile(process.env.M6_TRACE,JSON.stringify(log));
 }
};`);
const motion=await json(new URL('../../examples/scientific-figures/motion-question.json',import.meta.url));


const {createRequire}=await import('node:module');
const requireInstalled=createRequire(original.entry);
const zip=await requireInstalled('yauzl-promise').open(path.join(base,'samples/motion.h5p'));
const expected=(await json(path.join(base,'samples/summary.json'))).cases.find(c=>c.file==='motion.typ').first.pngHash;
const png=path.join(work,'motion.png');
try{
 let found=false;
 for await(const e of zip){
  if(e.filename==='content/media/'+expected+'.png'){
   const chunks=[];for await(const c of await e.openReadStream())chunks.push(c);
   await fs.writeFile(png,Buffer.concat(chunks));found=true;
  }
 }
 assert(found);
}finally{await zip.close();}
const rows=[];
for(let trial=1;trial<=3;trial++){
 const root=path.join(work,'trial-'+trial),data=path.join(root,'data');
 await fs.cp(path.join(original.work,'data/libraries'),path.join(data,'libraries'),{recursive:true});
 const trace=path.join(root,'trace.json'),client=new Client({name:'prepare-bench',version:'1'});
 const env={...process.env,H5P_MCP_DATA_DIR:data,H5P_MCP_STORE_DIR:path.join(root,'store'),H5P_MCP_ASSET_ROOTS:JSON.stringify([work]),M6_TRACE:trace};
 async function call(name,args){
  const r=await client.callTool({name,arguments:args});assert(!r.isError&&r.structuredContent?.ok!==false,JSON.stringify(r.content));return r.structuredContent;
 }
 try{
  await client.connect(new StdioClientTransport({command:'bun',args:['--preload',preload,original.entry,'stdio'],env,cwd:root,stderr:'pipe'}));
  const asset=await call('upload_h5p_asset',{path:png,mime:'image/png'});
  motion.assets.grafica=asset.object_id;
  for(const phase of ['new','existing']){
   const start=performance.now();
   const result=await call('prepare_stored_h5p_source',{source:motion});
   const ms=performance.now()-start;
   assert(result.object_id);
   const {total,spans}=await json(trace);
   assert.equal(spans.filter(s=>s.key==='snapshot').length,1);
   assert.equal(spans.filter(s=>s.key==='run').length,1);
   const snapshot=spans.find(s=>s.key==='snapshot').ms,worker=spans.find(s=>s.key==='run').ms;
   rows.push({trial,phase,ms,snapshot,worker,storeAndOther:total-snapshot-worker,ipcAndOther:ms-total});
   await fs.writeFile(path.join(out,'prepare.json'),JSON.stringify(rows,null,2)+'\n');
   console.log(trial,phase,ms.toFixed(0));
  }
 }finally{await client.close();}
}
