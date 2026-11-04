import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

// Config describes a private stdio install (native or wsl.exe). Time from the Windows client.
const [configPath,out,roundArg]=process.argv.slice(2);
const config=JSON.parse(await fs.readFile(configPath,'utf8'));
const rounds=Number(roundArg);
assert(Number.isInteger(rounds)&&rounds>0);
await fs.mkdir(out);
const dataset=new URL('../../examples/scientific-figures/',import.meta.url);
const cases=JSON.parse(await fs.readFile(new URL('learner-es.json',dataset),'utf8'));
const reference=JSON.parse(await fs.readFile(config.reference,'utf8')).cases;
const client=new Client({name:'windows-render-timing',version:'1'});
const rows=[];
try{
 await client.connect(new StdioClientTransport({...config.transport,env:{...process.env,...config.transport.env},stderr:'pipe'}));
 for(let round=0;round<=rounds;round++){
  for(let offset=0;offset<cases.length;offset++){
   const item=cases[(round+offset)%cases.length];
   const source=await fs.readFile(new URL(item.file,dataset),'utf8');
   const start=performance.now();
   const reply=await client.callTool({name:'render_typst_figure',arguments:{source,alt:item.alt}});
   const ms=performance.now()-start;
   assert(reply.structuredContent?.ok,JSON.stringify(reply.content));
   const {directory,manifest,preview}=reply.structuredContent;
   let timings;
   if(config.trace){
    const local=directory.startsWith('/')?'//wsl.localhost/Ubuntu'+directory:directory;
    timings=JSON.parse(await fs.readFile(path.join(local,'timings.json'),'utf8'));
   }
   const expected=reference.find(c=>c.file===item.file).first;
   assert.equal(manifest.renderPolicy,config.policy??'offline-resvg-oxipng-v1');
   assert.equal(manifest.hashes['figure.svg'],expected.svgHash);
   const image=(await client.readResource({uri:preview.uri})).contents[0];
   assert.equal(createHash('sha256').update(Buffer.from(image.blob,'base64')).digest('hex'),expected.pngHash);
   const row={file:item.file,round,ms,timings};
   await fs.appendFile(path.join(out,'samples.jsonl'),JSON.stringify(row)+'\n');
   rows.push(row);
  }
 }
}finally{await client.close();}
const percentile=(a,p)=>a.toSorted((x,y)=>x-y)[Math.ceil(p*a.length)-1];
const report=cases.map(c=>{
 const samples=rows.filter(r=>r.round&&r.file===c.file);
 const values=samples.map(r=>r.ms);
 const durations={};
 for(const sample of samples)for(const [name,ms] of sample.timings??[])durations[name]=(durations[name]??0)+ms/samples.length;
 return {file:c.file,n:samples.length,median:percentile(values,.5),p95:percentile(values,.95),meanStages:durations};
});
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
