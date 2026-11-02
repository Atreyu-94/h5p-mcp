import {expect,spyOn,test} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {Generations,exclusive} from '../../src/infrastructure/generations.js';

function acquire(generations:Generations,source:string,signal=AbortSignal.timeout(30000)){
 return exclusive(source,signal,()=>generations.acquire(source,signal));
}
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-generation-v1-'));
 const library=path.join(root,'libraries','H5P.Test-1.0');
 await fs.mkdir(library,{recursive:true});
 await fs.writeFile(path.join(library,'library.json'),JSON.stringify({
  machineName:'H5P.Test',title:'Test',majorVersion:1,minorVersion:0,patchVersion:0,runnable:1
 }));
 await fs.writeFile(path.join(library,'semantics.json'),'[]');
 const asset=path.join(library,'test.css');
 await fs.writeFile(asset,'old');
 return {root,asset};
}

test('restart verifies published bytes, repairs damage and keys same-size edits and settings',async()=>{
 const {root,asset}=await fixture();
 const first=new Generations(),next=new Generations();
 const copy=spyOn(fs,'cp');
 try{
  const original=await acquire(first,root);
  const oldRoot=original.root;
  await original.release();await first.close();copy.mockClear();
  const stage=path.join(path.dirname(path.dirname(oldRoot)),'staging');
  await fs.mkdir(stage);await fs.writeFile(path.join(stage,'partial'),'interrupted');
  const reused=await acquire(next,root);
  expect(reused.root).toBe(oldRoot);expect(copy).not.toHaveBeenCalled();expect(await fs.exists(stage)).toBe(false);
  const cachedAsset=path.join(oldRoot,'libraries','H5P.Test-1.0','test.css');
  await fs.writeFile(cachedAsset,'bad');
  await expect(acquire(next,root)).rejects.toMatchObject({code:'OBJECT_INTEGRITY_FAILED'});
  await reused.release();
  const repaired=await acquire(next,root);expect(await fs.readFile(cachedAsset,'utf8')).toBe('old');await repaired.release();
  await fs.writeFile(path.join(oldRoot,'cache.json'),'[]');
  const configRepair=await acquire(next,root);expect(await fs.readFile(path.join(oldRoot,'cache.json'),'utf8')).toBe('{}');await configRepair.release();
  const before=await fs.stat(asset);
  await fs.writeFile(asset,'new');await fs.utimes(asset,before.atime,before.mtime);
  const updated=await acquire(next,root);expect(updated.root).not.toBe(oldRoot);await updated.release();
  await fs.writeFile(path.join(root,'cache.json'),'[]');
  const catalog=await acquire(next,root);expect(catalog.root).not.toBe(updated.root);await catalog.release();
  await fs.writeFile(path.join(root,'config.json'),'{"enabled":true}');
  const settings=await acquire(next,root);expect(settings.root).not.toBe(catalog.root);await settings.release();
 }finally{copy.mockRestore();await next.close();await fs.rm(root,{recursive:true,force:true});}
});

test('aborted copy leaves previous generation and ephemeral fallback cleans its private root',async()=>{
 const {root,asset}=await fixture(),gen=new Generations(1);
 const mode=process.env.H5P_MCP_GENERATION_CACHE;
 try{
  const old=await acquire(gen,root);await old.release();await fs.writeFile(asset,'new');
  const abort=new AbortController(),cp=fs.cp;
  const copying=spyOn(fs,'cp').mockImplementation(async(...args)=>{await cp(...args);abort.abort();});
  try{await expect(acquire(gen,root,abort.signal)).rejects.toBeDefined();}finally{copying.mockRestore();}
  expect(await fs.readFile(path.join(old.root,'libraries','H5P.Test-1.0','test.css'),'utf8')).toBe('old');
  expect((await fs.readdir(path.dirname(path.dirname(old.root)))).sort()).toEqual(['.owned-by-h5p-mcp-v2',path.basename(path.dirname(old.root))].sort());
  const rename=spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(new Error('disk full'),{code:'ENOSPC'}));
  try{await expect(acquire(gen,root)).rejects.toMatchObject({code:'ENOSPC'});}finally{rename.mockRestore();}
  expect(await fs.readFile(path.join(old.root,'libraries','H5P.Test-1.0','test.css'),'utf8')).toBe('old');
  process.env.H5P_MCP_GENERATION_CACHE='temporary';
  const temporary=new Generations();
  const lease=await acquire(temporary,root);await lease.release();await temporary.close();
  expect(await fs.exists(lease.root)).toBe(false);expect(await fs.exists(old.root)).toBe(true);
 }finally{
  if(mode===undefined)delete process.env.H5P_MCP_GENERATION_CACHE;else process.env.H5P_MCP_GENERATION_CACHE=mode;
  await gen.close();await fs.rm(root,{recursive:true,force:true});
 }
});

