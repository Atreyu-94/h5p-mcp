import {scanNotation} from './notation.js';
import {createHash} from 'node:crypto';
import type {Native} from './types.js';
export const canonical=(value:Native):Native=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const semanticHash=(value:Native)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function stableId(project:string,...ids:string[]) {
 const bytes=createHash('sha256').update(JSON.stringify(['h5p-authoring-v1',project,...ids])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const escapeHtml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
/** Deliberately small Markdown grammar: paragraphs, line breaks, emphasis and code. */
export function renderText(text:{format:'plain'|'markdown';value:string}) {
 if(text.format==='plain')return '<p>'+escapeHtml(text.value).replaceAll('\n','<br />')+'</p>';
 const tokens:string[]=[];
 if(text.value.includes('\uE000'))throw new Error('Unsupported Markdown marker');
 let value='',cursor=0;
 const math=scanNotation(text.value,'markdown',(start,end,code)=>{
  value+=text.value.slice(cursor,start)+'\uE000'+tokens.length+'\uE000';
  tokens.push(code?'<code>'+escapeHtml(text.value.slice(start+1,end-1))+'</code>':escapeHtml(text.value.slice(start,end)));
  cursor=end;
 });
 if(math.invalid)throw Object.assign(new Error('Invalid math delimiter'),{mathMode:math.invalid});
 value+=text.value.slice(cursor);
 if(value.includes('\\')||/[<>[\]#]|^[^\S\r\n\u2028\u2029]*(?:[-+*>]|\d+\.)\s|\t/m.test(value))throw new Error('Unsupported Markdown; use plain text or paragraphs/emphasis/code');
 value=escapeHtml(value).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
 if(/[*`_]/.test(value))throw new Error('Unsupported or unmatched Markdown delimiter');
 return value.split(/\n\s*\n/).map(p=>'<p>'+p.replaceAll('\n','<br />')+'</p>').join('').replace(/\uE000(\d+)\uE000/g,(_all,index)=>tokens[Number(index)]);
}