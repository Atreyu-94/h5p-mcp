import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const [bun,entryArg,librariesArg,outputArg]=process.argv.slice(2);
if(!outputArg)throw new Error('Usage: node typst-benchmark.mjs <bun> <installed-cli> <libraries> <new-output-directory>');
const output=path.resolve(outputArg),entry=await fs.realpath(entryArg);
await fs.mkdir(output); // Each run owns its samples.
const work=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-render-benchmark-'));
const env={...process.env,H5P_MCP_TYPST_ENABLED:'1',H5P_MCP_TYPST_SANDBOX:'docker',
 H5P_MCP_TYPST_PACKAGES:path.join(work,'packages'),H5P_MCP_DATA_DIR:path.join(work,'data'),
 H5P_MCP_STORE_DIR:path.join(work,'store'),H5P_MCP_EXPORT_DIR:path.join(work,'exports'),
 H5P_MCP_EXPORT_ROOTS:JSON.stringify([work]),H5P_MCP_ASSET_ROOTS:JSON.stringify([work])};
const exec=promisify(execFile);
const samples=[],flows=[],starts=[],imageHashes=new Map();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const millis=start=>Math.round(performance.now()-start);
const exampleDir=new URL('../../examples/scientific-figures/',import.meta.url);
const cases=JSON.parse(await fs.readFile(new URL('learner-es.json',exampleDir),'utf8'));
for(const item of cases)item.source=await fs.readFile(new URL(item.file,exampleDir),'utf8');
const rounds=30;
const save=async(file,value)=>fs.writeFile(path.join(output,file),JSON.stringify(value,null,2)+'\n');
const append=async(file,value)=>fs.appendFile(path.join(output,file),JSON.stringify(value)+'\n');
const machine={entry,work,node:process.version,os:os.version(),arch:os.arch(),cpu:os.cpus()[0].model,
 logicalCpus:os.cpus().length,ramBytes:os.totalmem(),rounds};
await save('environment.json',machine);
const beginSetup=performance.now();
const setup=await exec(bun,[entry,'figure','setup',env.H5P_MCP_TYPST_PACKAGES],{env,cwd:work,windowsHide:true});
await save('setup.json',{ms:millis(beginSetup),result:JSON.parse(setup.stdout)});
await fs.cp(path.resolve(librariesArg),path.join(env.H5P_MCP_DATA_DIR,'libraries'),{recursive:true});

async function connect(label){
 const client=new Client({name:'typst-benchmark',version:'1'});
 const begin=performance.now();
 try{
  await client.connect(new StdioClientTransport({command:bun,args:[entry,'stdio'],cwd:work,env,stderr:'pipe'}));
  assert((await client.listTools()).tools.some(t=>t.name==='render_typst_figure'));
  starts.push({label,ms:millis(begin)});
  return client;
 }catch(e){await client.close();throw e;}
}
async function call(client,name,args){
 const reply=await client.callTool({name,arguments:args});
 assert(!reply.isError&&reply.structuredContent&&reply.structuredContent.ok!==false,JSON.stringify(reply.content));
 return reply.structuredContent;
}
async function render(client,item,phase,round){
 const sample={phase,round,file:item.file};
 let figure;
 try{
  const start=performance.now();
  try{figure=await call(client,'render_typst_figure',{source:item.source,alt:item.alt});}
  finally{sample.ms=millis(start);}
  // Check file size and identity outside the render timer.
  for(const format of ['svg','png']){
   const name='figure.'+format,bytes=await fs.readFile(path.join(figure.directory,name));
   sample[format+'Bytes']=bytes.length;
   sample[format+'Hash']=sha(bytes);
   assert.equal(sample[format+'Hash'],figure.manifest.hashes[name]);
  }
  if(env.H5P_MCP_TYPST_RASTER_DIR)assert.equal(figure.manifest.renderPolicy,'offline-resvg-oxipng-v1');
  const pair=sample.svgHash+':'+sample.pngHash;
  if(imageHashes.has(item.file))assert.equal(pair,imageHashes.get(item.file));
  imageHashes.set(item.file,pair);
  sample.ok=true;
 }catch(error){sample.ok=false;sample.error=String(error);}
 samples.push(sample);await append('renders.jsonl',sample);
 return sample.ok?figure:null;
}
function stats(rows){
 const ms=rows.filter(r=>r.ok).map(r=>r.ms).sort((a,b)=>a-b);
 const percentile=p=>ms.length?ms[Math.ceil(p*ms.length)-1]:null;
 return {attempts:rows.length,successes:ms.length,failures:rows.length-ms.length,medianMs:percentile(.5),p95Ms:percentile(.95)};
}
async function summary(){
 await save('summary.json',{starts,flows,cases:cases.map(c=>({file:c.file,
  first:samples.find(s=>s.file===c.file&&s.phase==='first')??null,
  warm:stats(samples.filter(s=>s.file===c.file&&s.phase==='warm'))}))});
}
try{
 for(const item of cases){
  const client=await connect(item.file);
  try{assert(await render(client,item,'first',0),'First render failed for '+item.file);}
  finally{await client.close();}
 }
 const client=await connect('persistent');
 try{
  for(let round=0;round<rounds;round++){
   for(let offset=0;offset<cases.length;offset++){
    const item=cases[(round+offset)%cases.length];
    await render(client,item,'warm',round+1);
   }
   await summary();
   console.log('Measured round',round+1,'of',rounds);
  }
  // Time a teacher-facing PNG workflow separately; no preview/file checks inside render timings.
  const item=cases.find(c=>c.file==='motion.typ');
  const source=JSON.parse(await fs.readFile(new URL('motion-question.json',exampleDir),'utf8'));
  const start=performance.now();
  const figure=await call(client,'render_typst_figure',{source:item.source,alt:item.alt});
  const renderMs=millis(start);
  source.assets.grafica=figure.asset_id;
  const beforePrepare=performance.now();
  const prepared=await call(client,'prepare_stored_h5p_source',{source});
  const prepareMs=millis(beforePrepare),beforeExport=performance.now();
  const artifact=await call(client,'export_prepared_h5p_activity',{preparation_id:prepared.object_id,idempotency_key:'m6-motion'});
  const exportMs=millis(beforeExport);
  const pkg=Buffer.from((await client.readResource({uri:artifact.uri})).contents[0].blob,'base64');
  const totalMs=millis(start);
  await fs.writeFile(path.join(output,'motion.h5p'),pkg);
  flows.push({file:item.file,renderMs,prepareMs,exportMs,totalMs,bytes:pkg.length,sha256:sha(pkg)});
 }finally{await client.close();}
}finally{await summary();}
if(samples.some(s=>!s.ok))process.exitCode=1;
