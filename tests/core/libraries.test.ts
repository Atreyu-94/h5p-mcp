import {resolveLibraries} from '../../src/h5p/dependencies.js';
import {configureLimits} from '../../src/domain/limits.js';
import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FileLibraryRepository} from '../../src/h5p/libraries.js';
import {prepareActivity} from '../../src/application/authoring.js';

test('independent library repository prepares native fields and detects changed semantics',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-library-repository-'));
 try {
  const directory=path.join(root,'H5P.Test-1.0');await fs.mkdir(directory);
  const version={machineName:'H5P.Test',majorVersion:1,minorVersion:0};
  await fs.writeFile(path.join(directory,'library.json'),JSON.stringify({...version,patchVersion:2,runnable:1}));
  const semantics=path.join(directory,'semantics.json');
  await fs.writeFile(semantics,JSON.stringify([{name:'answer',type:'boolean',default:true}]));
  const libraries=new FileLibraryRepository(root);
  const activity={title:'Test',library:'H5P.Test 1.0',language:'en',license:'U',params:{}};
  const report=await prepareActivity({libraries,coreApiVersion:{major:1,minor:28}},activity);
  expect(report.ok).toBe(true);expect(report.activity.params).toEqual({answer:true});
  expect(activity.params).toEqual({});
  await fs.writeFile(semantics,JSON.stringify([{name:'answer',type:'boolean',default:false}]));
  expect((await libraries.getSemantics(version))[0].default).toBe(false);
  await fs.writeFile(path.join(directory,'library.json'),JSON.stringify({...version,majorVersion:2,patchVersion:2}));
  await expect(libraries.getLibrary(version)).rejects.toMatchObject({code:'LIBRARY_VERSION_MISMATCH'});
  await expect(libraries.getLibrary({...version,machineName:'../outside'})).rejects.toMatchObject({code:'LIBRARY_VERSION_MISMATCH'});
  expect((await fs.readdir(root)).sort()).toEqual(['H5P.Test-1.0']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('compiled native preparation reads isolated library data without loading Lumi',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-independent-repository-'));
 try {

  const directory=path.join(root,'libraries/H5P.Test-1.0');await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'library.json'),JSON.stringify({machineName:'H5P.Test',majorVersion:1,minorVersion:0,patchVersion:0,runnable:1}));
  await fs.writeFile(path.join(directory,'semantics.json'),'[]');
  await fs.mkdir(path.join(root,'node_modules'),{recursive:true});

  await fs.writeFile(path.join(root,'probe.mjs'),`import {FileLibraryRepository} from ${JSON.stringify(new URL('../../dist/core/h5p/libraries.js',import.meta.url).href)};
const repo=new FileLibraryRepository(${JSON.stringify(path.join(root,'libraries'))});
const {prepareActivity}=await import(${JSON.stringify(new URL('../../dist/core/application/authoring.js',import.meta.url).href)});
const report=await prepareActivity({libraries:repo,coreApiVersion:{major:1,minor:28}},{title:'Independent',language:'en',license:'U',library:'H5P.Test 1.0',params:{}});
if(!report.ok)throw new Error(JSON.stringify(report.diagnostics));
const fields=await repo.getSemantics({machineName:'H5P.Test',majorVersion:1,minorVersion:0});
if(fields.length!==0)throw new Error('Unexpected semantics');
const {createRequire}=await import('node:module');
if(Object.keys(createRequire(import.meta.url).cache).some(name=>name.includes('h5p-server')))throw new Error('Lumi loaded');`);
  const child=Bun.spawn([process.execPath,path.join(root,'probe.mjs')],{cwd:root,stdout:'pipe',stderr:'pipe'});
  const error=await new Response(child.stderr).text();
  expect({exit:await child.exited,error}).toEqual({exit:0,error:''});
  expect(await fs.readdir(path.join(root,'node_modules'))).toEqual([]);
  expect(await fs.exists(path.join(root,'h5p_mcp/lumi'))).toBe(false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('independent dependency graph preserves roles, nested libraries and explicit MathDisplay',async()=>{
 const dependency={machineName:'H5P.Shared',majorVersion:1,minorVersion:0};
 const records:Record<string,any>={
  'H5P.Main':{preloadedDependencies:[dependency],dynamicDependencies:[{...dependency,machineName:'H5P.Dynamic'}],editorDependencies:[{...dependency,machineName:'H5P.Editor'}]},
  'H5P.Nested':{preloadedDependencies:[dependency]},'H5P.Shared':{},'H5P.Dynamic':{},'H5P.Editor':{},'H5P.MathDisplay':{}
 };
 const repository={getLibrary:async(version:any)=>{const meta=records[version.machineName];if(!meta)throw new Error('Missing library');return {...version,patchVersion:1,...meta};},getSemantics:async()=>[]};
 const activity={library:'H5P.Main 1.0',params:{child:{library:'H5P.Nested 1.0',params:{}}}};
 const graph=await resolveLibraries(repository,activity,true);
 expect([...graph.keys()].sort()).toEqual(['H5P.Dynamic 1.0','H5P.Editor 1.0','H5P.Main 1.0','H5P.MathDisplay 1.0','H5P.Nested 1.0','H5P.Shared 1.0']);
 expect(graph.get(activity.library)!.dependencies).toEqual({preloaded:['H5P.Shared 1.0'],dynamic:['H5P.Dynamic 1.0'],editor:['H5P.Editor 1.0']});
 expect((await resolveLibraries(repository,activity)).has('H5P.MathDisplay 1.0')).toBe(false);
 records['H5P.Shared']={preloadedDependencies:[{...dependency,machineName:'H5P.Main'}]};
 await expect(resolveLibraries(repository,activity)).rejects.toThrow('Cyclic');
 records['H5P.Shared']={};delete records['H5P.Dynamic'];
 await expect(resolveLibraries(repository,activity)).rejects.toThrow('Missing library');
});

test('dependency graph enforces exact identities and traversal budgets',async()=>{
 const repository={getLibrary:async()=>({preloadedDependencies:[{machineName:'H5P.Child',majorVersion:1,minorVersion:0}]}),getSemantics:async()=>[]};
 const activity={library:'H5P.Main 1.0',params:{}};
 await expect(resolveLibraries(repository,{...activity,library:'../outside 1.0'})).rejects.toMatchObject({code:'LIBRARY_VERSION_MISMATCH'});
 try {
  configureLimits({H5P_MCP_MAX_LIBRARIES:'1'});
  await expect(resolveLibraries(repository,activity)).rejects.toThrow('node budget');
  configureLimits({H5P_MCP_MAX_DEPENDENCY_EDGES:'1'});
  await expect(resolveLibraries(repository,activity)).rejects.toThrow('edge budget');
 }finally{configureLimits({});}
});


test('native media preparation injects storage and preserves source bytes and MIME controls',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-media-port-'));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64');
 try {
  const filename=path.join(root,'picture.png');await fs.writeFile(filename,png);
  const libraries={getLibrary:async()=>({runnable:1}),getSemantics:async()=>[{name:'image',type:'image'}]};
  const activity={title:'Picture',language:'en',license:'U',library:'H5P.Test 1.0',assets:{picture:filename},params:{image:{path:'asset:picture',mime:'image/png'}}};
  let calls=0;
  const saveMedia=async(_entry:any,file:{data:Buffer})=>{calls++;expect(file.data.equals(png)).toBe(true);file.data.fill(0);return {path:'images/picture.png'};};
  const checked=await prepareActivity({libraries,coreApiVersion:{major:1,minor:28}},activity);
  expect(checked.ok).toBe(true);expect(checked.activity.params.image.path).toBe('asset:picture');expect(calls).toBe(0);
  const saved=await prepareActivity({libraries,coreApiVersion:{major:1,minor:28},saveMedia},activity);
  expect(saved.ok).toBe(true);expect(saved.activity.params.image.path).toBe('images/picture.png');expect(calls).toBe(1);
  expect((await fs.readFile(filename)).equals(png)).toBe(true);expect(activity.params.image.path).toBe('asset:picture');
  await fs.writeFile(filename,'not an image');
  const rejected=await prepareActivity({libraries,coreApiVersion:{major:1,minor:28},saveMedia},activity);
  expect(rejected.ok).toBe(false);expect(rejected.diagnostics[0].code).toBe('MIME_MISMATCH');expect(calls).toBe(1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
