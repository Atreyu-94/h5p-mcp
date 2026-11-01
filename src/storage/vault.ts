import {feedback} from '../adapters/feedback.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Objects,digest,storageError,type Stored} from './objects.js';
import {upload} from './uploads.js';
import {Generations,exclusive} from '../infrastructure/generations.js';
import {readBounded} from '../infrastructure/media.js';
import {Engine} from '../application/engine.js';
import {isolated} from '../infrastructure/worker.js';
import {Pool} from '../infrastructure/pool.js';
import {valid,invalidInput} from '../adapters/contracts.js';
import type {Native} from '../domain/types.js';
const day=86400000;
export interface Target {core:{major:number;minor:number};inventory_at:string;can_install:boolean;libraries:Array<{machine_name:string;major:number;minor:number;patch:number}>;allowed?:Array<{machine_name:string;major:number;minor:number;patch:number}>}
export function compatibility(dependencies:Native,lock:Native,target:Target|undefined) {
 if(!target||!Number.isFinite(Date.parse(target.inventory_at)))return {compatible:false,declared_compatible:false,exact_match:false,destination_evidence:'not_run',code:'TARGET_INVENTORY_UNKNOWN',missing:[]};
 const missing:string[]=[];let exact=true;
 for(const [name,dependency] of Object.entries(dependencies) as Array<[string,Native]>) {
  const [machine,version]=name.split(' '),[major,minor]=version.split('.').map(Number);
  const required=lock.libraries.find((item:Native)=>item.machine_name===machine&&item.major===major&&item.minor===minor);
  const core=required?.core;
  if(!required||core&&(core.majorVersion>target.core.major||core.majorVersion===target.core.major&&core.minorVersion>target.core.minor)) {missing.push(name+' (Core)');continue;}
  const matches=(item:Target['libraries'][number])=>item.machine_name===machine&&item.major===major&&item.minor===minor&&item.patch===dependency.patch;
  if(!target.libraries.some(matches))exact=false;
  if(target.allowed&&!target.allowed.some(matches)){missing.push(name+' (not allowed)');continue;}
  if(!target.libraries.some(matches)&&!target.can_install)missing.push(name+' patch '+dependency.patch);
 }
 return {compatible:missing.length===0,declared_compatible:missing.length===0,exact_match:exact&&missing.length===0,destination_evidence:'not_run',code:missing.length?'TARGET_INCOMPATIBLE':null,missing,inventory_at:target.inventory_at,verification:'declared inventory and installation permission; playback not tested'};
}
export class Vault {
 private pool=new Pool(2,8);
 constructor(readonly objects:Objects,readonly source:string,readonly engine=new Engine()){}
 upload(kind:'asset'|'package',mime:string,input:AsyncIterable<Uint8Array>,ttl=day,signal?:AbortSignal){return upload(this.objects,kind,mime,input,ttl,signal);}
 async snapshot(fresh=false,signal=AbortSignal.timeout(300000)):Promise<Stored> {
  const active=this.objects.active('libraries');if(active&&!fresh)return this.objects.get(active,'libraries');
  const generations=new Generations();
  try {
   const pinned=await exclusive(this.source,signal,()=>generations.acquire(this.source,signal));
   try {
    const snapshot=await this.objects.publish('libraries',365*day,async(stage)=>{
     const data=path.join(stage,'data');await fs.cp(pinned.root,data,{recursive:true,filter:()=>{signal.throwIfAborted();return true;}});
     const libraries:Native[]=[];
     const base=path.join(data,'libraries');let count=0,total=0;
     for(const folder of await fs.readdir(base,{withFileTypes:true})) {
      if(!folder.isDirectory())throw storageError('OBJECT_INTEGRITY_FAILED');
      const root=path.join(base,folder.name),meta=JSON.parse((await readBounded(path.join(root,'library.json'),2097152)).toString('utf8'));
      const files:Record<string,string>={};
      const walk=async(dir:string):Promise<void>=>{
       for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
        if(entry.isSymbolicLink())throw storageError('OBJECT_INTEGRITY_FAILED');
        const filename=path.join(dir,entry.name);
        if(entry.isDirectory()){await walk(filename);continue;}
        const bytes=await readBounded(filename,134217728);total+=bytes.length;
        if(++count>20000||total>this.objects.budgets.bytes)throw storageError('LIMIT_EXCEEDED');
        files[path.relative(root,filename).split(path.sep).join('/')]=createHash('sha256').update(bytes).digest('hex');
       }
      };
      await walk(root);
      libraries.push({machine_name:meta.machineName,major:meta.majorVersion,minor:meta.minorVersion,patch:meta.patchVersion,core:meta.coreApi||null,files});
     }
     const lock={version:1,core:'1.28.0',captured_at:new Date(this.objects.now()).toISOString(),source:'host-installed libraries; upstream provenance unknown',libraries,evidence:{metadata:'observed',file_hashes:'verified',playback:'not_run'}};
     await fs.writeFile(path.join(stage,'libraries.lock.json'),JSON.stringify(lock));
     return {lock};
    },{signal});
    await this.objects.activate('libraries',snapshot.id);return snapshot;
   }finally{await pinned.release();}
  }finally{await generations.close();}
 }
 async prepare(input:Native,ttl=day,snapshotID?:string,callerSignal?:AbortSignal) {
  if(!valid('prepare_remote_input',input))throw invalidInput('prepare_remote_input');
  const snapshot=snapshotID?await this.objects.get(snapshotID,'libraries'):await this.snapshot(false,callerSignal);
  if(snapshot.expires<this.objects.now()+ttl)throw storageError('OBJECT_EXPIRED');
  return this.objects.publish('preparation',ttl,async(stage,final,signal)=>{
   const assets:Record<string,string>={},finalAssets:Record<string,string>={};let index=0;
   await fs.mkdir(path.join(stage,'assets'));
   for(const [name,id] of Object.entries(input.assets||{}) as Array<[string,string]>) {
    const asset=await this.objects.get(id,'asset');
    const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp','image/tiff':'tiff','image/avif':'avif','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','audio/webm':'webm','video/mp4':'mp4','video/webm':'webm','video/ogg':'ogv','application/pdf':'pdf','text/vtt':'vtt'};
    const extension=extensions[asset.metadata.mime];if(!extension)throw storageError('MIME_MISMATCH');
    const file='asset-'+index++ +'.'+extension;
    const bytes=await this.objects.read(id,'asset');
    assets[name]=path.join(stage,'assets',file);finalAssets[name]=path.join(final,'assets',file);
    await fs.writeFile(assets[name],bytes,{flag:'wx'});
   }
   const result:Native=await this.pool.run(()=>isolated({action:'prepare',data_dir:path.join(snapshot.root,'data'),activity:{language:'en',license:'U',...input,assets}},signal,[path.join(stage,'assets')]),signal);
   if(!result.ok)throw Object.assign(storageError('SCHEMA_VALIDATION_FAILED'),{details:result.diagnostics,feedback:feedback(result)});
   const activity={...result.activity,assets:finalAssets};
   await fs.writeFile(path.join(stage,'preparation.json'),JSON.stringify({activity,library_snapshot_id:snapshot.id}));
   return {library_snapshot_id:snapshot.id,title:activity.title,library:activity.library,feedback:feedback(result)};
  },{signal:callerSignal});
 }
 async target(profile:Target,ttl=day) {
  if(!valid('target_profile_input',profile))throw invalidInput('target_profile_input');
  if(!Number.isFinite(Date.parse(profile.inventory_at))||Date.parse(profile.inventory_at)>this.objects.now())throw storageError('SCHEMA_VALIDATION_FAILED');
  const remaining=Date.parse(profile.inventory_at)+ttl-this.objects.now();
  if(remaining<1)throw storageError('OBJECT_EXPIRED');
  return this.objects.publish('target',remaining,async()=>profile);
 }
 async export(preparationID:string,key:string,targetID?:string,ttl=day,callerSignal?:AbortSignal) {
  const inputDigest=digest({operation:'export',preparationID,targetID:targetID||null,ttl});
  const replay=await this.objects.replay(key,inputDigest,'artifact');if(replay)return replay;
  const prepared=await this.objects.get(preparationID,'preparation');
  const value=JSON.parse((await this.objects.read(preparationID,'preparation','preparation.json')).toString('utf8'));
  const snapshot=await this.objects.get(value.library_snapshot_id,'libraries');
  const target=targetID?(await this.objects.get(targetID,'target')).metadata as Target:undefined;
  const assessment=compatibility(value.activity.preparation.libraries,snapshot.metadata.lock,target);
  if(target&&!assessment.compatible)throw Object.assign(storageError(assessment.code!),{targetMissing:assessment.missing});
  return this.objects.publish('artifact',ttl,async(stage,_final,signal)=>{
   const result:Native=await this.pool.run(()=>isolated({action:'export',data_dir:path.join(snapshot.root,'data'),activity:value.activity,path:path.join(stage,'payload')},signal,[path.join(prepared.root,'assets')]),signal);
   await this.objects.get(prepared.id,'preparation');await this.objects.get(snapshot.id,'libraries');
   if(targetID)await this.objects.get(targetID,'target');
   return {mime:'application/zip',preparation_id:preparationID,library_snapshot_id:snapshot.id,h5p:result.h5p_json,target:assessment};
  },{key,digest:inputDigest,signal:callerSignal});
 }
 async validate(packageID:string,signal?:AbortSignal) {
  const pkg=await this.objects.get(packageID,'package');
  return this.engine.run({action:'validate',data_dir:this.source,path:path.join(pkg.root,'payload')},signal);
 }
 async close(){await this.engine.close();this.objects.close();}
}
