import {checkImageLock,configuredImages,imagePolicy,sandboxImage,type ImageLock} from './typst-images.js';
import {engineMetadata} from './typst-engine.js';
import {copyRasterTools,rasterArch,rasterBase,rasterLock,rasterPolicy,setupRaster} from './typst-raster.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import type {Native} from '../domain/types.js';
import {publishFigure} from './typst-figure.js';
import {renderSinglePage,pixelsPerInch} from './typst-page.js';
import {runDocker,dockerPath} from './typst-docker.js';
import {originalProfile,profile,sha,verifyProfile} from './typst-profile.js';

export {sandboxImage} from './typst-images.js';
const unavailable=(message:string)=>Object.assign(new Error(message),{code:'RENDERER_UNAVAILABLE'});

/** Pre-policy-field bundles used the same pinned compiler, fonts, packages and render settings. */
export function checkFigureProject(manifest:Native) {
 const selected=[profile,originalProfile].find(candidate=>manifest?.packages &&
  Object.keys(manifest.packages).length===Object.keys(candidate).length &&
  Object.entries(candidate).every(([name,digest])=>manifest.packages[name]===digest));
 const layered=manifest?.renderPolicy===imagePolicy;
 if(layered){
  const images=checkImageLock(manifest.images);
  if(selected!==profile||manifest.rasterizer?.arch!==images.arch)throw new Error('Unsupported image project profile.');
 }else if(manifest?.images!==undefined)throw new Error('Unexpected image lock.');
 if(layered||manifest?.renderPolicy===rasterPolicy){
  const lock=manifest.rasterizer,expected=rasterLock(rasterArch(String(lock?.arch)));
  if(!lock||Object.keys(lock).length!==Object.keys(expected).length||
     !Object.entries(expected).every(([k,v])=>lock[k]===v))throw new Error('Unsupported rasterizer lock.');
 }else if(manifest?.rasterizer!==undefined)throw new Error('Unexpected rasterizer lock.');
 if(!selected||manifest.version!==1||manifest.imageDigest!==sandboxImage||
    (manifest.renderPolicy!==undefined&&manifest.renderPolicy!=='offline-single-page-v1'&&manifest.renderPolicy!==rasterPolicy&&!layered)||
    manifest.fonts!=='embedded'||manifest.ppi!==pixelsPerInch)
  throw new Error('Unsupported figure project or renderer policy.');
 return selected;
}

function docker(args:string[],signal?:AbortSignal,maxStdout=65536) {
 return runDocker(args,signal,maxStdout);
}

export async function setupDockerRaster(root:string,signal:AbortSignal){
 const arch=(await docker(['info','--format','{{.Architecture}}'],signal)).toString().trim();
 return setupRaster(root,rasterArch(arch),signal);
}

async function checkEngine(useRaster:boolean,useImages:boolean,signal?:AbortSignal) {
 try{
  const info=await engineMetadata('/info',signal);
  if(info.OSType!=='linux'||info.MemoryLimit!==true||info.SwapLimit!==true||info.PidsLimit!==true)
   throw new Error('Linux memory, swap and PID controls are required.');
  const images=useImages?[]:useRaster?[sandboxImage,rasterBase]:[sandboxImage];
  await Promise.all(images.map(image=>engineMetadata('/images/'+encodeURIComponent(image)+'/json',signal,'GET',true)));
  return useRaster?rasterArch(info.Architecture):undefined;
 }catch(error){
  if(signal?.aborted)throw error;
  throw unavailable('Local sandbox unavailable. Check Docker and pull the pinned image. '+(error as Error).message);
 }
}

