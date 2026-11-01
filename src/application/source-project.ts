import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compileSource} from './compiler.js';
import {Vault} from '../storage/vault.js';
import {readBounded} from '../infrastructure/media.js';
import {sameNativeManifest} from '../infrastructure/native-manifest.js';
import {checkTree} from '../domain/limits.js';
import type {Native} from '../domain/types.js';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const failure=(code:string)=>Object.assign(new Error(code),{code});
/** Portable source unit, outside the TTL object store. Library lock retains snapshot v1. */
export async function freezeSource(source:Native,vault:Vault,directory:string,authorize:(filename:string)=>Promise<string>) {
 if(await fs.lstat(directory).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw failure('OUTPUT_ALREADY_EXISTS');
 checkTree(source);
 if(source?.assets&&typeof source.assets==='object')for(const filename of Object.values(source.assets))if(typeof filename==='string')await authorize(filename);
 const snapshot=await vault.snapshot(true),libraries=path.join(snapshot.root,'data/libraries');
 const compiled=await compileSource(source,libraries);
 if(!compiled.ok)throw Object.assign(failure('SCHEMA_VALIDATION_FAILED'),{details:compiled.diagnostics});
 const normalized=structuredClone(compiled.normalized),manifest=compiled.activity.preparation;
 const files:Record<string,{size:number;sha256:string}>={};let bytes=0;
 // mkdir without recursive is the exclusive claim: existing directories are never overwritten.
 await fs.mkdir(directory);
 const put=async(relative:string,data:Buffer)=>{
  bytes+=data.length;if(bytes>536870912||Object.keys(files).length>=20000)throw failure('LIMIT_EXCEEDED');
  const filename=path.join(directory,relative);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,data,{flag:'wx'});
  files[relative]={size:data.length,sha256:hash(data)};
 };
 // A failed capture has no project.lock.json and cannot be rebuilt. Keep it for inspection.
 for(const [id,filename] of Object.entries(source.assets||{}) as Array<[string,string]>){
  const real=await authorize(filename),data=await readBounded(real,67108864);
  if(hash(data)!==manifest.assets[id])throw failure('STALE_PREPARATION');
  const extension=path.extname(filename);if(!/^\.[a-zA-Z0-9]{1,10}$/.test(extension))throw failure('INVALID_PARAMETER');
  const relative='assets/'+id+extension;await put(relative,data);normalized.assets[id]=relative;
 }
 const selected=snapshot.metadata.lock.libraries.filter((item:Native)=>Object.hasOwn(manifest.libraries,`${item.machine_name} ${item.major}.${item.minor}`));
 for(const item of selected){
  const folder=`${item.machine_name}-${item.major}.${item.minor}`;
  for(const [file,digest] of Object.entries(item.files)){
   const data=await readBounded(path.join(libraries,folder,file),134217728);
   if(hash(data)!==digest)throw failure('OBJECT_INTEGRITY_FAILED');
   await put('data/libraries/'+folder+'/'+file,data);
  }
 }
 await put('source.json',Buffer.from(JSON.stringify(normalized,null,2)+'\n'));
 const libraryLock={...snapshot.metadata.lock,libraries:selected};
 await put('libraries.lock.json',Buffer.from(JSON.stringify(libraryLock,null,2)+'\n'));
 const lock={version:1,schema_version:'1',compiler:'authoring-v1',markdown:'bounded-markdown-v1',preparation:manifest,files};
 await fs.writeFile(path.join(directory,'project.lock.json'),JSON.stringify(lock,null,2)+'\n',{flag:'wx'});
 return {ok:true,format:'h5p-source-project-v1',files:Object.keys(files).length,bytes,verification:{reconstruction:'captured',playback:'not_run'}};
}
export async function rebuildSource(directory:string) {
 const root=await fs.realpath(directory),lock=JSON.parse((await readBounded(path.join(root,'project.lock.json'),16777216)).toString('utf8'));checkTree(lock);
 if(lock.version!==1||lock.schema_version!=='1'||lock.compiler!=='authoring-v1'||lock.markdown!=='bounded-markdown-v1'||!lock.files||!lock.files['source.json']||!lock.files['libraries.lock.json'])throw failure('OBJECT_INTEGRITY_FAILED');
 const entries=Object.entries(lock.files) as Array<[string,Native]>;
 if(entries.length>20000)throw failure('LIMIT_EXCEEDED');let total=0;
 for(const [relative,record] of entries){
  if(!/^(source\.json|libraries\.lock\.json|assets\/[A-Za-z0-9_.-]+|data\/libraries\/[A-Za-z0-9_.-]+\/.+)$/.test(relative)||relative.includes('\\')||relative.split('/').some(part=>part==='.'||part==='..')||!Number.isSafeInteger(record.size)||record.size<0||record.size>134217728||!/^[a-f0-9]{64}$/.test(record.sha256))throw failure('OBJECT_INTEGRITY_FAILED');
  total+=record.size;if(total>536870912)throw failure('LIMIT_EXCEEDED');
  const filename=await fs.realpath(path.join(root,relative)),rel=path.relative(root,filename);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw failure('OBJECT_INTEGRITY_FAILED');
  const bytes=await readBounded(filename,record.size).catch(()=>{throw failure('OBJECT_INTEGRITY_FAILED');});
  if(bytes.length!==record.size||hash(bytes)!==record.sha256)throw failure('OBJECT_INTEGRITY_FAILED');
 }
 const source=JSON.parse((await readBounded(path.join(root,'source.json'),16777216)).toString('utf8'));checkTree(source);
 for(const [id,file] of Object.entries(source.assets||{}) as Array<[string,string]>){
  if(typeof file!=='string'||!file.startsWith('assets/')||!Object.hasOwn(lock.files,file))throw failure('OBJECT_INTEGRITY_FAILED');source.assets[id]=path.join(root,file);
 }
 const result=await compileSource(source,path.join(root,'data/libraries'));
 if(!result.ok)throw Object.assign(failure('SCHEMA_VALIDATION_FAILED'),{details:result.diagnostics});
 if(!sameNativeManifest(result.activity.preparation,lock.preparation))throw failure('STALE_PREPARATION');
 return result;
}
