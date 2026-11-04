import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const [baseArg,outArg]=process.argv.slice(2);
const out=path.resolve(outArg),read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const prev=await read(path.join(baseArg,'samples/environment.json'));
const experiment=await read(path.join(out,'paired/environment.json'));
const root=path.join(experiment.work,'audit'),pkg=path.join(experiment.work,'node_modules','h5p-raster-audit');
await fs.cp(path.join(experiment.work,'node_modules','h5p-raster-experiment'),pkg,{recursive:true});
const jsFile=path.join(pkg,'dist/core/infrastructure/typst-sandbox.js');
const original=await fs.readFile(jsFile,'utf8');
const old="const state = JSON.parse((await docker(['inspect', '--format', '{{json .State}}', id], signal)).toString());";
assert.equal(original.split(old).length,2);
await fs.writeFile(jsFile,original.replace(old,`const container=JSON.parse((await docker(['inspect','--format','{{json .}}',id],signal)).toString());
        const state=container.State;
        const {NetworkMode,ReadonlyRootfs,CapDrop,SecurityOpt,Memory,MemorySwap,NanoCpus,PidsLimit,Ulimits}=container.HostConfig;
        await fs.appendFile(process.env.M6_AUDIT,JSON.stringify({format,image:container.Image,cmd:container.Config.Cmd,user:container.Config.User,
          NetworkMode,ReadonlyRootfs,CapDrop,SecurityOpt,Memory,MemorySwap,NanoCpus,PidsLimit,Ulimits,
          mounts:container.Mounts.map(m=>({target:m.Destination,writable:m.RW})),exitCode:state.ExitCode})+'\\n');`));
const entry=path.join(pkg,'dist/core/cli.js'),audit=path.join(out,'container-audit.jsonl');
await fs.writeFile(audit,'',{flag:'wx'});
await fs.cp(path.join(prev.work,'data/libraries'),path.join(root,'data/libraries'),{recursive:true});
const client=new Client({name:'single-render-audit',version:'1'});
async function call(name,args){
 const reply=await client.callTool({name,arguments:args});
 assert(!reply.isError&&reply.structuredContent?.ok!==false,JSON.stringify(reply.content));
 return reply.structuredContent;
}
let offset=0;
async function since(){
 const records=(await fs.readFile(audit,'utf8')).trim().split('\n').map(JSON.parse);
 const result=records.slice(offset);offset=records.length;
 for(const c of result){
  assert.equal(c.NetworkMode,'none');assert(c.ReadonlyRootfs);assert(c.CapDrop.includes('ALL'));
  assert(c.SecurityOpt.some(x=>x.startsWith('no-new-privileges')));assert.equal(c.user,'65534:65534');
  assert.equal(c.Memory,256*1024*1024);assert.equal(c.MemorySwap,c.Memory);assert.equal(c.NanoCpus,1e9);assert.equal(c.PidsLimit,64);
  assert(c.Ulimits.some(u=>u.Name==='cpu'&&u.Soft===15&&u.Hard===16));
  assert(c.mounts.every(m=>!m.writable));assert.equal(c.exitCode,0);
 }
 return result;
}
const examples=new URL('../../examples/scientific-figures/',import.meta.url);
try{
 await client.connect(new StdioClientTransport({command:'bun',args:[entry,'stdio'],cwd:root,stderr:'pipe',env:{...process.env,
  H5P_MCP_TYPST_ENABLED:'1',H5P_MCP_TYPST_SANDBOX:'docker',H5P_MCP_TYPST_PACKAGES:path.join(prev.work,'packages'),
  H5P_MCP_DATA_DIR:path.join(root,'data'),H5P_MCP_STORE_DIR:path.join(root,'store'),H5P_MCP_EXPORT_DIR:path.join(root,'exports'),M6_AUDIT:audit}}));
 const source=await fs.readFile(new URL('motion.typ',examples),'utf8');
 const activity=JSON.parse(await fs.readFile(new URL('motion-question.json',examples),'utf8'));
 const figure=await call('render_typst_figure',{source,alt:activity.image.alt});
 const containers=await since();assert.equal(containers.length,2);
 assert.equal(containers[0].cmd[0],'compile');assert(!containers[1].cmd.includes('compile'));assert.equal(containers[1].image,experiment.image);
 assert.deepEqual(containers[1].mounts,[{target:'/input',writable:false}]);
 const binary=Buffer.from((await client.readResource({uri:figure.preview.uri})).contents[0].blob,'base64');
 assert.deepEqual(binary,await fs.readFile(path.join(out,'paired','motion.typ.raster.png')));
 activity.assets.grafica=figure.asset_id;
 const prepared=await call('prepare_stored_h5p_source',{source:activity});
 const artifact=await call('export_prepared_h5p_activity',{preparation_id:prepared.object_id,idempotency_key:'raster-audit'});
 const pkgBytes=Buffer.from((await client.readResource({uri:artifact.uri})).contents[0].blob,'base64');
 const filename=path.join(out,'motion-raster.h5p');
 await fs.writeFile(filename,pkgBytes,{flag:'wx'});
 const zip=await createRequire(entry)('yauzl-promise').open(filename);
 try{
  let found=false;
  for await(const e of zip){
   if(!e.filename.endsWith('.png')||!e.filename.startsWith('content/'))continue;
   const parts=[];for await(const chunk of await e.openReadStream())parts.push(chunk);
   assert.deepEqual(Buffer.concat(parts),binary);found=true;
  }
  assert(found);
 }finally{await zip.close();}
 // A compiled source with an external link or excessive page geometry must fail before a raster container starts.
 for(const text of ['#link("https://example.invalid/")[unsafe]','#set page(width:2000pt,height:2000pt,margin:0pt)\nx']){
  const failed=await client.callTool({name:'render_typst_figure',arguments:{source:text,alt:'negative control'}});
  assert.equal(failed.structuredContent.ok,false);
  const attempt=await since();assert.equal(attempt.length,1);assert.equal(attempt[0].format,'svg');
 }
 console.log(JSON.stringify({ok:true,package:filename,packageHash:createHash('sha256').update(pkgBytes).digest('hex'),containers:offset}));
}finally{await client.close();}
