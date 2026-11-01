import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {Activity,CoreRequest,Native} from '../domain/types.js';
import {limit,checkTree} from '../domain/limits.js';
import {prepareActivity} from '../application/authoring.js';
import {FileLibraryRepository} from './libraries.js';
import {resolveLibraries,libraryVersion} from './dependencies.js';
import {nativeManifest,sameNativeManifest} from '../infrastructure/native-manifest.js';
import {readBounded} from '../infrastructure/read-bounded.js';
const load=createRequire(import.meta.url);
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
export async function prepareNative(activity:Activity,libraries:string) {
 const report=await prepareActivity({libraries:new FileLibraryRepository(libraries),coreApiVersion:{major:1,minor:28}},activity);
 if(report.ok)report.activity.preparation=await nativeManifest(libraries,report.activity,report.mathematics);
 return report;
}
/** Native prepare/export backend. Call through Engine for worker isolation and atomic publication. */
export async function executeNative(request:CoreRequest) {
 if(request.action!=='prepare'&&request.action!=='export')throw fail('INVALID_PARAMETER','Native content backend supports prepare/export only');
 checkTree(request);
 if(request.export_mode!==undefined&&!['content-only','with-libraries'].includes(request.export_mode))throw fail('INVALID_PARAMETER','Unknown export mode');
 if(!request.activity)throw fail('INVALID_PARAMETER','Activity required');
 if(request.action==='export'&&request.activity.preparation&&(request.activity.preparation.version!==2||request.activity.preparation.engine!=='native-content-v1'))throw fail('STALE_PREPARATION','Prepare again with the native backend');
 const libraries=path.join(request.data_dir,'libraries'),report=await prepareNative(request.activity,libraries);
 if(request.action==='prepare')return report;
 if(!report.ok)throw Object.assign(fail('INVALID_PARAMETER','Native preparation failed'),{details:report.diagnostics});
 if(request.activity.preparation&&!sameNativeManifest(request.activity.preparation,report.activity.preparation))throw fail('STALE_PREPARATION','Backend, dependencies or assets changed; prepare again');
 if(!request.path||!path.isAbsolute(request.path))throw fail('INVALID_PARAMETER','Absolute staging output required');
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-native-content-'));
 try {
  const media=new Map<string,string>();let mediaBytes=0;
  const uploaded=await prepareActivity({libraries:new FileLibraryRepository(libraries),coreApiVersion:{major:1,minor:28},saveMedia:async(_entry,file)=>{
   const digest=createHash('sha256').update(file.data).digest('hex');
   const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp','image/tiff':'tiff','image/avif':'avif','audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','audio/webm':'webm','video/mp4':'mp4','video/webm':'webm','video/ogg':'ogv','application/pdf':'pdf','text/vtt':'vtt'};
   const name=`media/${digest}.${extensions[file.mimetype]}`;
   if(file.data.length>limit('ZIP_MEMBER_BYTES',134217728))throw fail('LIMIT_EXCEEDED','Package member byte budget exceeded');
   if(!media.has(name))mediaBytes+=file.data.length;
   if(!media.has(name)){const target=path.join(stage,path.basename(name));await fs.writeFile(target,file.data,{flag:'wx'});media.set(name,target);}
   const dimensions=file.mimetype.startsWith('image/')?load('probe-image-size').sync(file.data):null;
   return {path:name,...(dimensions?{width:dimensions.width,height:dimensions.height}:{})};
  }},report.activity);
  if(!uploaded.ok)throw Object.assign(fail('INVALID_PARAMETER','Media preparation failed'),{details:uploaded.diagnostics});
  const graph=await resolveLibraries(new FileLibraryRepository(libraries),report.activity,report.mathematics.detected);
  for(const node of graph.values()){const core=node.metadata.coreApi;if(core&&(core.majorVersion>1||core.majorVersion===1&&core.minorVersion>28))throw fail('TARGET_INCOMPATIBLE','Dependency requires a newer Core');}
  const preloaded=new Set<string>(),dynamic=new Set<string>();
  function runtime(name:string,kind:'preloaded'|'dynamic') {
   const set=kind==='preloaded'?preloaded:dynamic;if(set.has(name))return;set.add(name);
   const node=graph.get(name)!;
   for(const child of node.dependencies.preloaded)runtime(child,kind);
   for(const child of node.dependencies.dynamic)runtime(child,'dynamic');
  }
  runtime(report.activity.library,'preloaded');
  const stack:Native[]=[report.activity.params];
  while(stack.length){const value=stack.pop();if(!value||typeof value!=='object')continue;if(typeof value.library==='string'&&value.params)runtime(value.library,'preloaded');stack.push(...Object.values(value));}
  if(report.mathematics.detected)runtime('H5P.MathDisplay 1.0','preloaded');
  const main=graph.get(report.activity.library)!,modes=main.metadata.embedTypes??['div'];
  if(!Array.isArray(modes)||!modes.length||modes.some(mode=>!['div','iframe'].includes(mode)))throw fail('INVALID_METADATA','Invalid embedTypes');
  const h5p={title:report.activity.title,language:report.activity.language,license:report.activity.license,mainLibrary:main.version.machineName,embedTypes:modes,
   preloadedDependencies:[...preloaded].sort().map(libraryVersion),dynamicDependencies:[...dynamic].filter(name=>!preloaded.has(name)).sort().map(libraryVersion)};
  const buffers=[['h5p.json',Buffer.from(JSON.stringify(h5p))],['content/content.json',Buffer.from(JSON.stringify(uploaded.activity.params))]] as const;
  const libraryFiles:Array<[string,string]>=[];let libraryBytes=0;
  if(request.export_mode==='with-libraries'){
   // Include the installation closure, including editor-only dependencies, without
   // announcing those dependencies as runtime scripts in h5p.json.
   for(const [name,entry] of Object.entries(report.activity.preparation.libraries) as Array<[string,Native]>){
    const version=libraryVersion(name),folder=`${version.machineName}-${version.majorVersion}.${version.minorVersion}`;
    for(const [relative,digest] of Object.entries(entry.files)){
     if(libraryFiles.length+media.size+2>=limit('ZIP_MEMBERS',20000))throw fail('LIMIT_EXCEEDED','Package member budget exceeded');
     const filename=path.join(libraries,folder,relative),bytes=await readBounded(filename,limit('ZIP_MEMBER_BYTES',134217728));libraryBytes+=bytes.length;
     if(libraryBytes+mediaBytes>limit('ZIP_BYTES',536870912))throw fail('LIMIT_EXCEEDED','Package byte budget exceeded');
     if(createHash('sha256').update(bytes).digest('hex')!==digest)throw fail('STALE_PREPARATION','Library changed during export');
     libraryFiles.push([folder+'/'+relative,filename]);
    }
   }
  }
  if(buffers.some(([,bytes])=>bytes.length>Math.min(limit('JSON_BYTES',16777216),limit('ZIP_MEMBER_BYTES',134217728)))||media.size+libraryFiles.length+2>limit('ZIP_MEMBERS',20000)||libraryBytes+mediaBytes+buffers.reduce((total,[,bytes])=>total+bytes.length,0)>limit('ZIP_BYTES',536870912))throw fail('LIMIT_EXCEEDED','Package budget exceeded');
  const {ZipFile}=load('yazl'),zip=new ZipFile();let size=0;
  const bounded=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;if(size>limit('ZIP_ARCHIVE_BYTES',134217728))callback(fail('LIMIT_EXCEEDED','Package byte budget exceeded'));else callback(null,chunk);}});
  const writing=pipeline(zip.outputStream,bounded,createWriteStream(request.path,{flags:'wx'}));
  writing.catch(()=>{});
  try {
   for(const [name,bytes] of buffers)zip.addBuffer(bytes,name,{compress:false});
   for(const [name,filename] of libraryFiles)zip.addFile(filename,name,{compress:false});
   for(const [name,filename] of media)zip.addFile(filename,'content/'+name,{compress:false});
   zip.end();await writing;
  }catch(error){zip.outputStream.destroy();await writing.catch(()=>{});throw error;}
  const after=await nativeManifest(libraries,report.activity,report.mathematics);
  if(!sameNativeManifest(report.activity.preparation,after))throw fail('STALE_PREPARATION','Files changed during export');
  return {h5p_json:h5p,content_json:uploaded.activity.params,preparation_manifest:after,verification:{structure:'passed',semantics:'passed',importation:'not_run',playback:'not_run',grading:'not_run'},export_mode:request.export_mode??'content-only'};
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}
