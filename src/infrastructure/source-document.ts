import {parseDocument,LineCounter,isMap,isSeq,isScalar,isAlias} from 'yaml';
import {checkTree} from '../domain/limits.js';
import type {Native} from '../domain/types.js';
export interface SourceLocation {line:number;column:number}
/** A single JSON-compatible YAML document, without tags, anchors, aliases or merges. */
export function parseSource(input:string,format:'json'|'yaml') {
 const lines=new LineCounter(),locations:Record<string,SourceLocation>={};
 const fail=(offset=0):never=>{const pos=lines.linePos(offset);throw Object.assign(new Error('Invalid source document'),{code:'SCHEMA_VALIDATION_FAILED',source_locations:{'':{line:pos.line||1,column:pos.col||1}}});};
 if(Buffer.byteLength(input)>16777216)throw Object.assign(new Error('Source exceeds byte budget'),{code:'INPUT_TOO_LARGE'});
 if(format==='json'){try{JSON.parse(input);}catch{fail();}}
 const doc=parseDocument(input,{lineCounter:lines,uniqueKeys:true,strict:true,prettyErrors:false,version:'1.2',schema:'core',merge:false});
 if(doc.errors.length||doc.warnings.length)fail((doc.errors[0]??doc.warnings[0]).pos[0]);
 if(doc.directives.yaml.explicit||Object.keys(doc.directives.tags).some(key=>key!=='!!'))fail();
 let count=0;
 const walk=(node:Native,pointer:string,depth:number):void=>{
  if(++count>100000||depth>64)fail(node?.range?.[0]);
  const pos=lines.linePos(node?.range?.[0]??0);locations[pointer]={line:pos.line,column:pos.col};
  if(node===null)return;
  if(isAlias(node)||node.anchor||node.tag)fail(node.range?.[0]);
  if(isMap(node))for(const pair of node.items){
   const key=pair.key as Native;
   if(!isScalar(key)||typeof key.value!=='string'||key.value==='<<'||key.anchor||key.tag)fail(key?.range?.[0]);
   walk(pair.value,pointer+'/'+key.value.replaceAll('~','~0').replaceAll('/','~1'),depth+1);
  }
  else if(isSeq(node))node.items.forEach((value,index)=>walk(value,pointer+'/'+index,depth+1));
  else if(isScalar(node)){
   if(typeof node.value==='number'&&(!Number.isFinite(node.value)||!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(node.source||'')))fail(node.range?.[0]);
  }else fail();
 };
 walk(doc.contents,'',0);
 const source=doc.toJS({maxAliasCount:0});checkTree(source);
 return {source,locations};
}
