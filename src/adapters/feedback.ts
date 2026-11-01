import type {Native} from '../domain/types.js';
/** Public, bounded author feedback. Never forwards backend messages or filesystem paths. */
export function feedback(value:Native={}) {
 const transformations=(Array.isArray(value.transformations)?value.transformations:[]);
 const warnings=(Array.isArray(value.warnings)?value.warnings:[]).filter((v:unknown)=>typeof v==='string'&& /^(Native field checks|LaTeX requires|Remote media require|Translation unavailable)/.test(v as string));
 return {report_version:'2',warnings:warnings.slice(0,20).map((v:string)=>v.slice(0,512)),warnings_truncated:warnings.length>20,
  mathematics:{detected:value.mathematics?.detected===true,...(typeof value.mathematics?.installed==='boolean'?{installed:value.mathematics.installed}:{}),...(value.mathematics?.detected?{library:'H5P.MathDisplay 1.0'}:{})},
  transformations:transformations.slice(0,100).map((item:Native)=>({pointer:typeof item.pointer==='string'?item.pointer.slice(0,4096):'',before:String(item.before??'').slice(0,2048),after:String(item.after??'').slice(0,2048),truncated:item.truncated===true||String(item.before??'').length>2048||String(item.after??'').length>2048})),transformations_truncated:transformations.length>100};
}
