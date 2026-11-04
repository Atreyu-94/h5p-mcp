import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setupFigureProfile,verifyProfile} from '../../src/infrastructure/typst-profile.js';

const cli=fileURLToPath(new URL('../../src/cli.ts',import.meta.url));
function command(args:string[],env:Record<string,string>){
 return spawnSync(process.execPath,[cli,'figure',...args],{encoding:'utf8',env:{...process.env,...env}});
}
test('figure status respects opt-in and explicit compiler selection',()=>{
 const missing=path.join(os.tmpdir(),'absent-typst-'+crypto.randomUUID());
 const off=command(['status'],{H5P_MCP_TYPST_ENABLED:'0',H5P_MCP_TYPST_BIN:missing});
 expect(JSON.parse(off.stdout)).toEqual({state:'disabled'});
 const absent=command(['status'],{H5P_MCP_TYPST_ENABLED:'1',H5P_MCP_TYPST_BIN:missing});
 expect(JSON.parse(absent.stdout).state).toBe('missing');
 const wrong=command(['status'],{H5P_MCP_TYPST_ENABLED:'1',H5P_MCP_TYPST_BIN:process.execPath});
 expect(JSON.parse(wrong.stdout).state).toBe('incompatible');
},20000);
test('an altered package tree is refused before rendering',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-test-profile-'));
 try{
  const pkg=path.join(root,'preview','cetz','0.5.3');await fs.mkdir(pkg,{recursive:true});
  await fs.writeFile(path.join(pkg,'typst.toml'),'different');
  await expect(verifyProfile(root)).rejects.toThrow('digest mismatch');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('setup rejects altered registry bytes before publishing a profile',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-test-setup-'));
 const original=globalThis.fetch,enabled=process.env.H5P_MCP_TYPST_ENABLED;
 try{
  process.env.H5P_MCP_TYPST_ENABLED='1';
  globalThis.fetch=Object.assign(async()=>new Response(new Uint8Array(249144)),original);
  await expect(setupFigureProfile(path.join(root,'profile'),new AbortController().signal)).rejects.toThrow('Unverified profile archive');
  expect(await fs.readdir(root)).toEqual([]);
 }finally{
  globalThis.fetch=original;
  if(enabled===undefined)delete process.env.H5P_MCP_TYPST_ENABLED;else process.env.H5P_MCP_TYPST_ENABLED=enabled;
  await fs.rm(root,{recursive:true,force:true});
 }
});
test.skipIf(!process.env.H5P_TEST_TYPST_PACKAGES)('verified Typst profile produces a reproducible local image without overwriting a bundle',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-test-figure-'));
 const env={H5P_MCP_TYPST_ENABLED:'1',H5P_MCP_TYPST_PACKAGES:process.env.H5P_TEST_TYPST_PACKAGES!};
 const input=path.join(root,'spec.json'),first=path.join(root,'first'),second=path.join(root,'second');
 try{
  await fs.writeFile(input,JSON.stringify({forceN:8,upLabel:'Tension',downLabel:'Weight',alt:'Equal opposite forces'}));
  const render=command(['force',input,first],env);expect(render.status).toBe(0);
  const replay=command(['force',path.join(first,'figure.json'),second],env);expect(replay.status).toBe(0);
  const {manifest}=JSON.parse(render.stdout);
  expect(manifest.image.mime).toBe('image/png');expect(manifest.image.width).toBeGreaterThan(0);
  expect(JSON.parse(replay.stdout).manifest.hashes).toEqual(manifest.hashes);
  expect(command(['force',input,first],env).status).toBe(1);
  expect(JSON.parse(await fs.readFile(path.join(first,'manifest.json'),'utf8'))).toEqual(manifest);
  await fs.writeFile(input,'{"forceN":0}');
  const invalid=path.join(root,'invalid');expect(command(['force',input,invalid],env).status).toBe(1);
  expect(await fs.exists(invalid)).toBe(false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},30000);
