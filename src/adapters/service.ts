import {randomUUID} from 'node:crypto';
import {Pool} from '../infrastructure/pool.js';
import {feedback} from './feedback.js';
import {descriptions} from './descriptions.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createReadStream} from 'node:fs';
import {Objects,type Principal,type Stored} from '../storage/objects.js';
import {Vault} from '../storage/vault.js';
import {Engine} from '../application/engine.js';
import type {CoreRequest,Native} from '../domain/types.js';
import {checkTree,limit} from '../domain/limits.js';
import {projectSemantics} from '../domain/contracts.js';
import {Resources,hash,canonical} from './resources.js';
import {base,operations,codes,examples,storage,authoring,authoringAdapters,authoringExamples,schema,toolOutputSchema,valid,invalidInput,report,failure,diagnostic,verification} from './contracts.js';
const scopes:Record<string,string>={refresh_h5p_catalog:'catalog:refresh',install_h5p_library:'libraries:install',install_h5p_library_package:'libraries:install',capture_h5p_library_snapshot:'libraries:install',activate_h5p_library_snapshot:'libraries:install'};
export const aliases:Record<string,string>={list_h5p_activities:'search_h5p_types',get_h5p_activity_schema:'get_h5p_type_contract',create_h5p_activity:'prepare_h5p_activity',export_h5p:'export_h5p_activity',validate_h5p:'validate_h5p_package'};
async function resolved(filename:string):Promise<string> {
 const absolute=path.resolve(filename);
 try{return await fs.realpath(absolute);}catch(error:Native){
  if(error.code!=='ENOENT') throw error;
  const parent=path.dirname(absolute);if(parent===absolute) throw error;
  return path.join(await resolved(parent),path.basename(absolute));
 }
}
export class Service {
 private readonly figurePool=new Pool(2,4);
 private vaultPromise?:Promise<Vault>;
 constructor(private readonly principal:Principal={tenant:'local',owner:'local'},options:{data?:string;store?:string;immutable?:boolean;adminScopes?:string[]}={}){
  if(process.env.H5P_MCP_TYPST_ENABLED==='1')
   this.definitions.render_force_figure=operations.optionalFigures.render_force_figure;
  if(process.env.H5P_MCP_TYPST_ENABLED==='1' && process.env.H5P_MCP_TYPST_SANDBOX==='docker')
   this.definitions.render_typst_figure=operations.optionalFigures.render_typst_figure;
  this.principal=Object.freeze({...principal});
  if(options.data)this.data=options.data;
  this.store=options.store||path.resolve(process.env.H5P_MCP_STORE_DIR||path.join(this.data,'objects'));
  if(options.immutable!==undefined)this.immutable=options.immutable;
  if(options.adminScopes){this.scopes.clear();for(const scope of options.adminScopes)this.scopes.add(scope);}
 }
 readonly store:string;
 engine=new Engine();
 resources=new Resources();
 readonly data=path.resolve(process.env.H5P_MCP_DATA_DIR||path.join(os.homedir(),'.h5p-mcp'));
 readonly exportDir=path.resolve(process.env.H5P_MCP_EXPORT_DIR||path.join(process.cwd(),'exports'));
 readonly immutable=process.env.H5P_MCP_IMMUTABLE==='1';
 readonly scopes=new Set((process.env.H5P_MCP_ADMIN_SCOPES||'').split(/\s+/).filter(Boolean));
 readonly roots:Record<string,string[]|undefined>={};
 readonly definitions:Record<string,string[]>={...operations.local,...storage.local,prepare_h5p_activity:['prepare_local_input','preparation_report']};
 vault() {
  return this.vaultPromise??=(async()=>{
   const objects=new Objects(this.store,this.principal);
   await objects.initialize();return new Vault(objects,this.data);
  })();
 }
 stored(value:Stored):Native {
  const result:Native={object_id:value.id,kind:value.kind,expires:value.expires};
  if(value.metadata.library_snapshot_id)result.library_snapshot_id=value.metadata.library_snapshot_id;
  if(value.files.payload)Object.assign(result,{mime_type:value.metadata.mime,size:value.files.payload.size,sha256:value.files.payload.sha256});
  if(value.metadata.feedback)Object.assign(result,value.metadata.feedback);
  if(value.kind==='artifact')Object.assign(result,{uri:'h5p-artifact://stored/'+value.id,target:value.metadata.target,verification:verification({structure:'passed',semantics:'passed'})});
  return result;
 }
 async readResource(uri:string):Promise<Native> {
  if(uri.startsWith('h5p-figure://asset/')){
   const id=uri.slice('h5p-figure://asset/'.length),vault=await this.vault();
   const asset=await vault.objects.get(id,'asset');
   if(asset.metadata.mime!=='image/png')throw failure('MIME_MISMATCH');
   if(asset.files.payload.size>limit('RESOURCE_BYTES',16777216))throw failure('LIMIT_EXCEEDED');
   return {contents:[{uri,mimeType:'image/png',blob:(await vault.objects.read(id,'asset')).toString('base64')}]};
  }
  if(!uri.startsWith('h5p-artifact://stored/'))return this.resources.read(uri);
  const vault=await this.vault(),id=uri.slice('h5p-artifact://stored/'.length),value=await vault.objects.get(id,'artifact');
  if(value.files.payload.size>limit('RESOURCE_BYTES',16777216))throw failure('LIMIT_EXCEEDED');
  return {contents:[{uri,mimeType:'application/zip',blob:(await vault.objects.read(id,'artifact')).toString('base64')}]};
 }
 async initialize() {
  if(!['0','1',undefined].includes(process.env.H5P_MCP_IMMUTABLE)) throw new Error('Invalid immutable policy');
  if([...this.scopes].some(s=>!['catalog:refresh','libraries:install'].includes(s))) throw new Error('Invalid administration scope');
  for(const kind of ['PACKAGE','EXPORT','ASSET']) {
   const setting=process.env['H5P_MCP_'+kind+'_ROOTS'];
   if(setting===undefined) continue;
   const roots=JSON.parse(setting);
   if(!Array.isArray(roots)||roots.some(r=>typeof r!=='string'||!path.isAbsolute(r))) throw new Error('Invalid authorized roots');
   this.roots[kind]=await Promise.all(roots.map(r=>resolved(r)));
  }
  await this.resources.initialize();
  for(const [name,value] of Object.entries({schema:authoring,adapters:authoringAdapters,examples:authoringExamples})) {
   const uri='h5p-authoring://v1/'+name;
   this.resources.texts.set(uri,{uri,name:'authoring-'+name,mimeType:'application/json',text:JSON.stringify(value)});
  }
  for(const [name,value] of Object.entries({schema:base,codes,profiles:operations,storage})) {
   const uri='h5p-contract://v1/'+name;
   this.resources.texts.set(uri,{uri,name,mimeType:'application/json',text:JSON.stringify(value)});
  }
 }
 allowed(name:string) {return !scopes[name]||(!this.immutable&&this.scopes.has(scopes[name]));}
 tools() {
  const tools:Native[]=Object.entries(this.definitions).filter(([name])=>this.allowed(name)).map(([name,[input,output]])=>({
   name,description:descriptions[name],inputSchema:schema(input),
   outputSchema:toolOutputSchema(output),
   annotations:{readOnlyHint:['compile_h5p_source','check_h5p_source','search_h5p_types','get_h5p_type_contract','validate_h5p_package','validate_stored_h5p_package','list_stored_h5p_objects'].includes(name),destructiveHint:name==='revoke_stored_h5p_object',openWorldHint:!!scopes[name]}
  }));
  for(const [name,target] of Object.entries(aliases)) {
   if(!Object.hasOwn(this.definitions,target))continue;
   const inputSchema=schema(this.definitions[target][0]);
   if(name==='list_h5p_activities') inputSchema.properties.refresh={type:'boolean',default:false};
   if(name==='get_h5p_activity_schema') inputSchema.properties.install_if_missing={type:'boolean',default:false};
   tools.push({name,description:'Legacy local compatibility: '+name,inputSchema});
  }
  return tools;
 }
 async authorize(filename:string,kind:string) {
  const real=await resolved(filename);
  const roots=this.roots[kind];
  if(roots&&!roots.some(root=>{const rel=path.relative(root,real);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));})) throw failure('PERMISSION_DENIED');
  return real;
 }
 async run(action:CoreRequest['action'],args:Native,signal:AbortSignal):Promise<Native> {
  const result=await this.engine.run({action,data_dir:this.data,...args},signal);
  if(action==='setup'||args.install_if_missing)await (await this.vault()).snapshot(true,signal);
  return result;
 }
 async destination(outputName:string) {
  await this.authorize(this.exportDir,'EXPORT');await fs.mkdir(this.exportDir,{recursive:true});
  const directory=await this.authorize(this.exportDir,'EXPORT');
  const filename=(outputName.replace(/[^A-Za-z0-9._-]/g,'_').replace(/^[._-]+|[._-]+$/g,'')||'export').replace(/\.h5p$/i,'')+'.h5p';
  return path.join(directory,filename);
 }
 private async packageReport(result:Native,targetID?:string){
  const {ok,package_mode,required_libraries,missing_local_libraries}=result;
  const checks=report('validation',ok,ok?[]:[{code:'LIBRARY_NOT_INSTALLED'}],{structure:'passed',semantics:ok?'passed':'not_run'});
  if(!targetID)return {...checks,package_mode,required_libraries,missing_local_libraries};
  const target=(await (await this.vault()).objects.get(targetID,'target')).metadata;
  const installed=new Set(target.libraries.map((lib:Native)=>lib.machine_name+' '+lib.major+'.'+lib.minor));
  return {...checks,package_mode,required_libraries,missing_local_libraries,
   missing_target_libraries:required_libraries.filter((name:string)=>!installed.has(name))};
 }
 async dispatch(name:string,args:Native,signal:AbortSignal):Promise<Native> {
  if(!this.allowed(name)) throw failure('PERMISSION_DENIED');
  if((name==='render_force_figure'||name==='render_typst_figure') && Object.hasOwn(this.definitions,name)){
   return this.figurePool.run(async()=>{
    const {renderForceSpec}=await import('../infrastructure/typst-figure.js');
    const parent=await this.authorize(this.exportDir,'EXPORT');await fs.mkdir(parent,{recursive:true});
    const directory=await this.authorize(path.join(parent,'figure-'+randomUUID()),'EXPORT');
    const figure=name==='render_typst_figure'
     ?await (await import('../infrastructure/typst-sandbox.js')).renderTypstFigure(args,directory,signal)
     :await renderForceSpec(args,directory,signal);
    try{
     const asset=await (await this.vault()).upload('asset','image/png',createReadStream(path.join(directory,'figure.png')),86400000,signal);
     return {ok:true,directory,manifest:figure.manifest,asset_id:asset.id,
      preview:{uri:'h5p-figure://asset/'+asset.id,mime_type:'image/png',sha256:asset.files.payload.sha256}};
    }catch(error){
     for(const name of [...Object.keys(figure.manifest.hashes),'manifest.json'])await fs.unlink(path.join(directory,name));
     await fs.rmdir(directory);throw error;
    }
   },signal);
  }
  if(Object.hasOwn(storage.local,name)) {
   const vault=await this.vault(),ttl=(args.ttl_seconds||86400)*1000;
   if(name==='upload_h5p_asset'||name==='upload_h5p_package') {
    const asset=name==='upload_h5p_asset',filename=await this.authorize(args.path,asset?'ASSET':'PACKAGE');
    return this.stored(await vault.upload(asset?'asset':'package',args.mime,createReadStream(filename),ttl,signal));
   }
   if(name==='prepare_stored_h5p_source')return this.stored(await vault.prepare(args.source,ttl,args.library_snapshot_id,signal,true));
   if(name==='prepare_stored_h5p_activity')return this.stored(await vault.prepare(args.activity,ttl,args.library_snapshot_id,signal));
   if(name==='export_prepared_h5p_activity')return this.stored(await vault.export(args.preparation_id,args.idempotency_key,args.target_profile_id,ttl,signal));
   if(name==='register_h5p_target_profile')return this.stored(await vault.target(args.profile,ttl));
   if(name==='list_stored_h5p_objects')return {objects:vault.objects.list(args.kind)};
   if(name==='revoke_stored_h5p_object'){await vault.objects.revoke(args.object_id);return {revoked:true};}
   if(name==='capture_h5p_library_snapshot')return this.stored(await vault.snapshot(true,signal));
   if(name==='activate_h5p_library_snapshot'){await vault.objects.activate('libraries',args.object_id);return this.stored(await vault.objects.get(args.object_id,'libraries'));}
   if(name==='validate_stored_h5p_package'){return this.packageReport(await vault.validate(args.object_id,signal),args.target_profile_id);}
  }
  if(name==='search_h5p_types'||name==='refresh_h5p_catalog') return this.run('discover',{query:'',installed_only:false,offset:0,limit:20,...args,refresh:name==='refresh_h5p_catalog'},signal);
  if(name==='get_h5p_type_contract'||name==='install_h5p_library') {
   const raw=await this.run('schema',{...args,install_if_missing:name==='install_h5p_library'},signal);
   if(name==='install_h5p_library') return raw;
   return {contract_version:'1',format:'h5p-native-compact-v1',library:raw.library,patch_version:raw.patch_version,core:raw.core,
    ...projectSemantics(raw.semantics),examples:examples.filter((item:Native)=>item.library===raw.library&&item.patch_version===raw.patch_version&&item.semantics_sha256===hash(JSON.stringify(canonical(raw.semantics)))).map(({title,params,evidence}:Native)=>({title,params,evidence})),raw_schema:this.resources.snapshot(raw),
    'x-h5p':{verification:verification(),note:'Native semantics are authoritative; playback and grading require target testing.'}};
  }
  if(name==='install_h5p_library_package') {
   const filename=await this.authorize(args.path,'PACKAGE');
   return this.run('setup',{packages:[filename]},signal);
  }
  if(['compile_h5p_source','check_h5p_source','build_h5p_source'].includes(name)) {
   const compiled=await this.run('compile',{source:args.source},signal);
   const result:Native={...report(compiled.ok?'compilation':'validation',compiled.ok,compiled.diagnostics,{structure:compiled.ok?'passed':'failed',semantics:compiled.ok?'passed':'failed'}),...feedback(compiled),source_map:compiled.source_map,identities:compiled.identities,activity:compiled.ok?compiled.activity:null};
   if(compiled.ok)result.normalized=compiled.normalized;
   if(name==='build_h5p_source'&&compiled.ok){
    const destination=await this.destination(args.output_name);
    const exported=await this.run('export',{backend:'native-content',activity:compiled.activity,path:destination},signal);
    result.artifact=await this.resources.artifact(destination,{h5p:exported.h5p_json,preparation:exported.preparation_manifest,export_mode:'content-only'},exported.content_json);
    result.export_mode='content-only';
   }
   return result;
  }
  if(name==='prepare_h5p_activity') {
   const result=await this.run('prepare',{activity:{language:'en',license:'U',assets:{},...args}},signal);
   return {...report(result.ok?'preparation':'validation',result.ok,result.diagnostics,{structure:result.ok?'passed':'failed',semantics:result.ok?'passed':'failed'}),...feedback(result),activity:result.ok?result.activity:null};
  }
  if(name==='validate_h5p_package') {
   const filename=await this.authorize(args.path,'PACKAGE');
   return this.packageReport(await this.run('validate',{path:filename},signal),args.target_profile_id);
  }
  if(name==='export_h5p_activity') {
   const destination=await this.destination(args.output_name);
   const result=await this.run('export',{activity:{language:'en',license:'U',assets:{},...args.activity},path:destination},signal);
   const artifact=await this.resources.artifact(destination,{h5p:result.h5p_json,preparation:result.preparation_manifest},result.content_json);
   return {...report('export',true,[],{structure:'passed',semantics:'passed'}),artifact};
  }
  if(name==='export_h5p_batch') {
   if(args.activities.length>limit('BATCH',50)) throw failure('LIMIT_EXCEEDED');
   const results=[];
   for(const [index,activity] of args.activities.entries()) {
    signal.throwIfAborted();
    const output_name=(args.name_prefix||'activity')+'_'+String(index+1).padStart(3,'0');
    try {const item=await this.dispatch('export_h5p_activity',{activity,output_name},signal);results.push({ok:true,output_name,output_path:this.resources.artifacts.get(item.artifact.uri)!.filename});}
    catch(error) {results.push({ok:false,output_name,kind:'operational_error',diagnostics:[diagnostic(error)]});}
   }
   return {count:results.length,succeeded:results.filter(r=>r.ok).length,results};
  }
  throw failure('SCHEMA_VALIDATION_FAILED');
 }
 async call(name:string,args:Native,signal:AbortSignal=AbortSignal.timeout(limit('SECONDS',300)*1000)):Promise<Native> {
  if(Object.hasOwn(aliases,name)) return this.legacy(name,args,signal);
  const definition=this.definitions[name];
  let result:Native,compilerDiagnostic:string|undefined;
  try {
   checkTree(args);
   if(!definition) throw failure('SCHEMA_VALIDATION_FAILED');
   const inputDefinition=['compile_h5p_source','check_h5p_source'].includes(name)?'authoring_envelope_input':name==='build_h5p_source'?'authoring_build_envelope_input':definition[0];
   if(!valid(inputDefinition,args)) throw invalidInput(inputDefinition);
   result=await this.dispatch(name,args,signal);
   if(!valid(definition[1],result)) throw failure('INTERNAL_ERROR');
   if(Buffer.byteLength(JSON.stringify(result))>limit('OUTPUT_BYTES',16777216)) throw failure('LIMIT_EXCEEDED');
  } catch(error:Native) {
   const code=['TimeoutError','AbortError'].includes(error.name)?'BACKEND_TIMEOUT':error.code==='EEXIST'?'OUTPUT_ALREADY_EXISTS':error.code==='ENOENT'?'ASSET_NOT_FOUND':['EACCES','EPERM'].includes(error.code)?'PERMISSION_DENIED':error.code;
   if(name==='render_typst_figure' && typeof error.compilerDiagnostic==='string')compilerDiagnostic=error.compilerDiagnostic;
   const item=diagnostic({...error,code});
   const validation=['SCHEMA_VALIDATION_FAILED','LIBRARY_NOT_INSTALLED','LIBRARY_VERSION_MISMATCH','UNSAFE_ARCHIVE','STALE_PREPARATION','ASSET_NOT_FOUND','MIME_MISMATCH'].includes(item.code);
   result={...report(validation?'validation':'operational_error',false,validation&&Array.isArray(error.details)?error.details:[item]),...feedback(error.feedback)};
   if(name==='prepare_h5p_activity') result.activity=null;
  }
  const content:Native[]=[{type:'text',text:JSON.stringify(result)}];
  if(compilerDiagnostic)content.push({type:'text',text:compilerDiagnostic});
  if((name==='render_force_figure'||name==='render_typst_figure') && result.ok)content.push({type:'resource_link',uri:result.preview.uri,name:'Figure preview',mimeType:'image/png'});
  if(result.artifact) content.push({type:'resource_link',uri:result.artifact.uri,name:'H5P package',mimeType:'application/zip',size:result.artifact.size});
  if(result.kind==='artifact'&&result.uri)content.push({type:'resource_link',uri:result.uri,name:'Stored H5P package',mimeType:'application/zip',size:result.size});
  return {content,structuredContent:result,isError:result.kind==='operational_error'};
 }
 async legacy(name:string,args:Native,signal:AbortSignal):Promise<Native> {
  const target=aliases[name],input={...args};
  const checked={...input};delete checked.refresh;delete checked.install_if_missing;
  if(!valid(this.definitions[target][0],checked)) return this.call(target,checked,signal);
  for(const flag of ['refresh','install_if_missing']) if(flag in input&&typeof input[flag]!=='boolean') return this.call(target,{invalid:true},signal);
  let mapped=target;
  if(name==='list_h5p_activities') {
   if(input.refresh) {
    if(!this.allowed('refresh_h5p_catalog')) return this.call('refresh_h5p_catalog',{},signal);
    const refreshed=await this.call('refresh_h5p_catalog',{},signal);
    if(refreshed.structuredContent.ok===false) return refreshed;
   }
   delete input.refresh;
  }
  if(name==='get_h5p_activity_schema') {
   if(input.install_if_missing) mapped='install_h5p_library';
   delete input.install_if_missing;
  }
  const response=await this.call(mapped,input,signal),result=response.structuredContent;
  if(result.ok===false) return response;
  let legacy:Native=result;
  if(name==='get_h5p_activity_schema'&&mapped===target) legacy=JSON.parse((await this.resources.read(result.raw_schema.uri)).contents[0].text);
  if(name==='create_h5p_activity') legacy={...result,errors:[]};
  if(name==='export_h5p') {
   const entry=this.resources.artifacts.get(result.artifact.uri)!;
   legacy={output_path:entry.filename,h5p_json:result.artifact.manifest.h5p,content_json:entry.content,verification:result.verification};
  }
  if(name==='validate_h5p') legacy={...result,errors:[],warnings:result.warnings??[]};
  return {content:[{type:'text',text:JSON.stringify(legacy)}],structuredContent:legacy,isError:false};
 }
 async close(){await this.engine.close();if(this.vaultPromise)await (await this.vaultPromise).close();}
}
