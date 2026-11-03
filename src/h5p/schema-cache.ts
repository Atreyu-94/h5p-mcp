import {createHash} from 'node:crypto';
import {checkTree,limit} from '../domain/limits.js';
import type {Native} from '../domain/types.js';
export class SemanticsCache {
 private entries=new Map<string,{fields:Native[];bytes:number}>();
 private bytes=0;
 constructor(private maximum=16,private maxBytes=2097152,private totalBytes=16777216) {}
 get(generation: string,fields: Native[],compiler='native-v1'): Native[] {
  checkTree(fields);
  const raw=JSON.stringify(fields),bytes=Buffer.byteLength(raw);
  if(bytes>this.maxBytes) throw Object.assign(new Error('Schema budget exceeded'),{code:'INPUT_TOO_LARGE'});
  const key=JSON.stringify([generation,compiler,createHash('sha256').update(raw).digest('hex')]);
  const hit=this.entries.get(key);
  if(hit) {this.entries.delete(key);this.entries.set(key,hit);return hit.fields;}
  const compiled=structuredClone(fields);
  // Discovery reads every schema. Compile a text rule only when validating that field.
  const freeze=(value: Native):void=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};
  freeze(compiled);
  if(bytes>this.totalBytes) throw new Error('Schema cache byte budget exceeded');
  while(this.entries.size>=this.maximum||this.bytes+bytes>this.totalBytes) {
   const oldest=this.entries.keys().next().value!;
   this.bytes-=this.entries.get(oldest)!.bytes;this.entries.delete(oldest);
  }
  this.entries.set(key,{fields:compiled,bytes});this.bytes+=bytes;
  return compiled;
 }
 clear(){this.entries.clear();this.bytes=0;}
 get size(){return this.entries.size;}
}
export const semanticsCache=new SemanticsCache(limit('SCHEMA_CACHE_ENTRIES',16));
