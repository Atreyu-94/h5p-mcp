import {execFileSync} from 'node:child_process';
import {expect,test} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Service} from '../../src/adapters/service.js';
import {renderTypstFigure} from '../../src/infrastructure/typst-sandbox.js';

const dockerTest=test.skipIf(process.env.H5P_TEST_TYPST_DOCKER!=='1');
const figures=[
 {file:'parabola',alt:'Graph of y = x squared between -1 and 1'},
 {file:'energy',alt:'Two energy levels E1 and E2 with an upward transition'},
];

dockerTest('independent authored drawings compile through local MCP and yield editable source, SVG and stored PNG',async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'typst-e2e-'));
 const previous=process.env.H5P_MCP_EXPORT_DIR;
 process.env.H5P_MCP_EXPORT_DIR=work;
 const service=new Service(undefined,{data:work,store:path.join(work,'store')});
 try{
  const hashes=[];
  for(const figure of figures){
   const source=await fs.readFile(new URL('../fixtures/typst/'+figure.file+'.typ',import.meta.url),'utf8');
   const result=(await service.call('render_typst_figure',{source,alt:figure.alt})).structuredContent;
   if(!result.ok)throw new Error(JSON.stringify(result));
   expect(await fs.readFile(path.join(result.directory,'figure.typ'),'utf8')).toBe(source);
   expect(await fs.readFile(path.join(result.directory,'figure.svg'),'utf8')).toContain('<svg');
   const png=await fs.readFile(path.join(result.directory,'figure.png'));
   const preview=await service.readResource(result.preview.uri);
   expect(Buffer.from(preview.contents[0].blob,'base64').equals(png)).toBe(true);
   hashes.push(result.manifest.hashes['figure.png']);
  }
  expect(new Set(hashes).size).toBe(2);
  const invalid=await service.call('render_typst_figure',{source:'#unknown_function()',alt:'invalid'});
  expect(invalid.content.some((part:{text?:string})=>part.text?.includes('unknown_function'))).toBe(true);
 }finally{
  await service.close();
  if(previous===undefined)delete process.env.H5P_MCP_EXPORT_DIR;else process.env.H5P_MCP_EXPORT_DIR=previous;
  await fs.rm(work,{recursive:true,force:true});
 }
},120000);

dockerTest('isolated sources cannot read outside, fetch a package, exhaust host RAM or publish invalid output',async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'typst-denied-')),out=path.join(work,'output');
 try{
  for(const [source,reason] of [
   ['#read("../outside.txt")',/denied|root/i],
   ['#import "@preview/fletcher:0.5.8"',/network|dns|download|resolve/i],
   ['A\n#pagebreak()\nB',/multiple images/i],
   ['#set page(width:2000pt,height:2000pt,margin:0pt)\nx',/pixel budget/i],
   ['#let xs = range(100000000)\n#xs.len()',/memory|137/i],
  ] as const){
   await expect(renderTypstFigure({source,alt:'test'},out)).rejects.toThrow(reason);
   expect(await fs.exists(out)).toBe(false);
  }
 }finally{await fs.rm(work,{recursive:true,force:true});}
},120000);

dockerTest('cancelling a running source removes its constrained container',async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'typst-abort-'));
 const controller=new AbortController();
 const docker=(args:string[])=>execFileSync('docker',['--host',process.platform==='win32'?
  'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock',...args],{encoding:'utf8'}).trim();
 const list=()=>docker(['ps','--filter','name=h5p-typst-','--format','{{.ID}}']).split(/\s+/);
 const previous=new Set(list());
 const request=renderTypstFigure({source:'#let total = range(5000).map(i => range(5000).map(j => calc.sin((i+j)*1rad)).sum()).sum()\n#total',alt:'cancel'},
  path.join(work,'output'),controller.signal).then(()=>null,error=>error);
 try{
  let id:string|undefined;
  for(let attempt=0;attempt<60 && !id;attempt++){
   await Bun.sleep(100);
   id=list().find(candidate=>candidate && !previous.has(candidate));
  }
  if(!id)throw new Error('Compiler exited before cancellation probe: '+String(await request));
  const config=JSON.parse(docker(['inspect','--format','{{json .HostConfig}}',id!]));
  expect(config.NetworkMode).toBe('none');
  expect(config.Memory).toBe(256*1024*1024);
  expect(config.MemorySwap).toBe(config.Memory);
  expect(config.ReadonlyRootfs).toBe(true);
  controller.abort();
  expect((await request)?.code).toBe('BACKEND_TIMEOUT');
  expect(docker(['ps','-a','--filter','id='+id,'--format','{{.ID}}'])).toBe('');
  expect(await fs.exists(path.join(work,'output'))).toBe(false);
 }finally{controller.abort();await request;await fs.rm(work,{recursive:true,force:true});}
},60000);
