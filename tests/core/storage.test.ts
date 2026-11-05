import {test,expect,spyOn} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Database} from 'bun:sqlite';
import {Objects,digest} from '../../src/storage/objects.js';
import {upload} from '../../src/storage/uploads.js';
import {compatibility,Vault} from '../../src/storage/vault.js';
import {Service} from '../../src/adapters/service.js';
const principal={tenant:'school-a',owner:'teacher-a'};
const writer=async(stage:string)=>{await fs.writeFile(path.join(stage,'payload'),'complete');return {mime:'application/zip'};};
test('preparation rejects over-budget unique assets before copying and stages aliases only once',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-prepare-budget-'));
 const store=new Objects(path.join(root,'store'),principal,Date.now,{bytes:4096,tenantBytes:32768,count:20,seconds:30});
 const vault=new Vault(store,path.join(root,'data'));
 try{
  await store.initialize();const snapshot=await vault.snapshot();
  const asset=()=>store.publish('asset',60000,async stage=>{
   await fs.writeFile(path.join(stage,'payload'),Buffer.alloc(2300));return {mime:'image/png'};
  });
  const a=await asset(),b=await asset();
  const prepare=(assets:Record<string,string>)=>vault.prepare({title:'Example',library:'H5P.Missing 1.0',params:{},assets},1000,snapshot.id);
  const writes=spyOn(fs,'writeFile');
  const stagedBytes=()=>writes.mock.calls.reduce((n,[file,data])=>n+(String(file).includes(path.sep+'assets'+path.sep)&&Buffer.isBuffer(data)?data.length:0),0);
  try{
   await expect(prepare({a:a.id,b:b.id})).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
   expect(stagedBytes()).toBe(0);
   await expect(prepare({a:a.id,b:a.id})).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
   expect(stagedBytes()).toBe(2300);
  }finally{writes.mockRestore();}
 }finally{await vault.close();await fs.rm(root,{recursive:true,force:true});}
});
test('automatic snapshot selection renews expired libraries and preserves explicit pins and integrity errors',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-renew-'));let now=10000;
 const store=new Objects(path.join(root,'store'),principal,()=>now),vault=new Vault(store,path.join(root,'data'));
 try{
  await store.initialize();const old=await vault.snapshot();now=old.expires+1;
  await expect(vault.prepare({title:'X',library:'H5P.Test 1.0',params:{}},1000,old.id)).rejects.toMatchObject({code:'OBJECT_EXPIRED'});
  const renewed=await vault.snapshot();expect(renewed.id).not.toBe(old.id);expect(store.active('libraries')).toBe(renewed.id);
  await fs.writeFile(path.join(renewed.root,'libraries.lock.json'),'corrupt');
  await expect(vault.snapshot()).rejects.toMatchObject({code:'OBJECT_INTEGRITY_FAILED'});
 }finally{await vault.close();await fs.rm(root,{recursive:true,force:true});}
});
test('failed vault initialization releases the database and the same service can retry',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-init-retry-'));
 const service=new Service(principal,{store:root});
 const fault=spyOn(Objects.prototype,'collect').mockRejectedValueOnce(new Error('temporary failure'));
 const closed=spyOn(Objects.prototype,'close');
 try{
  const first=service.vault();expect(service.vault()).toBe(first);
  await expect(first).rejects.toThrow('temporary failure');expect(closed).toHaveBeenCalledTimes(1);
  const retry=service.vault();expect(service.vault()).toBe(retry);expect(await retry).toBeInstanceOf(Vault);
 }finally{fault.mockRestore();closed.mockRestore();await service.close();await fs.rm(root,{recursive:true,force:true});}
});
test('collection migrates old tombstones, bounds physical work and remembers successful cleanup across tenants',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-cleanup-'));
 const db=new Database(path.join(root,'index.sqlite'),{create:true});
 db.exec('CREATE TABLE objects(id TEXT PRIMARY KEY,tenant TEXT,owner TEXT,kind TEXT,state TEXT,expires INTEGER,lease INTEGER,metadata TEXT,files TEXT,bytes INTEGER)');
 for(let i=0;i<40;i++)db.query("INSERT INTO objects VALUES(?, 'A','owner','asset','failed',?,0,'{}','{}',0)").run(i.toString(16).padStart(32,'0'),Date.now());
 db.close();
 const store=new Objects(root,{tenant:'B',owner:'user'}),remove=spyOn(fs,'rm');
 try{
  await store.initialize();expect(remove.mock.calls.length).toBe(64);
  remove.mockClear();remove.mockRejectedValueOnce(Object.assign(new Error('busy'),{code:'EBUSY'}));
  await expect(store.collect()).rejects.toMatchObject({code:'EBUSY'});
  const other=new Objects(root,{tenant:'A',owner:'owner'});
  remove.mockClear();
  try{await Promise.all([store.collect(),other.initialize()]);}
  finally{other.close();}
  expect(remove.mock.calls.length).toBe(16);
  remove.mockClear();await store.collect();expect(remove.mock.calls.length).toBe(0);
 }finally{remove.mockRestore();store.close();await fs.rm(root,{recursive:true,force:true});}
});
test('schema reads reuse one live object per owner and digest, including concurrent reads',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-schema-'));let now=1000;
 const a=new Objects(root,principal,()=>now),b=new Objects(root,{...principal,owner:'other'},()=>now);
 const publish=(store:Objects,text:string)=>store.publish('schema',1000,async stage=>{
  await fs.writeFile(path.join(stage,'payload'),text);return {mime:'application/json'};
 },{schemaHash:createHash('sha256').update(text).digest('hex')});
 try{
  await a.initialize();await b.initialize();
  const [one,two]=await Promise.all([publish(a,'one'),publish(a,'one')]);
  expect(one.id).toBe(two.id);
  expect((await publish(b,'one')).id).not.toBe(one.id);
  expect((await publish(a,'two')).id).not.toBe(one.id);
  await a.revoke(one.id);const renewed=await publish(a,'one');
  expect(renewed.id).not.toBe(one.id);
  now+=1001;expect((await publish(a,'one')).id).not.toBe(renewed.id);
 }finally{a.close();b.close();await fs.rm(root,{recursive:true,force:true});}
});
test('tenant and owner isolation, restart, TTL, revocation and integrity',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-objects-'));let now=1000;
 const a=new Objects(root,principal,()=>now),b=new Objects(root,{tenant:'school-b',owner:'teacher-a'},()=>now),c=new Objects(root,{tenant:'school-a',owner:'teacher-b'},()=>now);
 try {
  await a.initialize();await b.initialize();await c.initialize();
  const object=await a.publish('artifact',1000,writer);
  for(const other of [b,c]){expect(other.list('artifact')).toEqual([]);await expect(other.read(object.id,'artifact')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});await expect(other.revoke(object.id)).rejects.toThrow();}
  expect((await a.read(object.id,'artifact')).toString()).toBe('complete');
  const reopened=new Objects(root,principal,()=>now);await reopened.initialize();expect((await reopened.get(object.id)).id).toBe(object.id);reopened.close();
  await fs.writeFile(path.join(object.root,'payload'),'corrupted');await expect(a.read(object.id,'artifact')).rejects.toMatchObject({code:'OBJECT_INTEGRITY_FAILED'});
  const expired=await a.publish('asset',20,writer);now+=21;await expect(a.get(expired.id)).rejects.toMatchObject({code:'OBJECT_EXPIRED'});await a.collect();
  await expect(a.get(expired.id)).rejects.toMatchObject({code:'OBJECT_EXPIRED'});
  const revoked=await a.publish('asset',1000,writer);await a.revoke(revoked.id);await expect(a.get(revoked.id)).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
 }finally{a.close();b.close();c.close();await fs.rm(root,{recursive:true,force:true});}
});
test('idempotency serializes a race, detects conflicts and separates tenants',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-idempotency-')),a=new Objects(root,principal),b=new Objects(root,{tenant:'b',owner:'b'});
 try {
  await a.initialize();await b.initialize();let calls=0;
  const work=async(stage:string)=>{calls++;await new Promise(resolve=>setTimeout(resolve,30));return writer(stage);};
  const options={key:'lesson',digest:digest({input:1})};
  const [one,two]=await Promise.all([a.publish('artifact',10000,work,options),a.publish('artifact',10000,work,options)]);
  expect(one.id).toBe(two.id);expect(calls).toBe(1);
  await expect(a.publish('artifact',10000,writer,{key:'lesson',digest:digest({input:2})})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  expect((await b.publish('artifact',10000,writer,options)).id).not.toBe(one.id);
 }finally{a.close();b.close();await fs.rm(root,{recursive:true,force:true});}
});
test('crash between rename and SQLite commit leaves no readable partial object',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-crash-'));
 try {
  const module=new URL('../../src/storage/objects.ts',import.meta.url).href;
  const code=`import fs from 'node:fs/promises';import path from 'node:path';import {Objects,digest} from ${JSON.stringify(module)};const store=new Objects(process.argv[1],{tenant:'school-a',owner:'teacher-a'});await store.initialize();const rename=fs.rename;fs.rename=async(...args)=>{await rename(...args);process.exit(19);};await store.publish('artifact',7*86400000,async(stage)=>{await fs.writeFile(path.join(stage,'payload'),'complete');return {};},{key:'crash',digest:digest('same')});`;
  expect(spawnSync(process.execPath,['-e',code,root],{timeout:10000}).status).toBe(19);
  const db=new Database(path.join(root,'index.sqlite'));db.exec('UPDATE objects SET lease=0');db.close();
  let now=Date.now();
  const recovered=new Objects(root,principal,()=>now,{count:2,bytes:1024,tenantBytes:2048,seconds:2});await recovered.initialize();
  try{expect(recovered.list('artifact')).toEqual([]);expect(await fs.readdir(path.join(root,'objects'))).toEqual([]);const final=await recovered.publish('artifact',7*86400000,writer,{key:'crash',digest:digest('same')});expect((await recovered.read(final.id,'artifact')).toString()).toBe('complete');
   await expect(recovered.publish('asset',10000,writer)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
   now+=86400000-1;await recovered.collect();
   await expect(recovered.publish('asset',10000,writer)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
   now+=2;await recovered.collect();
   const retried=await recovered.publish('artifact',10000,writer,{key:'crash',digest:digest('same')});
   expect(retried.id).toBe(final.id);
   const next=await recovered.publish('asset',10000,writer);
   expect((await recovered.read(next.id,'asset')).toString()).toBe('complete');
  }
  finally{recovered.close();}
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('ordinary publication failure retains its original recovery deadline',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-failure-deadline-'));
 let now=100;
 const store=new Objects(root,principal,()=>now,{count:1,bytes:16,tenantBytes:32,seconds:2});
 try{
  await store.initialize();
  await expect(store.publish('artifact',7*86400000,async()=>{throw Error('writer failed');})).rejects.toThrow('writer failed');
  now+=86400000-1;await store.collect();
  await expect(store.publish('artifact',1000,writer)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
  now+=1;await store.collect();
  expect((await store.publish('artifact',1000,writer)).kind).toBe('artifact');
 }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
test('stream budgets and MIME reject before publication',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-upload-')),store=new Objects(root,principal,Date.now,{bytes:16,tenantBytes:32,count:20,seconds:2});
 async function* chunks(){yield Buffer.alloc(12);yield Buffer.alloc(12);}
 async function* fake(){yield Buffer.from('not a PNG');}
 try{await store.initialize();await expect(upload(store,'asset','image/png',chunks(),10000)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});await expect(upload(store,'asset','image/png',fake(),10000)).rejects.toMatchObject({code:'MIME_MISMATCH'});expect(store.list('asset')).toEqual([]);expect(await fs.readdir(path.join(root,'objects'))).toEqual([]);}
 finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
test('unknown inventories and missing MathDisplay never claim target compatibility',()=>{
 const dependencies={'H5P.MathDisplay 1.0':{patch:3}},lock={libraries:[{machine_name:'H5P.MathDisplay',major:1,minor:0,core:{majorVersion:1,minorVersion:28}}]};
 expect(compatibility(dependencies,lock,undefined).code).toBe('TARGET_INVENTORY_UNKNOWN');
 const target={core:{major:1,minor:28},inventory_at:'2026-09-20T00:00:00Z',can_install:false,libraries:[]};
 expect(compatibility(dependencies,lock,target).missing[0]).toContain('H5P.MathDisplay');
 expect(compatibility(dependencies,lock,{...target,can_install:true}).compatible).toBe(true);
 expect(compatibility(dependencies,lock,{...target,can_install:true})).toMatchObject({declared_compatible:true,exact_match:false,destination_evidence:'not_run'});
 const installed={machine_name:'H5P.MathDisplay',major:1,minor:0,patch:3};
 expect(compatibility(dependencies,lock,{...target,libraries:[installed]}).exact_match).toBe(true);
 expect(compatibility(dependencies,lock,{...target,libraries:[installed],allowed:[{...installed,patch:4}]}).compatible).toBe(false);
 expect(compatibility(dependencies,lock,{...target,can_install:true,core:{major:1,minor:27}}).compatible).toBe(false);
});
test('reservations bound concurrent staging and retention reclaims tombstones',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-quota-'));let now=1000;
 const store=new Objects(root,principal,()=>now,{bytes:16,tenantBytes:16,count:1,seconds:2});
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>entered=resolve),blocked=new Promise<void>(resolve=>release=resolve);
 try {
  await store.initialize();
  const first=store.publish('asset',10000,async(stage)=>{entered();await blocked;return writer(stage);});
  await started;await store.collect();
  await expect(store.publish('asset',10000,writer)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
  release();const object=await first;await store.revoke(object.id);
  now+=86400001;await store.collect();
  expect((await store.publish('asset',10000,writer)).kind).toBe('asset');
 }finally{release();store.close();await fs.rm(root,{recursive:true,force:true});}
});
