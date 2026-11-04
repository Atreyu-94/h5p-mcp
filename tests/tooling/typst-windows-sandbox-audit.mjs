import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const [settings,output]=process.argv.slice(2);
const {transport,reference}=JSON.parse(await fs.readFile(settings,'utf8'));
const client=new Client({name:'windows-isolation-probe',version:'1'});
const source=await fs.readFile(new URL('../../examples/scientific-figures/motion.typ',import.meta.url),'utf8');
const expected=JSON.parse(await fs.readFile(reference,'utf8')).cases.find(item=>item.file==='motion.typ').first;
try{
 await client.connect(new StdioClientTransport({...transport,stderr:'pipe'}));
 const run=source=>client.callTool({name:'render_typst_figure',arguments:{source,alt:'QA'}});
 const good=(await run(source)).structuredContent;
 assert(good.ok);
 assert.equal(good.manifest.hashes['figure.png'],expected.pngHash);
 const tests=[];
 for(const [label,text] of [
  ['filesystem','#read("../private.txt")'],
  ['network','#import "@preview/fletcher:0.5.8"'],
  ['pixel budget','#set page(width:2000pt,height:2000pt,margin:0pt)\nx'],
  ['memory','#let xs = range(100000000)\n#xs.len()'],
 ]){
  const reply=await run(text),failed=reply.structuredContent;
  assert.equal(failed.ok,false,label);
  assert(!failed.directory&&!failed.preview,label);
  const diagnostic=reply.content.map(item=>item.text??'').join(' ');
  if(label==='filesystem')assert.match(diagnostic,/denied|root/i);
  if(label==='network')assert.match(diagnostic,/network|dns|download|resolve/i);
  if(label==='memory'||label==='pixel budget')assert(failed.diagnostics.some(d=>d.code==='LIMIT_EXCEEDED'));
  tests.push({label,diagnostics:failed.diagnostics});
 }
 await fs.writeFile(output,JSON.stringify({ok:true,tests},null,2));
}finally{await client.close();}
