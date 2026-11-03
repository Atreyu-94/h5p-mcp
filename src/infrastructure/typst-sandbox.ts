import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import type {Native} from '../domain/types.js';
import {publishFigure} from './typst-figure.js';
import {renderSinglePage,pixelsPerInch} from './typst-page.js';
import {runFigureProcess} from './typst-process.js';
import {profile,sha,verifyProfile} from './typst-profile.js';

export const sandboxImage='ghcr.io/typst/typst@sha256:032e292249bcd378480cc7c142cfa324b63ef8aadeb88d7e7230320c4c9c422f';
const unavailable=(message:string)=>Object.assign(new Error(message),{code:'RENDERER_UNAVAILABLE'});
const endpoint=process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock';

function docker(args:string[],signal?:AbortSignal,maxStdout=65536) {
 return runFigureProcess('docker',['--host',endpoint,...args],signal,{maxStdout,timeoutMs:20000});
}

async function checkEngine(signal?:AbortSignal) {
 try{
  const limits=await docker(['info','--format','{{.OSType}} {{.MemoryLimit}} {{.SwapLimit}} {{.PidsLimit}}'],signal);
  if(limits.toString().trim()!=='linux true true true')throw new Error('Linux memory, swap and PID controls are required.');
  await docker(['image','inspect','--format','{{.Id}}',sandboxImage],signal);
 }catch(error){
  if(signal?.aborted)throw error;
  throw unavailable('Local sandbox unavailable. Check Docker and pull the pinned image. '+(error as Error).message);
 }
}

async function compile(root:string,packages:string,format:'svg'|'png',signal?:AbortSignal) {
 const name='h5p-typst-'+randomUUID();
 // Only the freshly prepared input and verified packages are visible from the host.
 // Refuse mount option separators instead of interpreting any part of a host path as an option.
 if([root,packages].some(p=>/[,"\r\n]/.test(p)))throw unavailable('Unsupported Docker mount path.');
 const args=['create','--pull','never','--name',name,'--network','none','--read-only',
  '--cap-drop','ALL','--security-opt','no-new-privileges','--user','65534:65534',
  '--memory','256m','--memory-swap','256m','--cpus','1','--pids-limit','64',
  '--ulimit','cpu=15:16','--log-driver','none','--workdir','/input',
  '--mount','type=bind,src='+root+',dst=/input,readonly',
  '--mount','type=bind,src='+packages+',dst=/packages,readonly',
  sandboxImage,'compile','--root','/input','--package-path','/packages','--package-cache-path','/empty',
  '--ignore-system-fonts','--creation-timestamp','0','--ppi',String(pixelsPerInch),
  '--format',format,'/input/figure.typ','-'];
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
  const state=JSON.parse((await docker(['inspect','--format','{{json .State}}',id],signal)).toString());
  if(state.OOMKilled)throw Object.assign(new Error('Compiler exceeded sandbox memory.'),{code:'LIMIT_EXCEEDED'});
  if(attachmentError || state.Running || state.ExitCode!==0 || !bytes){
   const message=(attachmentError as Error)?.message || 'Isolated compiler exited with code '+state.ExitCode;
   throw Object.assign(new Error(message),{code:'BACKEND_ERROR',compilerDiagnostic:message.slice(0,2048)});
  }
  return bytes;
 }finally{
  // Killing a Docker CLI does not kill its container. Wait for removal on every exit.
  await docker(['rm','--force',id]);
 }
}

export async function renderTypstFigure(input:Native,output:string,signal?:AbortSignal) {
 if(process.env.H5P_MCP_TYPST_ENABLED!=='1'||process.env.H5P_MCP_TYPST_SANDBOX!=='docker')
  throw unavailable('Enable the local Docker Typst sandbox.');
 if(typeof input.source!=='string'||!input.source.trim()||Buffer.byteLength(input.source)>65536||
    typeof input.alt!=='string'||!input.alt.trim()||input.alt.length>512||
    Object.keys(input).some(k=>k!=='source'&&k!=='alt'))
  throw Object.assign(new Error('Expected Typst source (up to 64 KiB) and alternative text.'),{code:'INVALID_PARAMETER'});
 await checkEngine(signal);
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-typst-source-'));
 try{
  const root=path.join(work,'input'),packages=path.join(work,'packages');
  await fs.mkdir(root);
  await verifyProfile(process.env.H5P_MCP_TYPST_PACKAGES||'',packages);
  const source=Buffer.from(input.source);
  await fs.writeFile(path.join(root,'figure.typ'),source,{mode:0o644});
  const page=await renderSinglePage(format=>compile(root,packages,format,signal));
  const files={'figure.typ':source,'figure.svg':page.svg,'figure.png':page.png};
  const manifest={version:1,compiler:'Typst 0.15.1',imageDigest:sandboxImage,packages:profile,fonts:'embedded',ppi:pixelsPerInch,
   image:{path:'figure.png',mime:'image/png',width:page.pngWidth,height:page.pngHeight,alt:input.alt},
   master:{path:'figure.svg',mime:'image/svg+xml',width:page.widthPt,height:page.heightPt,unit:'pt'},
   hashes:Object.fromEntries(Object.entries(files).map(([file,bytes])=>[file,sha(bytes)]))};
  return await publishFigure(output,files,manifest,signal);
 }finally{await fs.rm(work,{recursive:true,force:true});}
}
