import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {Objects} from '../../src/storage/objects.js';
import {Vault} from '../../src/storage/vault.js';
import {Engine} from '../../src/application/engine.js';
import type {Native} from '../../src/domain/types.js';

test('native transition preserves snapshots and artifacts, rejects legacy preparations and isolates stored source',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-transition-'));
 let now=Date.now();
 const store=path.join(root,'objects'),principal={tenant:'a',owner:'teacher'};
 const objects=new Objects(store,principal,()=>now),vault=new Vault(objects,root),engine=new Engine();
 const other=new Objects(store,{tenant:'a',owner:'other'},()=>now);
 try{
  const zip=await createRequire(import.meta.url)('yauzl-promise').open(fileURLToPath(new URL('../fixtures/libraries.zip',import.meta.url)));
  try{for await(const entry of zip){const target=path.join(root,'libraries',entry.filename);if(entry.filename.endsWith('/')){await fs.mkdir(target,{recursive:true});continue;}await fs.mkdir(path.dirname(target),{recursive:true});const chunks=[];for await(const bytes of await entry.openReadStream())chunks.push(bytes);await fs.writeFile(target,Buffer.concat(chunks));}}finally{await zip.close();}
  await objects.initialize();await other.initialize();
  const snapshots=await vault.snapshot();
  expect(snapshots.metadata.lock.version).toBe(1);
  const legacyActivity={title:'Old',library:'H5P.TrueFalse 1.8',language:'en',license:'U',params:{question:'<p>Old?</p>',correct:'true'},preparation:{version:1,libraries:{},assets:{},backend:{}}};
  const old=await objects.publish('preparation',60000,async stage=>{await fs.writeFile(path.join(stage,'preparation.json'),JSON.stringify({activity:legacyActivity,library_snapshot_id:snapshots.id}));return {};});
  const oldBytes=await objects.read(old.id,'preparation','preparation.json');
  await expect(vault.export(old.id,'legacy')).rejects.toMatchObject({code:'STALE_PREPARATION'});
  await expect(engine.run({action:'export',data_dir:root,activity:legacyActivity,path:path.join(root,'old.h5p')})).rejects.toMatchObject({code:'STALE_PREPARATION'});
  expect(await objects.read(old.id,'preparation','preparation.json')).toEqual(oldBytes);
  const legacyArtifact=await objects.publish('artifact',60000,async stage=>{await fs.writeFile(path.join(stage,'payload'),'existing artifact bytes');return {mime:'application/zip'};});
  // Use the public pinned source contract rather than accepting host paths.
  const adapters=JSON.parse(await fs.readFile(new URL('../../h5p_mcp/contracts/authoring-adapters-v1.json',import.meta.url),'utf8'));
  const input:Native={schema_version:'1',project_id:'transition',id:'q',type:'true_false',title:'Stored source',library:{name:'H5P.TrueFalse 1.8',...adapters['H5P.TrueFalse 1.8']},question:{format:'plain',value:'True?'},correct:true};
  await expect(vault.prepare({...input,assets:{bad:'C:/private.png'}},60000,snapshots.id,undefined,true)).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
  const prepared=await vault.prepare(input,60000,snapshots.id,undefined,true);
  const saved=JSON.parse((await objects.read(prepared.id,'preparation','preparation.json')).toString());
  expect(saved.activity.preparation).toMatchObject({version:2,engine:'native-content-v1'});
  expect(saved.library_snapshot_id).toBe(snapshots.id);
  await expect(other.get(prepared.id,'preparation')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  const artifact=await vault.export(prepared.id,'native');
  expect((await vault.export(prepared.id,'native')).id).toBe(artifact.id);
  const bytes=await objects.read(artifact.id,'artifact');
  const restarted=new Objects(store,principal,()=>now);await restarted.initialize();
  expect(await restarted.read(legacyArtifact.id,'artifact')).toEqual(Buffer.from('existing artifact bytes'));
  expect(await restarted.read(artifact.id,'artifact')).toEqual(bytes);restarted.close();
  now+=60001;
  await expect(vault.export(prepared.id,'expired')).rejects.toMatchObject({code:'OBJECT_EXPIRED'});
  expect((await objects.get(snapshots.id,'libraries')).metadata.lock).toEqual(snapshots.metadata.lock);
 }finally{await engine.close();other.close();await vault.close();await fs.rm(root,{recursive:true,force:true});}
},120000);

test('a stopped store copy preserves rollback artifacts independently of new writes and revocation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-store-rollback-')),principal={tenant:'a',owner:'teacher'};
 const old=new Objects(path.join(root,'before'),principal),upgraded=new Objects(path.join(root,'upgrade'),principal);
 try{
  await old.initialize();
  const artifact=await old.publish('artifact',60000,async stage=>{await fs.writeFile(path.join(stage,'payload'),'old exported bytes');return {mime:'application/zip'};});
  old.close();
  await fs.cp(old.root,upgraded.root,{recursive:true});
  await upgraded.initialize();
  expect(await upgraded.read(artifact.id,'artifact')).toEqual(Buffer.from('old exported bytes'));
  await upgraded.revoke(artifact.id);
  await old.initialize();
  expect(await old.read(artifact.id,'artifact')).toEqual(Buffer.from('old exported bytes'));
  const fresh=await upgraded.publish('artifact',60000,async stage=>{await fs.writeFile(path.join(stage,'payload'),'new export');return {mime:'application/zip'};});
  await expect(old.get(fresh.id)).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
 }finally{old.close();upgraded.close();await fs.rm(root,{recursive:true,force:true});}
});
