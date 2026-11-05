import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {limit} from '../domain/limits.js';
import type {CoreRequest,Reply} from '../domain/types.js';
export async function isolated(request:CoreRequest,signal:AbortSignal,assetRoots?:string[]):Promise<unknown> {
 const installing=request.action==='setup'||request.install_if_missing;
 const parent=installing?request.data_dir:os.tmpdir();
 if(installing)await fs.mkdir(parent,{recursive:true});
 const root=await fs.mkdtemp(path.join(parent,'h5p-worker-core-'));
 try {
  return await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL('../adapters/worker.js',import.meta.url))],
    {env:{...process.env,...(assetRoots?{H5P_MCP_ASSET_ROOTS:JSON.stringify(assetRoots)}:{}),TMP:root,TEMP:root,TMPDIR:root},stdio:['pipe','pipe','pipe'],windowsHide:true});
   let bytes=0,failed:Error|undefined;const chunks:Buffer[]=[];
   const abort=()=>{failed=Object.assign(new Error('Core job cancelled'),{code:'BACKEND_TIMEOUT'});child.kill();};
   signal.addEventListener('abort',abort,{once:true});
   for(const stream of [child.stdout,child.stderr]) stream.on('data',(chunk:Buffer)=>{
    bytes+=chunk.length;
    if(bytes>limit('OUTPUT_BYTES',33554432)){failed=Object.assign(new Error('Worker output exceeded'),{code:'OUTPUT_TOO_LARGE'});child.kill();}
    else if(stream===child.stdout) chunks.push(chunk);
   });
   child.on('error',error=>{failed=error;});
   child.stdin.on('error',error=>{failed ||= error;});
   child.on('close',()=>{
    signal.removeEventListener('abort',abort);
    if(failed){reject(failed);return;}
    try {
     const reply=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Reply;
     if(!reply.ok) throw Object.assign(new Error(reply.errors?.join('; ')||'Worker failed'),{code:reply.code,details:reply.details});
     resolve(reply.result);
    } catch(error) {reject(error);}
   });
   if(signal.aborted) abort();else child.stdin.end(JSON.stringify(request));
  });
 } finally {await fs.rm(root,{recursive:true,force:true});}
}