test('another process keeps its pinned export while a server closes and publishes new libraries',async()=>{
 const {root,asset}=await fixture(),server=new Generations(2);
 const generations=new URL('../../src/infrastructure/generations.ts',import.meta.url).href;
 const worker=new URL('../../src/infrastructure/worker.ts',import.meta.url).href;
 const output=path.join(root,'pinned.h5p');
 const child=spawn(process.execPath,['-e',`
 import {Generations,exclusive} from ${JSON.stringify(generations)};
 import {isolated} from ${JSON.stringify(worker)};
 const [source,output]=process.argv.slice(1),g=new Generations(),signal=AbortSignal.timeout(30000);
 const lease=await exclusive(source,signal,()=>g.acquire(source,signal));
 const proceed=new Promise(resolve=>process.stdin.once('data',resolve));console.log('pinned');
 try{await proceed;await isolated({action:'export',data_dir:lease.root,path:output,activity:{title:'Pinned',language:'en',license:'U',library:'H5P.Test 1.0',params:{},assets:{}}},signal);}
 finally{await lease.release();await g.close();process.stdin.destroy();}
 `,root,output],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 const done=once(child,'close');let errors='';child.stderr.on('data',chunk=>errors+=chunk);
 try{
  await Promise.race([once(child.stdout,'data'),done.then(()=>{throw Error(errors||'Reader exited');})]);
  const shared=await acquire(server,root);await shared.release();await server.close();
  await fs.writeFile(asset,'new');
  await expect(acquire(new Generations(1),root)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
  const latest=await acquire(server,root);
  expect(await fs.readFile(path.join(latest.root,'libraries','H5P.Test-1.0','test.css'),'utf8')).toBe('new');
  await latest.release();await server.close();child.stdin.end('export');
  expect({exit:(await done)[0],errors}).toEqual({exit:0,errors:''});
  const zip=await createRequire(import.meta.url)('yauzl-promise').open(output);let css;
  try{for await(const entry of zip){if(entry.filename==='H5P.Test-1.0/test.css'){
   const chunks=[];for await(const block of await entry.openReadStream())chunks.push(block);css=Buffer.concat(chunks).toString();
  }}}finally{await zip.close();}
  expect(css).toBe('old');
  const compact=await acquire(new Generations(1),root);await compact.release();
  expect(await fs.exists(shared.root)).toBe(false);
 }finally{child.kill();await done;await server.close();await fs.rm(root,{recursive:true,force:true});}
},60000);

test('an unmarked cache preserves pre-existing staging data',async()=>{
 const first=await fixture(),other=await fixture(),gen=new Generations();
 try{
  const lease=await acquire(gen,first.root);
  const cacheName=path.basename(path.dirname(path.dirname(lease.root)));
  await lease.release();
  const stage=path.join(other.root,cacheName,'staging');
  await fs.mkdir(stage,{recursive:true});
  const foreign=path.join(stage,'keep.txt');
  await fs.writeFile(foreign,'unrelated');
  await expect(acquire(gen,other.root).then(lease=>lease.release())).rejects.toMatchObject({code:'OBJECT_INTEGRITY_FAILED'});
  expect(await fs.readFile(foreign,'utf8')).toBe('unrelated');
  // A directory with the marker's name does not identify an owned cache.
  await fs.mkdir(path.join(other.root,cacheName,'.owned-by-h5p-mcp-v2'));
  await expect(acquire(gen,other.root).then(lease=>lease.release())).rejects.toMatchObject({code:'OBJECT_INTEGRITY_FAILED'});
  expect(await fs.readFile(foreign,'utf8')).toBe('unrelated');
 }finally{
  await gen.close();
  await fs.rm(first.root,{recursive:true,force:true});await fs.rm(other.root,{recursive:true,force:true});
 }
});

test.each(['publication','capacity recovery'])('interrupted eviction during %s preserves the valid generation',async phase=>{
 const {root,asset}=await fixture(),gen=new Generations(1);
 try{
  const first=await acquire(gen,root),victim=path.dirname(first.root);
  await first.release();await fs.writeFile(asset,'new');
  if(phase==='capacity recovery'){
   const larger=new Generations(2),published=await acquire(larger,root);
   await published.release();await larger.close();
  }
  const discard=path.join(path.dirname(victim),'discard');
  const rm=fs.rm;
  const busy=spyOn(fs,'rm').mockImplementation(async(target,options)=>{
   if(target===victim||target===discard){
    await rm(path.join(String(target),'readers.sqlite'),{force:true});
    throw Object.assign(new Error('Interrupted cleanup'),{code:'EBUSY'});
   }
   return rm(target,options);
  });
  try{
   const second=await acquire(gen,root);
   await second.release();await gen.close();
   const reopened=new Generations(1);
   const lease=await acquire(reopened,root);
   expect(await fs.readFile(path.join(lease.root,'libraries','H5P.Test-1.0','test.css'),'utf8')).toBe('new');
   await lease.release();await reopened.close();
   expect(await fs.exists(discard)).toBe(true);
   await fs.writeFile(asset,'next');
   await expect(acquire(gen,root)).rejects.toMatchObject({code:'EBUSY'});
   await fs.writeFile(asset,'new');
  }finally{busy.mockRestore();}
  const restarted=new Generations(1),lease=await acquire(restarted,root);
  expect(await fs.exists(discard)).toBe(false);
  expect(await fs.exists(victim)).toBe(false);
  await lease.release();await restarted.close();
 }finally{await gen.close();await fs.rm(root,{recursive:true,force:true});}
});
