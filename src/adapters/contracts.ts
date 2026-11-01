import fs from 'node:fs';
import path from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import {repositoryRoot} from '../infrastructure/runtime.js';
import type {Native} from '../domain/types.js';
const read=(name:string)=>JSON.parse(fs.readFileSync(path.join(repositoryRoot,'h5p_mcp/contracts',name),'utf8'));
export const base=read('v1.json'), operations=read('operations-v1.json'), codes=read('codes-v1.json');
export const examples=read('examples-v1.json');
export const storage=read('storage-v1.json');
const defs={...base.$defs,...operations.$defs,...storage.$defs};
export function schema(name:string):Native {
 const expand=(value:Native):Native=>Array.isArray(value)?value.map(expand):
  value&&typeof value==='object'?value.$ref?expand(defs[value.$ref.split('/').pop()]):
  Object.fromEntries(Object.entries(value).map(([k,v])=>[k,expand(v)])):value;
 return {$schema:base.$schema,...expand(defs[name])};
}
const ajv=new Ajv2020({strict:false,allErrors:false});
export const validators=new Map<string,ReturnType<typeof ajv.compile>>();
export function valid(name:string,value:unknown) {
 if(!validators.has(name)) validators.set(name,ajv.compile(schema(name)));
 return validators.get(name)!(value);
}
export function invalidInput(name:string) {
 const error=validators.get(name)?.errors?.[0];
 const child=error?.params.missingProperty||error?.params.additionalProperty;
 const pointer=(error?.instancePath||'')+(child?'/'+String(child).replaceAll('~','~0').replaceAll('/','~1'):'');
 return Object.assign(failure('SCHEMA_VALIDATION_FAILED'),{pointer});
}
export const verification=(updates:Native={})=>({structure:'not_run',semantics:'not_run',importation:'not_run',playback:'not_run',grading:'not_run',...updates});
export function diagnostic(error:Native) {
 const code=codes.aliases[error?.code]||error?.code;
 const key=Object.hasOwn(codes.codes,code)?code:'INTERNAL_ERROR';
 const [retryable,message,suggested_fix]=codes.codes[key];
 const pointer=typeof error?.pointer==='string'&&/^(?:\/(?:[^~/]|~[01])*)*$/.test(error.pointer)?error.pointer.slice(0,4096):'';
 const expected=key==='TARGET_INCOMPATIBLE'?String(Array.isArray(error.targetMissing)?error.targetMissing.filter((v:unknown)=>typeof v==='string'&&/^H5P\.[A-Za-z0-9 .()_-]+$/.test(v)).join(', '):error.expected||'').slice(0,256)||null:null;
 return {code:key,pointer,message,expected,actual:null,retryable,suggested_fix};
}
export const failure=(code:string)=>Object.assign(new Error(code),{code});
export function report(kind:string,ok:boolean,errors:Native[]=[],checks:Native={}) {
 return {contract_version:'1',ok,kind,diagnostics:errors.slice(0,100).map(diagnostic),diagnostics_truncated:errors.length>100,verification:verification(checks)};
}
