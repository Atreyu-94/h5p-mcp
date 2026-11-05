import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {Database} from 'bun:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {limit} from '../domain/limits.js';
import {readBounded} from './read-bounded.js';
import {mapFiles} from './file-work.js';

/** SQLite owns the live lease. The hard link also excludes legacy mkdir clients. */
export async function exclusive<T>(root:string,signal:AbortSignal,work:()=>Promise<T>):Promise<T> {
 await fs.mkdir(root,{recursive:true});
 const lock=path.join(root,'.core-lock'),token=path.join(root,'.core-lock-v2.token');
 const db=new Database(path.join(root,'.core-lock-v2.sqlite'),{create:true});
 try{
  db.exec('PRAGMA busy_timeout=0');
  while(true){
   signal.throwIfAborted();
   try{db.exec('BEGIN IMMEDIATE');break;}
   catch(error){if((error as NodeJS.ErrnoException).code!=='SQLITE_BUSY')throw error;}
   await delay(25,undefined,{signal});
  }
  try{await fs.writeFile(token,'',{flag:'wx',mode:0o600});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const identity=await fs.lstat(token,{bigint:true});
  if(!identity.isFile()||!identity.ino)throw new Error('Invalid core lock token');
  while(true){
   signal.throwIfAborted();
   const existing=await fs.lstat(lock,{bigint:true}).catch(error=>{if(!missing(error))throw error;});
   // Holding the SQLite lease proves a matching link has no surviving v2 owner.
   if(existing?.isFile()&&existing.ino===identity.ino&&existing.dev===identity.dev)break;
   if(!existing){
    try{await fs.link(token,lock);break;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
   }
   await delay(25,undefined,{signal});
  }
  try{signal.throwIfAborted();return await work();}
  finally{await fs.unlink(lock);}
 }finally{db.close();}
}
const cacheName='.h5p-generations-v2';
const configNames=['cache.json','config.json'] as const;
const capacity=()=>Object.assign(new Error('Snapshot capacity exhausted'),{code:'LIMIT_EXCEEDED'});
const integrity=()=>Object.assign(new Error('Invalid library generation'),{code:'OBJECT_INTEGRITY_FAILED'});
const hash=()=>createHash('sha256');
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';

class SnapshotBudget extends Error {}

async function fingerprint(root:string,source:boolean,signal?:AbortSignal) {
 const tree=hash(),entries:Array<{name:string;directory:boolean}>=[];
 const buffers=Array.from({length:8},()=>Buffer.alloc(65536));
 let files=0,bytes=0;
 async function digestFile(name:string) {
  const buffer=buffers.pop()!;
  try {
   const file=await fs.open(path.join(root,'libraries',name),'r'),content=hash();
   try {
    while(true){
     signal?.throwIfAborted();
     const {bytesRead}=await file.read(buffer);if(!bytesRead)break;
     bytes+=bytesRead;if(bytes>limit('ZIP_BYTES',536870912))throw new SnapshotBudget('Snapshot byte budget exceeded');
     content.update(buffer.subarray(0,bytesRead));
    }
   }finally{await file.close();}
   return content.digest();
  }finally{buffers.push(buffer);}
 }
 async function visit(directory:string,relative:string,depth:number):Promise<void> {
  if(depth>32) throw new SnapshotBudget('Library path too deep');
  const children=await fs.readdir(directory,{withFileTypes:true});
  for(const entry of children.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
   signal?.throwIfAborted();
   const name=path.posix.join(relative,entry.name);
   if(entries.length>=limit('ZIP_MEMBERS',20000))throw new SnapshotBudget('Snapshot entry budget exceeded');
   if(entry.isDirectory()) {
    entries.push({name,directory:true});
    await visit(path.join(directory,entry.name),name,depth+1);
   } else {
    if(!entry.isFile())throw integrity();
    if(++files>limit('ZIP_MEMBERS',20000))throw new SnapshotBudget('Snapshot file budget exceeded');
    entries.push({name,directory:false});
   }
  }
 }
 signal?.throwIfAborted();
 const libraries=path.join(root,'libraries');
 const stat=await fs.lstat(libraries).catch(error=>{if(source&&missing(error))return undefined;throw error;});
 if(stat) {
  if(!stat.isDirectory())throw integrity();
  await visit(libraries,'',0);
  const digests=await mapFiles(entries.filter(e=>!e.directory),e=>digestFile(e.name),signal);
  // Scheduling may differ, but the v2 identity keeps its original traversal order.
  let index=0;
  for(const entry of entries){
   tree.update((entry.directory?'D':'F')+entry.name+'\0');
   if(!entry.directory)tree.update(digests[index++]);
  }
 }
 const key=hash().update(cacheName).update(tree.digest()),config:Record<string,Buffer>={};
 for(const name of configNames) {
  const file=path.join(root,name);
  try {
   if(!(await fs.lstat(file)).isFile())throw integrity();
   config[name]=await readBounded(file,limit('JSON_BYTES',16777216));
  } catch(error) {if(!source||!missing(error))throw error;config[name]=Buffer.from('{}');}
  key.update(hash().update(config[name]).digest());
 }
 if(!source && (await fs.readdir(root)).length!==3)throw integrity();
 return {key:key.digest('hex'),config,entries};
}

// A read transaction pins this directory across processes. The source lock serializes
// admission and eviction; release needs only to close the SQLite handle.
async function readerLock(entry:string,exclusive:boolean) {
 const filename=path.join(entry,'readers.sqlite');
 if(!(await fs.lstat(filename)).isFile())throw integrity();
 const db=new Database(filename,{readwrite:true});
 try {
  db.exec('PRAGMA busy_timeout=0');
  db.exec(exclusive?'BEGIN EXCLUSIVE':'BEGIN');
  db.query('SELECT * FROM pin').get();
  return db;
 } catch(error) {db.close();throw error;}
}
async function idle(entry:string) {
 try {(await readerLock(entry,true)).close();return true;}
 catch(error) {if((error as {code?:string}).code==='SQLITE_BUSY')return false;throw error;}
}
async function verify(entry:string,key:string,signal?:AbortSignal) {
 const data=path.join(entry,'data');
 try {
  if(!(await fs.lstat(data)).isDirectory())return false;
  return (await fingerprint(data,false,signal)).key===key;
 } catch(error) {
  signal?.throwIfAborted();
  const code=(error as {code?:string}).code;
  if(error instanceof SnapshotBudget||missing(error)||code==='ENOTDIR'||code==='OBJECT_INTEGRITY_FAILED'||code==='ASSET_TOO_LARGE')return false;
  throw error;
 }
}

// The format-specific filename is the ownership marker for this host-private cache.
// Creating an empty file with 'wx' is atomic even if the initializer exits immediately.
const ownerMarker='.owned-by-h5p-mcp-v2';
async function cacheEntries(base:string){
 await fs.mkdir(base,{recursive:true,mode:0o700});
 if(!(await fs.lstat(base)).isDirectory())throw integrity();
 const entries=await fs.readdir(base,{withFileTypes:true});
 if(entries.length===0)await fs.writeFile(path.join(base,ownerMarker),'',{flag:'wx',mode:0o600});
 else if(!entries.some(child=>child.name===ownerMarker&&child.isFile()))throw integrity();
 return entries;
}
async function idleVictim(published:Set<string>,keep:string){
 for(const candidate of published)if(candidate!==keep&&await idle(candidate))return candidate;
 throw capacity();
}

export class Generations {
 private temporary=new Map<string,string>();
 constructor(private maximum=limit('GENERATIONS',4)) {}
 /** Caller holds exclusive(source) through lookup, publication and reader admission. */
 async acquire(source:string,signal?:AbortSignal):Promise<{root:string;release:()=>Promise<void>}> {
  const input=await fingerprint(source,true,signal);
  let base=path.join(source,cacheName);
  const mode=process.env.H5P_MCP_GENERATION_CACHE??'persistent';
  if(mode==='temporary'){
   const owner=path.resolve(source);
   base=this.temporary.get(owner)??await fs.mkdtemp(path.join(os.tmpdir(),'h5p-generations-'));
   this.temporary.set(owner,base);
  }else if(mode!=='persistent')throw new Error('Invalid H5P_MCP_GENERATION_CACHE');
  const stage=path.join(base,'staging'),entry=path.join(base,input.key),discard=path.join(base,'discard');
  const entries=await cacheEntries(base);
  const published=new Set<string>();
  let cleanupError:Error|undefined;
  async function clearDiscard(){
   try{await fs.rm(discard,{recursive:true,force:true});}
   catch(error){cleanupError=error as Error;}
  }
  // The source lock prevents new readers after the idle check. Unpublish in one
  // rename so a partial recursive removal never masquerades as a live generation.
  async function retireIdle(candidate:string){
   if(cleanupError)throw cleanupError;
   await fs.rename(candidate,discard);
   published.delete(candidate);
   await clearDiscard();
  }
  for(const child of entries){
   if(child.name==='discard')await clearDiscard();
   else if(child.name==='staging')await fs.rm(stage,{recursive:true,force:true});
   else if(/^[a-f0-9]{64}$/.test(child.name)){
    if(!child.isDirectory())throw integrity();
    published.add(path.join(base,child.name));
   }
  }
  while(published.size>this.maximum)await retireIdle(await idleVictim(published,entry));
  const exists=published.has(entry);
  if(!exists||!await verify(entry,input.key,signal)){
   // A busy discard can coexist with a valid hit, but consumes the staging allowance.
   if(cleanupError)throw cleanupError;
   if(exists&&!await idle(entry))throw integrity();
   const victim=(!exists&&published.size===this.maximum)?await idleVictim(published,entry):undefined;
   await fs.mkdir(stage,{mode:0o700});
   try {
    const data=path.join(stage,'data'),libraries=path.join(data,'libraries');
    await fs.mkdir(data);
    await fs.mkdir(libraries);
    for(const entry of input.entries)if(entry.directory){
     signal?.throwIfAborted();await fs.mkdir(path.join(libraries,entry.name));
    }
    await mapFiles(input.entries.filter(e=>!e.directory),async entry=>{
     const filename=path.join(source,'libraries',entry.name);
     if(!(await fs.lstat(filename)).isFile())throw integrity();
     await fs.copyFile(filename,path.join(libraries,entry.name),fs.constants.COPYFILE_EXCL);
    },signal);
    for(const name of configNames)await fs.writeFile(path.join(data,name),input.config[name],{flag:'wx'});
    if((await fingerprint(source,true,signal)).key!==input.key||!await verify(stage,input.key,signal))throw integrity();
    const db=new Database(path.join(stage,'readers.sqlite'),{create:true});
    try {db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE pin (id INTEGER)');}finally{db.close();}
    signal?.throwIfAborted();
    if(exists)await retireIdle(entry);
    await fs.rename(stage,entry);
    if(victim)await retireIdle(victim);
   }finally{await fs.rm(stage,{recursive:true,force:true});}
  }
  signal?.throwIfAborted();
  const pin=await readerLock(entry,false);
  return {root:path.join(entry,'data'),release:async()=>{pin.close();}};
 }
 async close(){for(const dir of this.temporary.values())await fs.rm(dir,{recursive:true,force:true});this.temporary.clear();}
}
