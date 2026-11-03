import {expect,test} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {compileSinglePage} from '../../src/infrastructure/typst-page.js';
import {verifyProfile} from '../../src/infrastructure/typst-profile.js';
import {renderForceSpec} from '../../src/infrastructure/typst-figure.js';

const compiler=process.env.H5P_TEST_TYPST_COMPILER;

// Real compiler controls use only synthetic local inputs. No registry imports in these fixtures.
test.skipIf(!compiler)('reviewed page runner rejects multipage output, raster overflow and reads outside the project',async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'typst-page-boundary-'));
 try{
  const root=path.join(work,'source'),packages=path.join(work,'packages'),cache=path.join(work,'cache');
  for(const dir of [root,packages,cache])await fs.mkdir(dir);
  await fs.writeFile(path.join(work,'private.txt'),'outside the figure root');
  for(const [source,reason] of [
   ['#set page(width:40pt,height:40pt,margin:0pt)\nA\n#pagebreak()\nB',/multiple images/i],
   ['#set page(width:2000pt,height:2000pt,margin:0pt)\nA',/PNG pixel budget/],
   ['#read("../private.txt")',/access denied|project root/i],
  ] as const){
   await fs.writeFile(path.join(root,'figure.typ'),source);
   await expect(compileSinglePage(compiler!,root,packages,cache)).rejects.toThrow(reason);
  }
  expect(await fs.readdir(cache)).toEqual([]);
  const reader=new AbortController();reader.abort();
  await expect(compileSinglePage(compiler!,root,packages,cache,reader.signal)).rejects.toBeDefined();
 }finally{await fs.rm(work,{recursive:true,force:true});}
},30000);

test('package imports and compiler options are rejected at the figure input boundary',async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'typst-input-boundary-'));
 try{
  const output=path.join(work,'published');
  const base={forceN:8,upLabel:'Tension',downLabel:'Weight',alt:'Opposite forces'};
  for(const extra of [{source:'#import "@preview/not-allowed:1.0.0"'},{files:{'../outside':'secret'}},{args:['--pages','1']}]){
   await expect(renderForceSpec({...base,...extra},output)).rejects.toMatchObject({code:'INVALID_PARAMETER'});
  }
  expect(await fs.readdir(work)).toEqual([]);
 }finally{await fs.rm(work,{recursive:true,force:true});}
});

test.skipIf(!compiler || !process.env.H5P_TEST_TYPST_PACKAGES)('import and file-read expressions in labels stay data; an incomplete profile publishes nothing',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'typst-literal-labels-'));
 const previous={...process.env};
 try{
  process.env.H5P_MCP_TYPST_ENABLED='1';
  process.env.H5P_MCP_TYPST_BIN=compiler;
  process.env.H5P_MCP_TYPST_PACKAGES=process.env.H5P_TEST_TYPST_PACKAGES;
  const spec={forceN:8,upLabel:'#import "@preview/not-safe:0.1.0"',downLabel:'#read("../private.txt")',alt:'Equal forces'};
  const result=await renderForceSpec(spec,path.join(root,'bundle'));
  const data=JSON.parse(await fs.readFile(path.join(result.directory,'figure.json'),'utf8'));
  expect(data.upLabel).toBe(spec.upLabel);
  expect(await fs.readFile(path.join(result.directory,'figure.typ'),'utf8')).not.toContain(spec.upLabel);
  process.env.H5P_MCP_TYPST_PACKAGES=path.join(root,'missing-packages');
  const missing=path.join(root,'missing');
  await expect(renderForceSpec(spec,missing)).rejects.toMatchObject({code:'RENDERER_UNAVAILABLE'});
  expect(await fs.exists(missing)).toBe(false);
 }finally{
  for(const key of ['H5P_MCP_TYPST_ENABLED','H5P_MCP_TYPST_BIN','H5P_MCP_TYPST_PACKAGES']){
   if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
  await fs.rm(root,{recursive:true,force:true});
 }
},30000);

test('package traversal rejects linked directories before copying external entries',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'typst-profile-links-'));
 const outside=path.join(root,'outside'),profile=path.join(root,'packages'),copy=path.join(root,'copy');
 const pkg=path.join(profile,'preview','cetz','0.5.3');
 try{
  await fs.mkdir(outside);await fs.writeFile(path.join(outside,'sentinel'),'private');
  await fs.mkdir(path.dirname(pkg),{recursive:true});
  const linkType=process.platform==='win32'?'junction':'dir';
  await fs.symlink(outside,pkg,linkType);
  try{await expect(verifyProfile(profile,copy)).rejects.toThrow('Unsupported package directory');}
  finally{await fs.unlink(pkg);}
  await fs.mkdir(pkg);
  const nested=path.join(pkg,'linked');
  await fs.symlink(outside,nested,linkType);
  try{await expect(verifyProfile(profile,copy)).rejects.toThrow('Unsupported package entry');}
  finally{await fs.unlink(nested);}
  expect(await fs.exists(copy)).toBe(false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