async function isolatedPage(root:string,tools:string|undefined,command:string[],isRaster:boolean,signal?:AbortSignal) {
 const name='h5p-typst-'+randomUUID();
 // Image profiles mount only the phase input. Legacy profiles also mount verified dependencies.
 // Refuse mount option separators instead of interpreting any part of a host path as an option.
 if([root,tools].some(p=>p&&/[,"\r\n]/.test(p)))throw unavailable('Unsupported Docker mount path.');
 const args=['create','--pull','never','--name',name,'--network','none','--read-only',
  '--cap-drop','ALL','--security-opt','no-new-privileges','--user','65534:65534',
  '--memory','256m','--memory-swap','256m','--cpus','1','--pids-limit','64',
  '--ulimit','cpu=15:16','--log-driver','none','--workdir','/input',
  '--mount','type=bind,src='+await dockerPath(root,signal)+',dst=/input,readonly',
  ...(tools?['--mount','type=bind,src='+await dockerPath(tools,signal)+',dst='+(isRaster?'/tools':'/packages')+',readonly']:[]),...command];
 signal?.throwIfAborted();
 // Let creation finish before observing cancellation so cleanup always targets an existing ID.
 const id=(await docker(args)).toString().trim();
 if(!/^[a-f0-9]{64}$/.test(id))throw unavailable('Docker returned an invalid container ID.');
 try{
  let bytes:Buffer|undefined,attachmentError:unknown;
  try{bytes=await docker(['start','--attach',id],signal,4*1024*1024);}
  catch(error){
   if((error as {code?:string}).code!=='BACKEND_ERROR')throw error;
   attachmentError=error;
  }
  const state=(await engineMetadata('/containers/'+id+'/json',signal)).State;
  if(state.OOMKilled)throw Object.assign(new Error('Compiler exceeded sandbox memory.'),{code:'LIMIT_EXCEEDED'});
  if(attachmentError || state.Running || state.ExitCode!==0 || !bytes){
   const message=(attachmentError as Error)?.message || 'Isolated compiler exited with code '+state.ExitCode;
   throw Object.assign(new Error(message),{code:'BACKEND_ERROR',compilerDiagnostic:message.slice(0,2048)});
  }
  return bytes;
 }finally{
  // Killing a Docker CLI does not kill its container. Wait for removal on every exit.
  await engineMetadata('/containers/'+id+'?force=1',undefined,'DELETE',true);
 }
}

export async function renderTypstFigure(input:Native,output:string,signal?:AbortSignal,lockedProfile?:typeof profile,lockedPolicy?:string,lockedImages?:ImageLock) {
 if(process.env.H5P_MCP_TYPST_ENABLED!=='1'||process.env.H5P_MCP_TYPST_SANDBOX!=='docker')
  throw unavailable('Enable the local Docker Typst sandbox.');
 if(typeof input.source!=='string'||!input.source.trim()||Buffer.byteLength(input.source)>65536||
    typeof input.alt!=='string'||!input.alt.trim()||input.alt.length>512||
    Object.keys(input).some(k=>k!=='source'&&k!=='alt'))
  throw Object.assign(new Error('Expected Typst source (up to 64 KiB) and alternative text.'),{code:'INVALID_PARAMETER'});
 const useImages=lockedProfile?lockedPolicy===imagePolicy:!!process.env.H5P_MCP_TYPST_IMAGE_PROFILE;
 const useRaster=useImages||(lockedProfile?lockedPolicy===rasterPolicy:!!process.env.H5P_MCP_TYPST_RASTER_DIR);
 const arch=await checkEngine(useRaster,useImages,signal);
 const images=useImages&&arch?await configuredImages(arch,lockedImages):undefined;
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-typst-source-'));
 try{
  const root=path.join(work,'input'),packages=path.join(work,'packages');
  await fs.mkdir(root);
  let selected=lockedProfile??profile;
  if(!images){
   const configured=process.env.H5P_MCP_TYPST_PACKAGES||'';
   if(!path.isAbsolute(configured))throw unavailable('Configure the absolute Typst package profile directory.');
   if(!lockedProfile){
    const installed=await fs.readdir(path.join(configured,'preview'));
    if(!installed.some(name=>['lilaq','chemformula','typed-smiles','elembic','tiptoe','zero'].includes(name)))selected=originalProfile;
   }
   await verifyProfile(configured,packages,selected);
  }
  const source=Buffer.from(input.source);
  await fs.writeFile(path.join(root,'figure.typ'),source,{mode:0o644});
  const compile=(format:'svg'|'png')=>isolatedPage(root,images?undefined:packages,[images?.compiler??sandboxImage,'compile','--root','/input',
   '--package-path','/packages','--package-cache-path','/empty','--ignore-system-fonts','--creation-timestamp','0',
   '--ppi',String(pixelsPerInch),'--format',format,'/input/figure.typ','-'],false,signal);
  const page=await renderSinglePage(compile,arch?async svg=>{
   const input=path.join(work,'raster-input'),tools=path.join(work,'raster-tools');
   await fs.mkdir(input);
   await fs.writeFile(path.join(input,'figure.svg'),svg,{mode:0o644,flag:'wx'});
   if(!images)await copyRasterTools(process.env.H5P_MCP_TYPST_RASTER_DIR,arch,tools);
   // Fixed pipeline: neither source text nor a host path is interpreted by the shell.
   return isolatedPage(input,images?undefined:tools,[images?.raster??rasterBase,'/bin/bash','-o','pipefail','-c',
    '/tools/resvg --dpi 192 --skip-system-fonts /input/figure.svg -c | /tools/oxipng -o 1 --threads 1 --stdout -'],true,signal);
  }:undefined);
  const files={'figure.typ':source,'figure.svg':page.svg,'figure.png':page.png};
  const manifest={version:1,renderPolicy:images?imagePolicy:arch?rasterPolicy:'offline-single-page-v1',...(images?{images}:{}),...(arch?{rasterizer:rasterLock(arch)}:{}),compiler:'Typst 0.15.1',imageDigest:sandboxImage,packages:selected,fonts:'embedded',ppi:pixelsPerInch,
   image:{path:'figure.png',mime:'image/png',width:page.pngWidth,height:page.pngHeight,alt:input.alt},
   master:{path:'figure.svg',mime:'image/svg+xml',width:page.widthPt,height:page.heightPt,unit:'pt'},
   hashes:Object.fromEntries(Object.entries(files).map(([file,bytes])=>[file,sha(bytes)]))};
  return await publishFigure(output,files,manifest,signal);
 }finally{await fs.rm(work,{recursive:true,force:true});}
}
