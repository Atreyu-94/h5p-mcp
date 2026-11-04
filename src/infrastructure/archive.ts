import {svgBytes,validateStaticSvg} from '../domain/static-svg.js';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url);
import {limit,checkTree} from '../domain/limits.js';
import type {Native} from '../domain/types.js';
const reject=()=>Object.assign(new Error('Archive rejected'),{code:'UNSAFE_ARCHIVE'});
/** Drain every member, including files Lumi would ignore, before any installation. */
export async function preflight(filename:string,contentRequired=false,allowSvgContent?:boolean) {
 if((await fs.stat(filename)).size>limit('ZIP_ARCHIVE_BYTES',134217728)) throw reject();
 const yauzl=load('yauzl-promise'),crc32=load('@node-rs/crc32').crc32;
 let zip:Native;
 try {
  zip=await yauzl.open(filename,{validateFilenames:false});
  const paths=new Map<string,{original:string,directory:boolean,explicit:boolean}>();
  const roots:Record<string,Native>={};
  let members=0,declared=0,expanded=0;
  for await(const entry of zip) {
   if(++members>limit('ZIP_MEMBERS',20000)) throw reject();
   const name=entry.filename,directory=name.endsWith('/');
   const parts=(directory?name.slice(0,-1):name).split('/');
   const mode=(entry.externalFileAttributes>>>16)&0xf000;
   // oxlint-disable-next-line no-control-regex -- reject unsafe ZIP path bytes.
   if(/[\\\x00-\x1f<>:"|?*]/.test(name)||parts.length>limit('ZIP_PATH_DEPTH',32)||
      parts.some((p:string)=>!p||p==='.'||p==='..'||/[ .]$/.test(p)||/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(p))||
      (mode&&mode!==0x8000&&mode!==0x4000)||(mode===0x4000&&!directory)) throw reject();
   for(let i=1;i<=parts.length;i++) {
    const original=parts.slice(0,i).join('/');
    // Conservative Unicode caseless key also rejects compatibility aliases.
    const key=original.normalize('NFKC').toUpperCase().toLowerCase();
    const kind=directory||i<parts.length,previous=paths.get(key);
    if(previous&&(previous.original!==original||previous.directory!==kind||(i===parts.length&&previous.explicit))) throw reject();
    paths.set(key,{original,directory:kind,explicit:!!previous?.explicit||i===parts.length});
   }
   declared+=entry.uncompressedSize;
   if(entry.uncompressedSize>limit('ZIP_MEMBER_BYTES',134217728)||declared>limit('ZIP_BYTES',536870912)||
      entry.uncompressedSize>Math.max(1,entry.compressedSize)*limit('ZIP_RATIO',1000)) throw reject();
   const json=contentRequired&&['h5p.json','content/content.json'].includes(name);
   const svg=!directory&&name.startsWith('content/')&&/\.svg$/i.test(name);
   if(svg){
    if(allowSvgContent===false)throw Object.assign(new Error('Target does not accept SVG content'),{code:'TARGET_INCOMPATIBLE'});
    if(entry.uncompressedSize>svgBytes)throw reject();
   }
   const chunks:Buffer[]=[];let bytes=0,crc=0;
   const stream=await entry.openReadStream();
   for await(const chunk of stream) {
    bytes+=chunk.length;expanded+=chunk.length;
    if(bytes>limit('ZIP_MEMBER_BYTES',134217728)||expanded>limit('ZIP_BYTES',536870912)||(svg&&bytes>svgBytes)||(json&&bytes>limit('JSON_BYTES',16777216))) throw reject();
    crc=crc32(chunk,crc);if(json||svg) chunks.push(chunk);
   }
   if(bytes!==entry.uncompressedSize||(crc>>>0)!==(entry.crc32>>>0)) throw reject();
   if(svg)validateStaticSvg(Buffer.concat(chunks));
   if(json) {
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    if(!value||typeof value!=='object'||Array.isArray(value)) throw reject();
    checkTree(value);roots[name]=value;
   }
  }
  if(contentRequired&&(!roots['content/content.json']||!roots['h5p.json']?.mainLibrary||
     !Array.isArray(roots['h5p.json'].preloadedDependencies)||!roots['h5p.json'].preloadedDependencies.length)) throw reject();
 }catch(error:Native){if(error.code==='TARGET_INCOMPATIBLE')throw error;throw reject();}finally{if(zip) await zip.close();}
}
