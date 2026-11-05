import {runDocker} from './typst-docker.js';
import {request} from 'node:http';
import type {Native} from '../domain/types.js';

/** The local engine returns metadata only. Figure output stays on the bounded Docker CLI attachment. */
export async function engineMetadata(route:string,signal?:AbortSignal,method:'GET'|'DELETE'='GET',discard=false):Promise<Native>{
 if(process.platform==='win32'){
  let args:string[];
  if(route==='/info'&&method==='GET')args=['info','--format','{{json .}}'];
  else if(/^\/images\/[^/]+\/json$/.test(route)&&method==='GET')args=['image','inspect','--format','{{json .}}',decodeURIComponent(route.split('/')[2])];
  else if(/^\/containers\/[a-f0-9]{64}\/json$/.test(route)&&method==='GET')args=['inspect','--format','{{json .}}',route.split('/')[2]];
  else if(/^\/containers\/[a-f0-9]{64}\?force=1$/.test(route)&&method==='DELETE')args=['rm','--force',route.split('/')[2].split('?')[0]];
  else throw new Error('Unsupported Docker metadata operation.');
  const bytes=await runDocker(args,signal,1024*1024);
  return discard?undefined:JSON.parse(bytes.toString('utf8'));
 }
 const timeout=AbortSignal.timeout(20000);
 const bounded=signal?AbortSignal.any([signal,timeout]):timeout;
 const socketPath='/var/run/docker.sock';
 try{
  return await new Promise((resolve,reject)=>{
   const req=request({socketPath,path:route,method,signal:bounded},response=>{
    response.on('error',reject);
    if(response.statusCode!==200&&response.statusCode!==204){
     response.destroy();reject(new Error('Local Docker engine returned HTTP '+response.statusCode+'.'));return;
    }
    if(discard){response.resume();resolve(undefined);return;}
    let size=0;
    const chunks:Buffer[]=[];
    response.on('data',(chunk:Buffer)=>{
     size+=chunk.length;
     if(size>1024*1024)response.destroy(new Error('Docker metadata exceeds the byte limit.'));
     else chunks.push(chunk);
    });
    response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){reject(error);}});
   });
   req.on('error',reject);req.end();
  });
 }catch(error){
  if(bounded.aborted)throw Object.assign(new Error('Docker metadata request cancelled or timed out.',{cause:error}),{code:'BACKEND_TIMEOUT'});
  throw error;
 }
}
