import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {preflight} from '../../src/infrastructure/archive.js';
import {publishFile} from '../../src/infrastructure/publish-file.js';
import {load} from '../../src/infrastructure/runtime.js';
import {configureLimits} from '../../src/domain/limits.js';
import {Engine} from '../../src/application/engine.js';
import {isolated} from '../../src/infrastructure/worker.js';
function zip(entries:Array<[string,string,number?]>) {
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [filename,text,mode=0x8000] of entries) {
  const name=Buffer.from(filename),data=Buffer.from(text),crc=load('@node-rs/crc32').crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);
  header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,data);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(0x314,4);
  directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt32LE(crc,16);
  directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);
  directory.writeUInt32LE((mode*65536)>>>0,38);directory.writeUInt32LE(offset,42);
  central.push(directory,name);offset+=header.length+name.length+data.length;
 }
 const records=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);
 end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(records.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,records,end]);
}
test('preflight drains ignored entries, checks CRC, JSON roots and portable collisions',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-zip-test-')),file=path.join(root,'test.h5p');
 const valid:Array<[string,string,number?]>=[['h5p.json','{"mainLibrary":"X","preloadedDependencies":[{}]}'],['content/content.json','{}']];
 try {
  await fs.writeFile(file,zip(valid));await preflight(file,true);
  await fs.writeFile(file,zip([['a'.repeat(3000)+'/empty','']]));
  await expect(preflight(file)).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
  configureLimits({H5P_MCP_MAX_ZIP_PATH_INDEX_BYTES:'20'});
  await fs.writeFile(file,zip([['abc/def',''],['ghi/jkl','']]));
  await expect(preflight(file)).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
  configureLimits({});
  for(const extra of [[['../outside','x']],[['a','x'],['A','x']],[['straße','x'],['STRASSE','x']],[['a','x'],['a/b','x']],[['CON.txt','x']],[['link','x',0xa000]]]) {
   await fs.writeFile(file,zip([...valid,...extra] as Array<[string,string,number?]>));
   await expect(preflight(file,true)).rejects.toThrow('Archive rejected');
  }
  const corrupt=zip([...valid,['_ignored','tampered']]);const location=corrupt.indexOf(Buffer.from('tampered'));corrupt[location]=0;
  await fs.writeFile(file,corrupt);await expect(preflight(file,true)).rejects.toThrow();
  await fs.writeFile(file,zip([['h5p.json','[]'],['content/content.json','{}']]));await expect(preflight(file,true)).rejects.toThrow();
  await fs.writeFile(file,zip(valid));configureLimits({H5P_MCP_MAX_ZIP_MEMBERS:'1'});
  await expect(preflight(file,true)).rejects.toThrow();
 } finally {configureLimits({});await fs.rm(root,{recursive:true,force:true});}
});
test('native publication fallback is atomic and does not replace an existing file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-publish-test-'));
 const source=path.join(root,'source'),target=path.join(root,'target');
 const unsupported=async()=>{throw Object.assign(new Error(),{code:'ENOTSUP'});};
 try {
  await fs.writeFile(source,'complete');
  await publishFile(source,target,unsupported);
  expect(await fs.readFile(target,'utf8')).toBe('complete');
  await fs.writeFile(source,'replacement');
  await expect(publishFile(source,target,unsupported)).rejects.toMatchObject({code:'EEXIST'});
  expect(await fs.readFile(target,'utf8')).toBe('complete');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('cancelled snapshot acquisition releases its lock and engine remains usable',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-cancel-test-')),engine=new Engine();
 try {
  const controller=new AbortController();controller.abort();
  await expect(engine.run({action:'catalog',data_dir:root},controller.signal)).rejects.toThrow();
  const result=await engine.run({action:'catalog',data_dir:root});
  expect(result).toMatchObject({libraries:{}});
 }finally{await engine.close();await fs.rm(root,{recursive:true,force:true});}
});
test('aborted isolated worker is reaped before its temporary directory is removed',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-worker-cancel-test-'));
 const before=new Set((await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('h5p-worker-core-')));
 try {
  const controller=new AbortController();controller.abort();
  await expect(isolated({action:'catalog',data_dir:root},controller.signal)).rejects.toMatchObject({code:'BACKEND_TIMEOUT'});
  const after=(await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('h5p-worker-core-')&&!before.has(name));
  expect(after).toEqual([]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
