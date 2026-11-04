import {svgMime,svgBytes,validateStaticSvg} from '../domain/static-svg.js';
import {uploadExtension,matchesMediaBytes} from '../domain/media-formats.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Objects,storageError} from './objects.js';
import {load} from '../infrastructure/runtime.js';
import {isolated} from '../infrastructure/worker.js';
export async function upload(store:Objects,kind:'asset'|'package',mime:string,input:AsyncIterable<Uint8Array>,ttl:number,callerSignal?:AbortSignal,figureSource?:string) {
 if(kind==='package'?mime!=='application/zip':!uploadExtension(mime)) throw storageError('MIME_MISMATCH');
 return store.publish(kind,ttl,async(stage,_final,signal)=>{
  const file=await fs.open(path.join(stage,'payload'),'wx');let size=0;let header=Buffer.alloc(0);
  const iterator=input[Symbol.asyncIterator]();
  let abort:()=>void=()=>{};
  const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(storageError('BACKEND_TIMEOUT'));signal.addEventListener('abort',abort,{once:true});});
  try {
   while(true) {
    const item=await Promise.race([iterator.next(),cancelled]);if(item.done)break;
    const chunk=Buffer.from(item.value);size+=chunk.length;
    if(size>Math.min(store.budgets.bytes,mime===svgMime?svgBytes:kind==='asset'?67108864:134217728)) throw storageError('LIMIT_EXCEEDED');
    if(header.length<4096)header=Buffer.concat([header,chunk.subarray(0,4096-header.length)]);
    await file.writeFile(chunk);signal.throwIfAborted();
   }
  }finally{signal.removeEventListener('abort',abort);void iterator.return?.().catch(()=>{});await file.close();}
  const types=load('magic-bytes.js').filetypeinfo(header).map((v:{mime:string})=>v.mime);
  if(mime===svgMime)validateStaticSvg(await fs.readFile(path.join(stage,'payload')));
  else if(!size||!matchesMediaBytes(mime,types,header)) throw storageError('MIME_MISMATCH');
  if(kind==='package')await isolated({action:'inspect-archive',path:path.join(stage,'payload'),data_dir:stage},signal);
  if(figureSource!==undefined){
   if(kind!=='asset'||mime!=='image/png'||Buffer.byteLength(figureSource)>65536)throw storageError('INVALID_PARAMETER');
   await fs.writeFile(path.join(stage,'figure.typ'),figureSource,{flag:'wx'});
  }
  return {mime};
 },{signal:callerSignal});
}
