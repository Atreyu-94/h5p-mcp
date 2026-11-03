import {Server,ProtocolError} from '@modelcontextprotocol/server';
import type {Service} from './service.js';
import {aliases} from './service.js';
import {extensionID} from './resources.js';
import {limit} from '../domain/limits.js';
import type {Native} from '../domain/types.js';
const params={'~standard':{version:1 as const,vendor:'h5p',validate(value:unknown){return value&&typeof value==='object'?{value}:{issues:[{message:'Expected object'}]};}}};
/** Shared registration; transport lifetime and principal are supplied by the host. */
export function mcp(service:Service,shutdown:AbortSignal,pending:Set<Promise<unknown>>) {
 const server=new Server({name:'h5p-mcp',title:'H5P MCP',version:'0.1.0'},{capabilities:{tools:{},resources:{},extensions:{[extensionID]:{}}}});
 server.setRequestHandler('tools/list',async request=>{
  if(request.params?.cursor!==undefined)throw new ProtocolError(-32602,'Unknown tools cursor');
  return {tools:service.tools(),ttlMs:60000,cacheScope:'private' as const};
 });
 server.setRequestHandler('tools/call',async(request,ctx)=>{
  if(!Object.hasOwn(service.definitions,request.params.name)&&!Object.hasOwn(aliases,request.params.name))throw new ProtocolError(-32602,'Unknown tool');
  const signal=AbortSignal.any([ctx.mcpReq.signal,shutdown,AbortSignal.timeout(limit('SECONDS',300)*1000)]);
  const job=service.call(request.params.name,request.params.arguments||{},signal);pending.add(job);
  try{return await job;}finally{pending.delete(job);}
 });
 server.setRequestHandler('resources/list',async request=>{
  if(request.params?.cursor!==undefined)throw new ProtocolError(-32602,'Unknown resources cursor');
  return {resources:[...service.resources.texts.values()].map(({uri,name,mimeType})=>({uri,name,mimeType}))};
 });
 server.setRequestHandler('resources/read',async request=>{
  try{
   const uri=request.params.uri,result=await service.readResource(uri);
   const packaged=uri.startsWith('skill://')||uri.startsWith('h5p-authoring://v1/')||['h5p-contract://v1/schema','h5p-contract://v1/codes','h5p-contract://v1/storage'].includes(uri);
   return packaged ? {...result,ttlMs:300000,cacheScope:'public'} : result;
  }catch{throw new ProtocolError(-32602,'Unknown or unavailable resource');}
 });
 const complete=(payload:Native)=>({resultType:'complete',ttlMs:300000,cacheScope:'public',...payload});
 server.setRequestHandler('skills/list',{params},async(value:Native)=>{
  if(value.cursor!==undefined||Object.keys(value).some(k=>!['cursor','_meta'].includes(k)))throw new ProtocolError(-32602,'Unknown skills cursor or parameter');
  return complete({skills:service.resources.skills});
 });
 server.setRequestHandler('skills/get',{params},async(value:Native)=>{
  const skill=service.resources.skills.find(item=>item.uri===value.uri);
  if(!skill||Object.keys(value).some(k=>!['uri','_meta'].includes(k)))throw new ProtocolError(-32602,'Unknown skill URI or parameter');
  return complete({skill});
 });
 return server;
}
