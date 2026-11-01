import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {FileLibraryRepository} from './libraries.js';
import {installPackage} from './packages.js';
import {readBounded} from '../infrastructure/read-bounded.js';
import {checkTree,limit} from '../domain/limits.js';
import type {Native} from '../domain/types.js';
export async function readStore(root:string,name:string){try{const value=JSON.parse((await readBounded(path.join(root,name),16777216)).toString('utf8'));checkTree(value);return value;}catch(error:Native){if(error.code==='ENOENT')return {};throw error;}}
async function save(root:string,name:string,value:Native){await fs.mkdir(root,{recursive:true});const tmp=path.join(root,name+'.'+randomUUID()+'.tmp');try{await fs.writeFile(tmp,JSON.stringify(value),{flag:'wx'});await fs.rename(tmp,path.join(root,name));}finally{await fs.rm(tmp,{force:true});}}
export async function hubRequest(url:string,options:RequestInit={},maximum=16777216){
 const target=new URL(url);if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname)))throw new Error('Invalid Hub URL');
 const response=await fetch(target,{...options,signal:AbortSignal.timeout(60000)});if(!response.ok||!response.body)throw Object.assign(new Error('Hub unavailable'),{code:'HUB_UNAVAILABLE'});
 const chunks:Uint8Array[]=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>maximum)throw Object.assign(new Error('Hub limit exceeded'),{code:'LIMIT_EXCEEDED'});chunks.push(chunk);}return Buffer.concat(chunks);
}
export async function nativeCatalog(root:string){
 const libraries=path.join(root,'libraries'),repo=new FileLibraryRepository(libraries),config=await readStore(root,'config.json');
 const endpoint=config.hubContentTypesEndpoint||'https://hub-api.h5p.org/v1/content-types/';
 const list=async()=>{const result:Record<string,Native[]>={};let dirs;try{dirs=await fs.readdir(libraries,{withFileTypes:true});}catch(error:Native){if(error.code==='ENOENT')return result;throw error;}
 if(dirs.length>limit('LIBRARIES',1000))throw new Error('Library count exceeded');for(const dir of dirs){if(!dir.isDirectory()||dir.isSymbolicLink())throw new Error('Invalid library directory');const meta=JSON.parse((await readBounded(path.join(libraries,dir.name,'library.json'),2097152)).toString('utf8'));await repo.getLibrary(meta);(result[meta.machineName]??=[]).push(meta);}return result;};
 const cache={
  forceUpdate:async()=>{
   const form=new URLSearchParams({core_api_version:'1.28',h5p_version:'1.28.0',disabled:'0',platform_name:'h5p-mcp',platform_version:'0.1.0',type:'local',local_id:config.nativeLocalId??=randomUUID().slice(0,15),uuid:config.uuid||''});
   if(!config.uuid){const registered=JSON.parse((await hubRequest(config.hubRegistrationEndpoint||'https://hub-api.h5p.org/v1/sites',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form})).toString());if(typeof registered.uuid!=='string'||!registered.uuid)throw new Error('Invalid Hub registration');config.uuid=registered.uuid;form.set('uuid',registered.uuid);await save(root,'config.json',config);}
   const data=JSON.parse((await hubRequest(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form})).toString());checkTree(data);if(!Array.isArray(data.contentTypes))throw new Error('Invalid Hub catalog');
   const entries=data.contentTypes.map((e:Native)=>({...e,machineName:e.id,majorVersion:e.version.major,minorVersion:e.version.minor,patchVersion:e.version.patch,h5pMajorVersion:e.coreApiVersionNeeded.major,h5pMinorVersion:e.coreApiVersionNeeded.minor}));
   await save(root,'cache.json',{...await readStore(root,'cache.json'),contentTypeCache:entries,contentTypeCacheUpdate:Date.now()});return true;
  },
  get:async(name:string)=>(await readStore(root,'cache.json')).contentTypeCache?.filter((e:Native)=>e.machineName===name)||[],
  getLastUpdate:async()=>(await readStore(root,'cache.json')).contentTypeCacheUpdate||null
 };
 return {config:{h5pVersion:'1.28.0',coreApiVersion:{major:1,minor:28}},libraryManager:{listInstalledLibraries:list,getLibrary:(v:Native)=>repo.getLibrary(v),getSemantics:async(v:Native)=>{try{return await repo.getSemantics(v);}catch(error:Native){if(error.code==='ENOENT'&&!(await repo.getLibrary(v)).runnable)return [];throw error;}}},contentTypeCache:cache,installLibraryFromHub:async(name:string)=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-hub-native-'));try{const file=path.join(temp,'package.h5p');await fs.writeFile(file,await hubRequest(endpoint+encodeURIComponent(name),{},limit('ZIP_ARCHIVE_BYTES',134217728)));await installPackage(file,root);}finally{await fs.rm(temp,{recursive:true,force:true});}
 }};
}
