import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {preflight} from '../infrastructure/archive.js';
import {readBounded} from '../infrastructure/read-bounded.js';
import {FileLibraryRepository} from './libraries.js';
import {resolveLibraries,libraryVersion} from './dependencies.js';
import {prepareActivity} from '../application/authoring.js';
import type {Native} from '../domain/types.js';
const load=createRequire(import.meta.url),fail=(code='SCHEMA_VALIDATION_FAILED')=>Object.assign(new Error(code),{code});
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function json(filename:string){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(filename,16777216)));}
export async function unpack(filename:string,work:(root:string)=>Promise<Native>,content=false){
 await preflight(filename,content);const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-package-native-'));
 try{const zip=await load('yauzl-promise').open(filename);try{for await(const entry of zip){const target=path.join(root,entry.filename);if(entry.filename.endsWith('/')){await fs.mkdir(target,{recursive:true});continue;}await fs.mkdir(path.dirname(target),{recursive:true});const file=await fs.open(target,'wx');try{for await(const bytes of await entry.openReadStream())await file.writeFile(bytes);}finally{await file.close();}}}finally{await zip.close();}return await work(root);}catch(error:Native){if(['TARGET_INCOMPATIBLE','LIBRARY_VERSION_MISMATCH','LIMIT_EXCEEDED','UNSAFE_ARCHIVE'].includes(error.code))throw error;throw Object.assign(fail(),{details:error.details});}finally{await fs.rm(root,{recursive:true,force:true});}
}
export async function inspectLibraries(root:string){
 const result:Native[]=[];const repo=new FileLibraryRepository(root);
 for(const dir of await fs.readdir(root,{withFileTypes:true})){
  if(!dir.isDirectory()||dir.name==='content')continue;
  const meta=await json(path.join(root,dir.name,'library.json')),version=libraryVersion(`${meta.machineName} ${meta.majorVersion}.${meta.minorVersion}`);
  if(dir.name!==`${version.machineName}-${version.majorVersion}.${version.minorVersion}`)throw fail();
  if(typeof meta.title!=='string'||!meta.title||![0,1].includes(meta.runnable)||meta.coreApi&&(!Number.isSafeInteger(meta.coreApi.majorVersion)||meta.coreApi.majorVersion<0||!Number.isSafeInteger(meta.coreApi.minorVersion)||meta.coreApi.minorVersion<0))throw fail();
  const allowed=new Set('js css json svg png jpg jpeg gif webp eot ttf woff woff2 otf txt pdf rtf doc docx xls xlsx ppt pptx odt ods odp xml csv diff patch swf md textile map'.split(' '));
  const resources=async(base:string):Promise<void>=>{for(const e of await fs.readdir(base,{withFileTypes:true})){const file=path.join(base,e.name);if(e.isDirectory())await resources(file);else if(!allowed.has(path.extname(e.name).slice(1).toLowerCase())&&!/^(?:LICENSE|COPYING|NOTICE)$/i.test(e.name))throw fail();}};
  await resources(path.join(root,dir.name));
  await repo.getLibrary(version);if(meta.coreApi&&(meta.coreApi.majorVersion>1||meta.coreApi.majorVersion===1&&meta.coreApi.minorVersion>28))throw fail('TARGET_INCOMPATIBLE');
  try{await repo.getSemantics(version);}catch(error:Native){if(meta.runnable||error.code!=='ENOENT')throw error;}
  for(const key of ['preloadedJs','preloadedCss'])for(const file of meta[key]||[]){if(typeof file.path!=='string'||file.path.includes('\\')||file.path.split('/').some((p:string)=>!p||p==='..'||p==='.')||path.isAbsolute(file.path))throw fail();await fs.access(path.join(root,dir.name,file.path));}
  result.push({name:`${meta.machineName} ${meta.majorVersion}.${meta.minorVersion}`,folder:dir.name,metadata:meta});
 }
 return result;
}
export async function installPackage(filename:string,data:string){return unpack(filename,async root=>{
 const libraries=await inspectLibraries(root);if(!libraries.length)throw fail();
 const target=path.join(data,'libraries');await fs.mkdir(target,{recursive:true});
 const repo=new FileLibraryRepository(root),installed=new FileLibraryRepository(target);
 const combined={getLibrary:async(v:Native)=>{try{return await repo.getLibrary(v);}catch(error:Native){if(error.code!=='ENOENT')throw error;return installed.getLibrary(v);}},getSemantics:(v:Native)=>repo.getSemantics(v)};
 for(const item of libraries)await resolveLibraries(combined,{library:item.name,params:{}});
 // All conflicts are checked before publishing any library. Equal patches must
 // have identical files; newer/older patches require an explicit replacement policy.
 for(const item of libraries){
  const destination=path.join(target,item.folder);
  if(await fs.access(destination).then(()=>true,()=>false)){
   const inventory=async(base:string)=>{const files:Record<string,string>={};const walk=async(dir:string):Promise<void>=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw fail();const file=path.join(dir,e.name);if(e.isDirectory())await walk(file);else files[path.relative(base,file)]=hash(await readBounded(file,134217728));}};await walk(base);return Object.entries(files).sort();};
   if(JSON.stringify(await inventory(destination))!==JSON.stringify(await inventory(path.join(root,item.folder))))throw fail('LIBRARY_VERSION_MISMATCH');
  }
 }
 for(const item of libraries){const destination=path.join(target,item.folder);if(!await fs.access(destination).then(()=>true,()=>false))await fs.cp(path.join(root,item.folder),destination,{recursive:true,errorOnExist:true,force:false});}
 return {ok:true,libraries:libraries.length,engine:'native-package-v1'};
 });}
