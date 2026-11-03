import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

// Instrument only a disposable install of the tarball used by the first M6 run.
const [baseArg,outputArg]=process.argv.slice(2);
if(!outputArg)throw new Error('Usage: node typst-stage-benchmark.mjs <baseline-run> <new-output-directory>');
const base=path.resolve(baseArg),out=path.resolve(outputArg);
await fs.mkdir(out);
const json=async filename=>JSON.parse(await fs.readFile(filename,'utf8'));
const save=async(name,data)=>fs.writeFile(path.join(out,name),JSON.stringify(data,null,2)+'\n');
const exec=promisify(execFile);
const baseline=await json(path.join(base,'install.json'));
const prior=await json(path.join(base,'samples','environment.json'));
const expected=(await json(path.join(base,'samples','summary.json'))).cases;
const tar=path.join(base,'h5p-mcp-0.1.0.tgz');
assert.equal(createHash('sha256').update(await fs.readFile(tar)).digest('hex'),baseline.tarballSHA256.toLowerCase());
const work=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-stage-bench-'));
await fs.writeFile(path.join(work,'package.json'),JSON.stringify({private:true,dependencies:{'h5p-mcp':'file:'+tar}}));
await exec('bun',['install','--ignore-scripts','--backend=copyfile'],{cwd:work,windowsHide:true});
const dist=path.join(work,'node_modules','h5p-mcp','dist','core');
async function edit(file,replacements){
 const name=path.join(dist,file);
 let js=await fs.readFile(name,'utf8');
 for(const [original,replacement] of replacements){
  assert.equal(js.split(original).length,2,'Unexpected installed implementation: '+original);
  js=js.replace(original,()=>replacement);
 }
 await fs.writeFile(name,js);
}
const timed=(key,expr)=>'globalThis.benchTime('+JSON.stringify(key)+',()=>'+expr+')';
const inside='read -r begin rest </proc/uptime; /bin/typst "$@"; status=$?; read -r end rest </proc/uptime; printf "M6_TIME %s %s\\n" "$begin" "$end" >&2; exit "$status"';
await edit('infrastructure/typst-sandbox.js',[
 ["return runFigureProcess('docker'", "return globalThis.benchTime('docker.'+args[0],()=>runFigureProcess('docker'"],
 ['maxStdout, timeoutMs: 20000 });','maxStdout, timeoutMs: 20000 }));'],
 ["sandboxImage, 'compile',", "'--entrypoint','/bin/sh',sandboxImage,'-c',"+JSON.stringify(inside)+",'m6-timer','compile',"],
 ['const id = (await docker(args))','globalThis.benchFormat=format;\n    const id = (await docker(args))'],
 ...[['profile','verifyProfile(configured, packages, selected)'],['bundle','publishFigure(output, files, manifest, signal)'],
  ['cleanup','fs.rm(work, { recursive: true, force: true })']].map(([key,expr])=>[expr,timed(key,expr)])
]);
await edit('infrastructure/typst-process.js',[
 ['resolve(Buffer.concat(stdout));',`{
                   if(executable==='docker' && args.includes('--attach')){
                     const match=/^M6_TIME ([0-9.]+) ([0-9.]+)$/m.exec(Buffer.concat(stderr).toString());
                     if(!match){reject(new Error('Missing compiler clock'));return;}
                     globalThis.benchEvents.push({key:'typst',format:globalThis.benchFormat,ms:(Number(match[2])-Number(match[1]))*1000});
                   }
                   resolve(Buffer.concat(stdout));
               }`]
]);
const upload="(await this.vault()).upload('asset', 'image/png', createReadStream(path.join(directory, 'figure.png')), 86400000, signal, name === 'render_typst_figure' ? args.source : undefined)";
await edit('adapters/service.js',[
 ["const parent = await this.authorize(this.exportDir, 'EXPORT');","globalThis.benchEvents=[];globalThis.benchFormat=null;\n                const parent = await this.authorize(this.exportDir, 'EXPORT');"],
 ['const asset = await '+upload+';',`const storeStart=performance.now();const asset=await ${upload};
                      globalThis.benchEvents.push({key:'vault',ms:performance.now()-storeStart});
                      await fs.writeFile(process.env.M6_TRACE, JSON.stringify(globalThis.benchEvents));`]
]);
const entry=path.join(dist,'cli.js');
await fs.writeFile(entry,`globalThis.benchTime=async(key,fn)=>{const start=performance.now();try{return await fn()}finally{globalThis.benchEvents.push({key,format:globalThis.benchFormat,ms:performance.now()-start})}};\n`+(await fs.readFile(entry,'utf8')).replace(/^#![^\n]*\n/,''));
const trace=path.join(work,'trace.json');
const env={...process.env,H5P_MCP_TYPST_ENABLED:'1',H5P_MCP_TYPST_SANDBOX:'docker',
 H5P_MCP_TYPST_PACKAGES:path.join(prior.work,'packages'),H5P_MCP_DATA_DIR:path.join(work,'data'),
 H5P_MCP_STORE_DIR:path.join(work,'store'),H5P_MCP_EXPORT_DIR:path.join(work,'exports'),
 H5P_MCP_EXPORT_ROOTS:JSON.stringify([work]),M6_TRACE:trace};
const exampleDir=new URL('../../examples/scientific-figures/',import.meta.url);
const cases=await json(new URL('learner-es.json',exampleDir));
for(const item of cases)item.source=await fs.readFile(new URL(item.file,exampleDir),'utf8');
const sessions=[];
async function session(commandEntry){
 const client=new Client({name:'typst-stage-bench',version:'1'});
 await client.connect(new StdioClientTransport({command:'bun',args:[commandEntry,'stdio'],env,cwd:work,stderr:'pipe'}));
 sessions.push(client);return client;
}
const rows=[];
async function sample(client,item,round,mode){
 const row={mode,file:item.file,round};
 try{
  const begin=performance.now();
  const reply=await client.callTool({name:'render_typst_figure',arguments:{source:item.source,alt:item.alt}});
  row.ms=performance.now()-begin;
  assert(reply.structuredContent?.ok,JSON.stringify(reply.content));
  for(const format of ['svg','png']){
   const bytes=await fs.readFile(path.join(reply.structuredContent.directory,'figure.'+format));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.find(c=>c.file===item.file).first[format+'Hash']);
  }
  if(mode!=='control'){
   row.trace=await json(trace);
   const sum=key=>row.trace.filter(e=>e.key===key).reduce((s,e)=>s+e.ms,0);
   assert.equal(row.trace.filter(e=>e.key==='typst').length,2);
   assert.equal(row.trace.filter(e=>e.key.startsWith('docker.')).length,10);
   row.typst=sum('typst');
   row.docker=row.trace.filter(e=>e.key.startsWith('docker.')).reduce((s,e)=>s+e.ms,0)-row.typst;
   row.profile=sum('profile');row.bundle=sum('bundle');row.vault=sum('vault');row.cleanup=sum('cleanup');
   row.other=row.ms-row.docker-row.typst-row.profile-row.bundle-row.vault-row.cleanup;
   assert(row.docker>=0 && row.other>=0);
  }
  row.ok=true;
 }catch(error){row.ok=false;row.error=String(error);}
 rows.push(row);await fs.appendFile(path.join(out,'samples.jsonl'),JSON.stringify(row)+'\n');
 return row.ok;
}
await save('environment.json',{commit:baseline.commit,tarball:baseline.tarballSHA256,work,originalEntry:prior.entry,entry,
 cpu:os.cpus()[0].model,os:os.version(),docker:(await exec('docker',['info','--format','{{.ServerVersion}} / {{.OSType}} / {{.NCPU}} / {{.MemTotal}}'])).stdout.trim(),
 timing:'Linux /proc/uptime, 10 ms resolution. Typst wall time nested within start --attach. Docker category subtracts this interval.'});
try{
 const measured=await session(entry),control=await session(prior.entry);
 for(const item of cases)assert(await sample(measured,item,0,'warmup'),'Warmup failed; see samples.jsonl');
 for(let round=1;round<=30;round++){
  for(let offset=0;offset<cases.length;offset++){
   const item=cases[(round-1+offset)%cases.length];
   const before=round%10===1,after=round%10===0;
   if(before)await sample(control,item,round,'control');
   await sample(measured,item,round,'measured');
   if(after)await sample(control,item,round,'control');
  }
  console.log('Round',round,'of 30');
 }
}finally{await Promise.all(sessions.map(c=>c.close()));}
const summary=cases.map(item=>{
 const group=rows.filter(r=>r.file===item.file&&r.mode==='measured'&&r.ok);
 const keys=['ms','docker','typst','profile','bundle','vault','cleanup','other'];
 const stats=values=>{const a=values.toSorted((x,y)=>x-y);return {mean:a.reduce((n,x)=>n+x,0)/a.length,median:a[Math.ceil(a.length/2)-1],p95:a[Math.ceil(.95*a.length)-1]};};
 return {file:item.file,n:group.length,metrics:Object.fromEntries(keys.map(key=>[key,stats(group.map(r=>r[key]))])),
  control:stats(rows.filter(r=>r.mode==='control'&&r.ok&&r.file===item.file).map(r=>r.ms))};
});
await save('summary.json',{cases:summary,failures:rows.filter(r=>!r.ok)});
if(rows.some(r=>!r.ok))process.exitCode=1;
