import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runFigureProcess} from '../../src/infrastructure/typst-process.js';
import {installCompiler,removeCompiler,releaseFor} from '../../src/infrastructure/typst-compiler.js';
import {Service} from '../../src/adapters/service.js';
import {Remote} from '../../src/http/service.js';
import {valid} from '../../src/adapters/contracts.js';
import type {HttpConfig,Identity} from '../../src/http/auth.js';

function restore(key:string,old:string|undefined){if(old===undefined)delete process.env[key];else process.env[key]=old;}

test('managed releases select the official archive for each supported architecture',()=>{
 for(const platform of ['win32','linux','darwin'])for(const arch of ['x64','arm64']){
  const release=releaseFor(platform,arch);
  expect(release.archive).toMatch(/^[a-f0-9]{64}$/);
  expect(release.binary).toMatch(/^[a-f0-9]{64}$/);
  expect(release.target.startsWith(arch==='x64'?'x86_64-':'aarch64-')).toBe(true);
 }
 expect(()=>releaseFor('win32','ia32')).toThrow('Configure H5P_MCP_TYPST_BIN');
});

test('figure subprocesses stop on timeout or cancellation and bound captured bytes',async()=>{
 const idle=['-e','setTimeout(()=>{},10000)'];
 await expect(runFigureProcess(process.execPath,idle,undefined,64,50)).rejects.toThrow('timed out');
 const controller=new AbortController();
 const job=runFigureProcess(process.execPath,idle,controller.signal);
 controller.abort();await expect(job).rejects.toThrow('cancelled');
 await expect(runFigureProcess(process.execPath,['-e','console.log("0123456789")'],undefined,4)).rejects.toThrow('budget');
});
test('failed repair keeps the active selection and removal preserves unrelated files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-typst-repair-'));
 const dir=path.join(root,'typst-managed'),build='build-'+crypto.randomUUID(),generation=path.join(dir,build);
 const enabled=process.env.H5P_MCP_TYPST_ENABLED,data=process.env.H5P_MCP_DATA_DIR,original=globalThis.fetch;
 const signal=new AbortController().signal;
 try{
  process.env.H5P_MCP_TYPST_ENABLED='1';process.env.H5P_MCP_DATA_DIR=root;
  await fs.mkdir(generation,{recursive:true});
  const release=releaseFor(process.platform,process.arch);
  await fs.writeFile(path.join(generation,'receipt.json'),JSON.stringify({format:1,name:build,version:'0.15.1',target:release.target,sha256:release.binary}));
  await fs.writeFile(path.join(dir,'active'),build);
  await fs.writeFile(path.join(generation,'teacher.txt'),'keep');
  globalThis.fetch=Object.assign(async()=>new Response(new Uint8Array(release.size)),original);
  await expect(installCompiler(signal,true)).rejects.toThrow('Unverified');
  expect(await fs.readFile(path.join(dir,'active'),'utf8')).toBe(build);
  globalThis.fetch=Object.assign(async()=>new Response(new ReadableStream({start(stream){stream.error(new Error('interrupted'));}})),original);
  await expect(installCompiler(signal,true)).rejects.toThrow('interrupted');
  expect((await fs.readdir(dir)).sort()).toEqual(['active',build].sort());
  expect((await removeCompiler(signal)).removed).toBe(1);
  expect(await fs.readFile(path.join(generation,'teacher.txt'),'utf8')).toBe('keep');
 }finally{
  globalThis.fetch=original;restore('H5P_MCP_DATA_DIR',data);restore('H5P_MCP_TYPST_ENABLED',enabled);
  await fs.rm(root,{recursive:true,force:true});
 }
});

test('renderer discovery is local, opt-in and independent of executable availability',async()=>{
 const enabled=process.env.H5P_MCP_TYPST_ENABLED,bin=process.env.H5P_MCP_TYPST_BIN;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-figure-discovery-'));
 const exportRoot=process.env.H5P_MCP_EXPORT_DIR;
 process.env.H5P_MCP_EXPORT_DIR=root;
 process.env.H5P_MCP_TYPST_ENABLED='0';const off=new Service();
 process.env.H5P_MCP_TYPST_ENABLED='1';process.env.H5P_MCP_TYPST_BIN=path.join(root,'absent');const local=new Service();
 const remote=new Remote({scopes:['h5p:read','h5p:author'],extra:{principal:{tenant:'t',owner:'o'}}} as Identity,
  {data:root,store:root,immutable:false} as HttpConfig);
 try{
  expect(off.tools().some(t=>t.name==='render_force_figure')).toBe(false);
  expect(local.tools().some(t=>t.name==='render_force_figure')).toBe(true);
  expect(remote.tools().some(t=>t.name==='render_force_figure')).toBe(false);
  await expect(remote.call('render_force_figure',{})).rejects.toThrow();
  const bad=await local.call('render_force_figure',{source:'#read("private")'});
  expect(bad.structuredContent.diagnostics[0].code).toBe('SCHEMA_VALIDATION_FAILED');
  const result=await local.call('render_force_figure',{forceN:8,upLabel:'Tension',downLabel:'Weight',alt:'Opposite arrows'});
  expect(result.structuredContent.diagnostics[0].code).toBe('RENDERER_UNAVAILABLE');
  expect(valid('error_report',result.structuredContent)).toBe(true);
 }finally{
  await off.close();await local.close();await remote.close();
  restore('H5P_MCP_TYPST_ENABLED',enabled);restore('H5P_MCP_TYPST_BIN',bin);restore('H5P_MCP_EXPORT_DIR',exportRoot);
  await fs.rm(root,{recursive:true,force:true});
 }
});
