import path from 'node:path';
import fs from 'node:fs/promises';
import {Service} from '../adapters/service.js';
import {storage,operations,failure} from '../adapters/contracts.js';
import type {Native} from '../domain/types.js';
import type {HttpConfig,Identity} from './auth.js';

export const requirements:Record<string,string>={
 search_h5p_types:'h5p:read',get_h5p_type_contract:'h5p:read',
 prepare_stored_h5p_source:'h5p:author',prepare_stored_h5p_activity:'h5p:author',export_prepared_h5p_activity:'h5p:export',
 validate_stored_h5p_package:'h5p:validate',list_stored_h5p_objects:'h5p:read',
 revoke_stored_h5p_object:'h5p:author',register_h5p_target_profile:'h5p:author',
 capture_h5p_library_snapshot:'h5p:admin:libraries',activate_h5p_library_snapshot:'h5p:admin:libraries',
 install_h5p_library_package:'h5p:admin:libraries'
};
export class Remote extends Service {
 override readonly definitions:Record<string,string[]>={
  ...Object.fromEntries(Object.entries(storage.local).filter(([name])=>Object.hasOwn(requirements,name))) as Record<string,string[]>,
  search_h5p_types:operations.local.search_h5p_types,get_h5p_type_contract:operations.local.get_h5p_type_contract,
  install_h5p_library_package:['stored_id_input','install_output']
 };
 constructor(readonly identity:Identity,settings:HttpConfig) {
  super(identity.extra.principal,{data:path.join(settings.data,identity.extra.principal.tenant),store:settings.store,immutable:settings.immutable,
   adminScopes:identity.scopes.includes('h5p:admin:libraries')?['libraries:install']:[]});
 }
 require(scope:string) {if(!this.identity.scopes.includes('h5p:read')||!this.identity.scopes.includes(scope))throw failure('PERMISSION_DENIED');}
 override allowed(name:string) {return Object.hasOwn(requirements,name)&&this.identity.scopes.includes('h5p:read')&&this.identity.scopes.includes(requirements[name])&&super.allowed(name);}
 override tools(){return super.tools().filter(tool=>Object.hasOwn(this.definitions,tool.name));}
 override async initialize() {
  await super.initialize();
  // Remote discovery must not advertise the local path-bearing profile as executable.
  this.resources.texts.delete('h5p-contract://v1/schema');
  this.resources.texts.delete('h5p-contract://v1/storage');
  this.resources.texts.set('h5p-contract://v1/profiles',{uri:'h5p-contract://v1/profiles',name:'remote',mimeType:'application/json',text:JSON.stringify({transport:'http',execution_supported:true,tools:this.tools()})});
 }
 override async call(name:string,args:Native,signal?:AbortSignal):Promise<Native> {
  this.require(requirements[name]||'unavailable');
  if(!Object.hasOwn(this.definitions,name)||!this.allowed(name))throw failure('PERMISSION_DENIED');
  return super.call(name,args,signal);
 }
 override async dispatch(name:string,args:Native,signal:AbortSignal):Promise<Native> {
  this.require(requirements[name]||'unavailable');
  if(!this.allowed(name))throw failure('PERMISSION_DENIED');
  if(name==='search_h5p_types')args={...args,installed_only:true};
  if(name==='install_h5p_library_package') {
   const pkg=await (await this.vault()).objects.get(args.object_id,'package');
   return this.run('setup',{packages:[path.join(pkg.root,'payload')]},signal);
  }
  if(name==='revoke_stored_h5p_object') {
   const object=await (await this.vault()).objects.get(args.object_id);
   if(object.kind==='libraries'){this.require('h5p:admin:libraries');if(this.immutable)throw failure('PERMISSION_DENIED');}
  }
  const result=await super.dispatch(name,args,signal);
  if(name==='get_h5p_type_contract') {
   const text=(await this.resources.read(result.raw_schema.uri)).contents[0].text;
   const schemaHash=result.raw_schema.sha256;
   const snapshot=await (await this.vault()).objects.publish('schema',86400000,async stage=>{await fs.writeFile(path.join(stage,'payload'),text);return {mime:'application/json',schemaHash};},{signal,schemaHash});
   result.raw_schema={...result.raw_schema,uri:'h5p-schema://stored/'+snapshot.id,lifetime:'Until '+new Date(snapshot.expires).toISOString()+'; owner-bound immutable schema'};
  }
  return result;
 }
 override async readResource(uri:string) {
  this.require('h5p:read');
  if(uri.startsWith('h5p-schema://stored/'))return {contents:[{uri,mimeType:'application/json',text:(await (await this.vault()).objects.read(uri.slice('h5p-schema://stored/'.length),'schema')).toString('utf8')}]};
  if(!uri.startsWith('h5p-artifact://stored/')&&!this.resources.texts.has(uri))throw failure('OBJECT_NOT_FOUND');
  return super.readResource(uri);
 }
 async upload(kind:'asset'|'package',mime:string,body:AsyncIterable<Uint8Array>,signal:AbortSignal) {
  this.require(kind==='asset'?'h5p:author':'h5p:validate');
  return this.stored(await (await this.vault()).upload(kind,mime,body,86400000,signal));
 }
 async download(id:string) {
  this.require('h5p:read');
  const vault=await this.vault();const value=await vault.objects.get(id,'artifact');
  return {bytes:await vault.objects.read(id,'artifact'),sha256:value.files.payload.sha256};
 }
}
