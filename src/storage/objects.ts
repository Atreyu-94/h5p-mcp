import {Database} from 'bun:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {checkTree} from '../domain/limits.js';
import {readBounded} from '../infrastructure/media.js';
import type {Native} from '../domain/types.js';
export type Kind='asset'|'package'|'preparation'|'artifact'|'libraries'|'target'|'schema';
export interface Principal {tenant:string;owner:string}
export const storageError=(code:string)=>Object.assign(new Error(code),{code});
export const canonical=(v:Native):Native=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const digest=(v:Native)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
interface Row {id:string;tenant:string;owner:string;kind:Kind;state:string;expires:number;lease:number;metadata:string;files:string;bytes:number}
export interface Stored {id:string;kind:Kind;expires:number;root:string;metadata:Native;files:Record<string,{size:number;sha256:string}>}
/** Host-private store. Principal comes from the host, never an MCP argument. */
export class Objects {
 private db!:Database;
 readonly principal:Readonly<Principal>;
 constructor(readonly root:string,principal:Principal,readonly now=Date.now,readonly budgets={bytes:536870912,tenantBytes:2147483648,count:4096,seconds:300}) {
  if(!path.isAbsolute(root)||!principal.tenant||!principal.owner) throw storageError('PERMISSION_DENIED');
  this.principal=Object.freeze({...principal});
 }
 async initialize() {
  await fs.mkdir(path.join(this.root,'objects'),{recursive:true});
  this.db=new Database(path.join(this.root,'index.sqlite'),{create:true});
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY,tenant TEXT,owner TEXT,kind TEXT,state TEXT,expires INTEGER,lease INTEGER,metadata TEXT,files TEXT,bytes INTEGER);
   CREATE INDEX IF NOT EXISTS ownership ON objects(tenant,owner,state);
   CREATE TABLE IF NOT EXISTS requests(tenant TEXT,owner TEXT,key TEXT,digest TEXT,id TEXT,PRIMARY KEY(tenant,owner,key));
   CREATE TABLE IF NOT EXISTS pointers(tenant TEXT,owner TEXT,name TEXT,id TEXT,PRIMARY KEY(tenant,owner,name));`);
  this.db.transaction(()=>{
   if(!this.db.query("SELECT 1 FROM pragma_table_info('objects') WHERE name='cleaned'").get())
    this.db.exec('ALTER TABLE objects ADD COLUMN cleaned INTEGER NOT NULL DEFAULT 0');
  }).immediate();
  this.db.exec(`CREATE INDEX IF NOT EXISTS cleanup_queue ON objects(cleaned,state,expires);
   CREATE INDEX IF NOT EXISTS staging_lease ON objects(state,lease);
   CREATE INDEX IF NOT EXISTS request_object ON requests(id);
   CREATE INDEX IF NOT EXISTS pointer_object ON pointers(id)`);
  await this.collect();
 }
 private row(id:string):Row {
  if(!/^[a-f0-9]{32}$/.test(id)) throw storageError('OBJECT_NOT_FOUND');
  const row=this.db.query('SELECT * FROM objects WHERE id=? AND tenant=? AND owner=?').get(id,this.principal.tenant,this.principal.owner) as Row|null;
  if(row?.state==='expired') throw storageError('OBJECT_EXPIRED');
  if(!row||row.state!=='ready') throw storageError('OBJECT_NOT_FOUND');
  if(row.expires<=this.now()) throw storageError('OBJECT_EXPIRED');
  return row;
 }
 private async inventory(root:string,signal?:AbortSignal) {
  const files:Stored['files']={};let total=0,count=0;
  const visit=async(dir:string,depth:number):Promise<void>=>{
   if(depth>32) throw storageError('LIMIT_EXCEEDED');
   for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    signal?.throwIfAborted();
    const filename=path.join(dir,entry.name);
    if(entry.isSymbolicLink()||(!entry.isFile()&&!entry.isDirectory())) throw storageError('OBJECT_INTEGRITY_FAILED');
    if(entry.isDirectory()){await visit(filename,depth+1);continue;}
    if(++count>20000) throw storageError('LIMIT_EXCEEDED');
    const hash=createHash('sha256');let size=0;
    const file=await fs.open(filename,'r');
    try {for await(const chunk of file.createReadStream()){signal?.throwIfAborted();size+=chunk.length;total+=chunk.length;if(total>this.budgets.bytes) throw storageError('LIMIT_EXCEEDED');hash.update(chunk);}}
    finally{await file.close();}
    files[path.relative(root,filename).split(path.sep).join('/')]={size,sha256:hash.digest('hex')};
   }
  };
  await visit(root,0);return {files,total};
 }
 async get(id:string,kind?:Kind):Promise<Stored> {
  const row=this.row(id);if(kind&&row.kind!==kind) throw storageError('OBJECT_NOT_FOUND');
  const root=path.join(this.root,'objects',id);
  try {
   const actual=await this.inventory(root);
   if(digest(actual.files)!==digest(JSON.parse(row.files))||actual.total!==row.bytes) throw storageError('OBJECT_INTEGRITY_FAILED');
  }catch(error:Native){if(error.code==='OBJECT_INTEGRITY_FAILED') throw error;throw storageError('OBJECT_INTEGRITY_FAILED');}
  this.row(id); // Recheck expiry/revocation after I/O.
  return {id,kind:row.kind,expires:row.expires,root,metadata:JSON.parse(row.metadata),files:JSON.parse(row.files)};
 }
 payloadSize(id:string,kind:Kind):number {
  const row=this.row(id);
  if(row.kind!==kind)throw storageError('OBJECT_NOT_FOUND');
  return JSON.parse(row.files).payload.size;
 }
 async read(id:string,kind:Kind,file='payload'):Promise<Buffer> {
  const value=await this.get(id,kind);
  if(!Object.hasOwn(value.files,file)) throw storageError('OBJECT_NOT_FOUND');
  const bytes=await readBounded(path.join(value.root,file),value.files[file].size);
  if(bytes.length!==value.files[file].size||createHash('sha256').update(bytes).digest('hex')!==value.files[file].sha256) throw storageError('OBJECT_INTEGRITY_FAILED');
  this.row(id);return bytes;
 }
 /** One object contains all payload files and its manifest; SQLite is its publication barrier. */
 async publish(kind:Kind,ttl:number,writer:(stage:string,final:string,signal:AbortSignal)=>Promise<Native>,options:{key?:string;digest?:string;schemaHash?:string;signal?:AbortSignal}={}):Promise<Stored> {
  const signal=AbortSignal.any([AbortSignal.timeout(this.budgets.seconds*1000),...(options.signal?[options.signal]:[])]);
  if(!Number.isSafeInteger(ttl)||ttl<1||ttl>31536000000) throw storageError('SCHEMA_VALIDATION_FAILED');
  if(options.key!==undefined&&(!options.key||options.key.length>200||!/^[a-f0-9]{64}$/.test(options.digest||''))) throw storageError('SCHEMA_VALIDATION_FAILED');
  await this.collect();
  let id='';const deadline=this.now()+this.budgets.seconds*1000;
  while(!id) {
   signal.throwIfAborted();
   const claim=this.db.transaction(()=>{
    if(kind==='schema' && options.schemaHash){
     const prior=this.db.query("SELECT id,state FROM objects WHERE tenant=? AND owner=? AND kind='schema' AND COALESCE(json_extract(metadata,'$.schemaHash'),json_extract(files,'$.payload.sha256'))=? AND ((state='ready' AND expires>?) OR (state='staging' AND lease>?)) LIMIT 1")
      .get(this.principal.tenant,this.principal.owner,options.schemaHash,this.now(),this.now()) as Row|null;
     if(prior)return prior.state==='ready'?{existing:prior.id}:{wait:true};
    }
    if(options.key) {
     const previous=this.db.query('SELECT * FROM requests WHERE tenant=? AND owner=? AND key=?').get(this.principal.tenant,this.principal.owner,options.key) as Native;
     if(previous) {
      if(previous.digest!==options.digest) throw storageError('IDEMPOTENCY_CONFLICT');
      const prior=this.db.query('SELECT * FROM objects WHERE id=?').get(previous.id) as Row|null;
      if(prior?.state==='ready') return {existing:prior.id};
      if(prior?.state==='staging'&&prior.lease>this.now()) return {wait:true};
      if(prior?.state==='deleted') throw storageError('OBJECT_NOT_FOUND');
      if(prior?.state==='expired') throw storageError('OBJECT_EXPIRED');
     }
    }
    const usage=this.db.query('SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM objects WHERE tenant=?').get(this.principal.tenant) as Native;
    if(usage.count>=this.budgets.count||usage.bytes+this.budgets.bytes>this.budgets.tenantBytes) throw storageError('LIMIT_EXCEEDED');
    const global=this.db.query('SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM objects').get() as Native;
    if(global.count>=32768||global.bytes+this.budgets.bytes>8589934592)throw storageError('LIMIT_EXCEEDED');
    const fresh=randomBytes(16).toString('hex');
    this.db.query('INSERT INTO objects(id,tenant,owner,kind,state,expires,lease,metadata,files,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(fresh,this.principal.tenant,this.principal.owner,kind,'staging',this.now()+ttl,this.now()+this.budgets.seconds*1000,JSON.stringify({schemaHash:options.schemaHash}),'{}',this.budgets.bytes);
    if(options.key) this.db.query('INSERT OR REPLACE INTO requests VALUES(?,?,?,?,?)').run(this.principal.tenant,this.principal.owner,options.key,options.digest!,fresh);
    return {id:fresh};
   }).immediate();
   if(claim.existing)return this.get(claim.existing,kind);
   if(claim.id){id=claim.id;break;}
   if(this.now()>=deadline) throw storageError('BACKEND_TIMEOUT');
   await delay(20,undefined,{signal});
  }
  const stage=path.join(this.root,'objects',id+'.staging'),final=path.join(this.root,'objects',id);
  try {
   await fs.mkdir(stage);
   const metadata=await writer(stage,final,signal);checkTree(metadata);
   if(Buffer.byteLength(JSON.stringify(metadata))>2097152) throw storageError('LIMIT_EXCEEDED');
   signal.throwIfAborted();
   const {files,total}=await this.inventory(stage,signal);signal.throwIfAborted();
   // These files are invisible to readers until the ready transaction commits.
   await fs.rename(stage,final);
   this.db.transaction(()=>{
    signal.throwIfAborted();
    const row=this.db.query('SELECT state,lease,expires FROM objects WHERE id=?').get(id) as Row;
    if(row.state!=='staging'||row.lease<=this.now()||row.expires<=this.now()) throw storageError('OBJECT_EXPIRED');
    const used=this.db.query("SELECT COALESCE(SUM(bytes),0) AS bytes FROM objects WHERE tenant=? AND id<>?").get(this.principal.tenant,id) as Native;
    if(used.bytes+total>this.budgets.tenantBytes) throw storageError('LIMIT_EXCEEDED');
    this.db.query("UPDATE objects SET state='ready',metadata=?,files=?,bytes=? WHERE id=?").run(JSON.stringify(metadata),JSON.stringify(files),total,id);
   }).immediate();
   return await this.get(id,kind);
  }catch(error){
   const now=this.now();
   const claim=this.db.query("UPDATE objects SET state='failed',bytes=0,expires=?,cleaned=2,lease=? WHERE id=? AND state='staging'").run(now,now+this.budgets.seconds*1000,id);
   if(claim.changes)await this.cleanFiles(id);
   else{
    // A late writer can finish staging after its lease was collected.
    // Preserve a committed payload if only the post-commit integrity read failed.
    await fs.rm(stage,{recursive:true,force:true});
    const row=this.db.query('SELECT state FROM objects WHERE id=?').get(id) as Row|null;
    if(row?.state!=='ready')await fs.rm(final,{recursive:true,force:true});
   }
   throw error;
  }
 }
 list(kind:Kind) {return this.db.query("SELECT id,kind,expires FROM objects WHERE tenant=? AND owner=? AND kind=? AND state='ready' AND expires>?").all(this.principal.tenant,this.principal.owner,kind,this.now());}
 async replay(key:string,inputDigest:string,kind:Kind):Promise<Stored|undefined> {
  const request=this.db.query('SELECT digest,id FROM requests WHERE tenant=? AND owner=? AND key=?').get(this.principal.tenant,this.principal.owner,key) as Native;
  if(!request)return;
  if(request.digest!==inputDigest)throw storageError('IDEMPOTENCY_CONFLICT');
  const row=this.db.query('SELECT state FROM objects WHERE id=?').get(request.id) as Native;
  if(['ready','expired','deleted'].includes(row?.state))return this.get(request.id,kind);
 }
 async revoke(id:string) {
  this.row(id);
  const now=this.now();
  this.db.query("UPDATE objects SET state='deleted',bytes=0,expires=?,cleaned=2,lease=? WHERE id=? AND tenant=? AND owner=?").run(now,now+this.budgets.seconds*1000,id,this.principal.tenant,this.principal.owner);
  await this.cleanFiles(id);
 }
 async activate(name:string,id:string) {
  await this.get(id,'libraries');
  this.db.query('INSERT OR REPLACE INTO pointers VALUES(?,?,?,?)').run(this.principal.tenant,this.principal.owner,name,id);
 }
 active(name:string):string|undefined {return (this.db.query('SELECT id FROM pointers WHERE tenant=? AND owner=? AND name=?').get(this.principal.tenant,this.principal.owner,name) as Native)?.id;}
 private async cleanFiles(id:string) {
  try{
   for(const suffix of ['.staging',''])await fs.rm(path.join(this.root,'objects',id+suffix),{recursive:true,force:true});
   this.db.query('UPDATE objects SET cleaned=1 WHERE id=?').run(id);
  }catch(error){
   this.db.query('UPDATE objects SET cleaned=0 WHERE id=? AND cleaned=2').run(id);
   throw error;
  }
 }
 async collect() {
  // cleaned: 0 pending, 1 complete, 2 leased to a collector or revoking writer.
  const claim=this.db.query(`UPDATE objects SET
   state=CASE WHEN state='staging' THEN 'failed' WHEN state='ready' THEN 'expired' ELSE state END,
   expires=CASE WHEN state='staging' THEN ?1 ELSE expires END, bytes=0, cleaned=2, lease=?2
   WHERE id=(SELECT id FROM objects WHERE
    (cleaned=0 AND ((state='staging' AND lease<=?1) OR (state='ready' AND expires<=?1) OR state IN ('failed','deleted','expired')))
    OR (cleaned=2 AND lease<=?1) LIMIT 1) RETURNING id`);
  for(let i=0;i<32;i++){
   const now=this.now(),row=claim.get(now,now+this.budgets.seconds*1000) as {id:string}|null;
   if(!row)break;
   await this.cleanFiles(row.id);
  }
  this.db.transaction(()=>{
   const cutoff=this.now()-86400000;
   const purged=this.db.query('SELECT id FROM objects WHERE cleaned=1 AND expires<=? LIMIT 32').all(cutoff) as Array<{id:string}>;
   for(const {id} of purged){
    this.db.query('DELETE FROM requests WHERE id=?').run(id);
    this.db.query('DELETE FROM pointers WHERE id=?').run(id);
    this.db.query('DELETE FROM objects WHERE id=?').run(id);
   }
  }).immediate();
 }
 close(){this.db?.close();}
}