/** Check package metadata before projecting it onto the authoring contract. */
function validateMetadata(meta:Native){
 if(!meta||typeof meta!=='object'||Array.isArray(meta))throw fail();
 for(const key of ['title','language','mainLibrary'])if(typeof meta[key]!=='string'||!meta[key])throw fail();
 if(!Array.isArray(meta.embedTypes)||!meta.embedTypes.length||meta.embedTypes.some((value:Native)=>!['div','iframe'].includes(value)))throw fail();
 if(!Array.isArray(meta.preloadedDependencies)||!meta.preloadedDependencies.length)throw fail();
 for(const key of ['preloadedDependencies','dynamicDependencies']){
  if(meta[key]===undefined)continue;
  if(!Array.isArray(meta[key]))throw fail();
  for(const item of meta[key]){
   if(!item||typeof item.machineName!=='string'||!Number.isSafeInteger(item.majorVersion)||item.majorVersion<0||!Number.isSafeInteger(item.minorVersion)||item.minorVersion<0)throw fail();
   libraryVersion(item.machineName+' '+item.majorVersion+'.'+item.minorVersion);
  }
 }
 // Preparation validates title, language and license values. Do not replace
 // malformed metadata with defaults when projecting the package into an activity.
 for(const key of ['license','licenseVersion','licenseExtras','source','author','contentType','authorComments','yearsFrom','yearsTo','w','h','metaKeywords','metaDescription','a11yTitle'])if(meta[key]!==undefined&&typeof meta[key]!=='string')throw fail();
 for(const [key,fields] of [['authors',['name','role']],['changes',['date','author','log']]] as const){
  if(meta[key]===undefined)continue;
  if(!Array.isArray(meta[key])||meta[key].some((item:Native)=>!item||fields.some(field=>typeof item[field]!=='string'||!item[field])))throw fail();
 }
}
export async function validatePackage(filename:string){return unpack(filename,async root=>{
 const libraries=await inspectLibraries(root),meta=await json(path.join(root,'h5p.json')),params=await json(path.join(root,'content/content.json'));
 validateMetadata(meta);
 const main=meta.preloadedDependencies.find((v:Native)=>v.machineName===meta.mainLibrary);if(!main)throw fail();
 const assets:Record<string,string>={};let index=0;const pending=[params];
 while(pending.length){const value=pending.pop();if(!value||typeof value!=='object')continue;if(typeof value.path==='string'&&!/^https?:\/\//i.test(value.path)){
  const relative=value.path;if(relative.includes('\\')||relative.split('/').some((p:string)=>!p||p==='..'||p==='.')||path.isAbsolute(relative))throw fail();const file=path.join(root,'content',relative);await fs.access(file);const id='package'+index++;assets[id]=file;value.path='asset:'+id;
 }pending.push(...Object.values(value));}
 const activity={title:meta.title,language:meta.language,license:meta.license??'U',library:`${main.machineName} ${main.majorVersion}.${main.minorVersion}`,params,assets};
 const repo=new FileLibraryRepository(root);await resolveLibraries(repo,activity);
 for(const item of libraries)await resolveLibraries(repo,{library:item.name,params:{}});
 for(const kind of ['preloadedDependencies','dynamicDependencies'])for(const item of meta[kind]||[])await resolveLibraries(repo,{library:`${item.machineName} ${item.majorVersion}.${item.minorVersion}`,params:{}});
 const previous=process.env.H5P_MCP_ASSET_ROOTS;process.env.H5P_MCP_ASSET_ROOTS=JSON.stringify([path.join(root,'content')]);
 try{const report=await prepareActivity({libraries:repo,coreApiVersion:{major:1,minor:28}},activity);if(!report.ok)throw Object.assign(fail(),{details:report.diagnostics});}finally{if(previous===undefined)delete process.env.H5P_MCP_ASSET_ROOTS;else process.env.H5P_MCP_ASSET_ROOTS=previous;}
 return {ok:true,errors:[],warnings:[],libraries:libraries.length,engine:'native-package-v1'};
 },true);}
