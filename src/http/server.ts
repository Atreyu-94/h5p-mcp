import {Hono} from 'hono';
import {hostHeaderValidation} from '@modelcontextprotocol/hono';
import {createMcpHandler,requireBearerAuth,bearerAuthChallengeResponse,OAuthError,OAuthErrorCode,getOAuthProtectedResourceMetadataUrl} from '@modelcontextprotocol/server';
import {randomUUID} from 'node:crypto';
import {mcp} from '../adapters/mcp.js';
import {checkTree} from '../domain/limits.js';
import {Pool} from '../infrastructure/pool.js';
import {Remote,requirements,rpcRequestBytes,rpcResponseBytes} from './service.js';
import {Admission,Busy} from './admission.js';
import {config,verifier,scopes,type HttpConfig,type Identity} from './auth.js';
import type {Native} from '../domain/types.js';

export class BodyLimit extends Error {}
export async function* chunks(body:ReadableStream<Uint8Array>|null,max:number,signal:AbortSignal,onBytes=(size:number)=>{void size;}) {
 if(!body)return;
 const reader=body.getReader();let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  while(true){signal.throwIfAborted();const item=await reader.read();signal.throwIfAborted();if(item.done)break;size+=item.value.length;onBytes(item.value.length);if(size>max)throw new BodyLimit();yield item.value;}
 }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function bytes(body:ReadableStream<Uint8Array>|null,max:number,signal:AbortSignal,onBytes?:(size:number)=>void){const data=[];for await(const chunk of chunks(body,max,signal,onBytes))data.push(chunk);return Buffer.concat(data);}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
/** Fetch handler is testable without exposing a listener. CLI binds loopback only. */
export function http(input:HttpConfig,log:(entry:Native)=>void=entry=>console.error(JSON.stringify(entry))) {
 const settings=config(input),resource=new URL(settings.resource),metadata=getOAuthProtectedResourceMetadataUrl(resource);
 const verify=verifier(settings),auth=requireBearerAuth({verifier:verify,requiredScopes:['h5p:read'],resourceMetadataUrl:metadata});
 const admission=new Admission(),authPool=new Pool(8,0),shutdown=new AbortController(),pending=new Set<Promise<unknown>>();
 const app=new Hono();app.use('*',hostHeaderValidation([resource.hostname]));
 const metrics={requests:0,errors:0,cancelled:0,bytes:0};
 app.all('*',async c=>{
  const request=c.req.raw,url=new URL(request.url),origin=request.headers.get('origin');
  if(request.headers.get('host')!==resource.host||url.host!==resource.host||origin!==null&&!settings.origins.includes(origin))return json({error:'untrusted_origin_or_host'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin||resource.origin,'access-control-allow-methods':'GET, POST, DELETE, OPTIONS','access-control-allow-headers':'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id','access-control-max-age':'600','vary':'Origin'}});
  if(url.pathname===new URL(metadata).pathname){if(request.method!=='GET')return json({error:'method_not_allowed'},405);return json({resource:settings.resource,authorization_servers:[settings.issuer],scopes_supported:scopes,bearer_methods_supported:['header']});}
  if(url.search)return json({error:'query_not_supported'},400);
  if(!['/mcp','/uploads/assets','/uploads/packages'].includes(url.pathname)&&!/^\/artifacts\/[a-f0-9]{32}$/.test(url.pathname))return json({error:'not_found'},404);
  const started=performance.now(),id=randomUUID();let received=0,status=500,principal:string|undefined;
  metrics.requests++;
  try {
   const checked=await authPool.run(()=>auth(request),request.signal);
   if(checked instanceof Response){status=checked.status;return checked;}
   const identity=checked as Identity;principal=identity.extra.principal.tenant.slice(0,16);
   const deadline=Math.max(1,Math.min(300000,identity.expiresAt!*1000-Date.now()));
   const signal=AbortSignal.any([request.signal,shutdown.signal,AbortSignal.timeout(deadline)]);
   const response=await admission.run(identity.extra.principal,signal,async()=>{
    const service=new Remote(identity,settings);const jobs=new Set<Promise<unknown>>();
    let handler:ReturnType<typeof createMcpHandler>|undefined;
    try {
     await service.initialize();
     if(request.headers.has('content-encoding'))return json({error:'encoded_body_not_supported'},415);
     if(url.pathname==='/mcp') {
      if(!['POST','GET','DELETE'].includes(request.method))return json({error:'method_not_allowed'},405);
      let parsedBody:Native;
      if(request.method==='POST') {
       if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return json({error:'unsupported_media_type'},415);
       const data=await bytes(request.body,rpcRequestBytes,signal,n=>received+=n);
       try{parsedBody=JSON.parse(data.toString('utf8'));checkTree(parsedBody);}catch{return json({error:'invalid_json'},400);}
       // One bounded operation, no hidden batches or unnegotiated asynchronous tasks.
       if(Array.isArray(parsedBody)||!parsedBody||typeof parsedBody!=='object')return json({error:'invalid_request'},400);
       if(parsedBody.method==='tools/call') {
        const name=parsedBody.params?.name;
        if(typeof name==='string'&&Object.hasOwn(requirements,name)&&!identity.scopes.includes(requirements[name]))return bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InsufficientScope,'Required operation scope missing'),{requiredScopes:['h5p:read',requirements[name]],resourceMetadataUrl:metadata});
       }
      }
      handler=createMcpHandler(()=>mcp(service,signal,jobs),{legacy:'stateless',responseMode:'auto',maxSubscriptions:0,onerror:()=>{}});
      const result=await handler.fetch(request,{authInfo:identity,parsedBody});
      // Drain the bounded legacy SSE result too, before closing request-owned resources.
      try{
       const payload=result.body?await bytes(result.body,rpcResponseBytes,signal):null;
       return new Response(payload,{status:result.status,headers:result.headers});
      }catch(error){if(error instanceof BodyLimit)return json({error:'response_too_large'},500);throw error;}
     }
     if(url.pathname.startsWith('/uploads/')) {
      if(request.method!=='POST')return json({error:'method_not_allowed'},405);
      const asset=url.pathname.endsWith('/assets');
      service.require(asset?'h5p:author':'h5p:validate');
      const maximum=asset?67108864:134217728;
      const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maximum))throw new BodyLimit();
      return json(await service.upload(asset?'asset':'package',request.headers.get('content-type')?.split(';')[0]||'',chunks(request.body,maximum,signal,n=>received+=n),signal),201);
     }
     if(request.method!=='GET')return json({error:'method_not_allowed'},405);
     const value=await service.download(url.pathname.split('/').pop()!);signal.throwIfAborted();
     return new Response(Uint8Array.from(value.bytes),{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="activity.h5p"','etag':'"'+value.sha256+'"','cache-control':'no-store'}});
    }finally{await handler?.close();await Promise.allSettled(jobs);await service.close();}
   });
   status=response.status;return response;
  } catch(error:Native) {
   if(error instanceof Busy||error.code==='LIMIT_EXCEEDED'){status=429;return new Response(null,{status,headers:{'retry-after':'60'}});}
   if(error instanceof BodyLimit){status=413;return json({error:'body_too_large'},status);}
   if(error.code==='PERMISSION_DENIED'){status=403;return json({error:'insufficient_scope'},status);}
   if(['OBJECT_NOT_FOUND','OBJECT_EXPIRED','OBJECT_INTEGRITY_FAILED'].includes(error.code)){status=404;return json({error:'object_unavailable'},status);}
   if(['MIME_MISMATCH','UNSAFE_ARCHIVE','SCHEMA_VALIDATION_FAILED'].includes(error.code)){status=400;return json({error:'invalid_upload'},status);}
   if(request.signal.aborted||shutdown.signal.aborted||['AbortError','TimeoutError'].includes(error.name)||error.code==='BACKEND_TIMEOUT'){metrics.cancelled++;status=408;return json({error:'cancelled_or_expired'},status);}
   status=500;return json({error:'operation_failed'},status);
  } finally {
   metrics.bytes+=received;if(status>=400)metrics.errors++;
   log({operation:id,tenant:principal||null,route:url.pathname==='/mcp'?'mcp':url.pathname.startsWith('/uploads/')?'upload':'download',status,duration_ms:Math.round(performance.now()-started),bytes:received,running:admission.pool.running,queued:admission.pool.queued,rss:process.memoryUsage().rss});
  }
 });
 const fetch=async(request:Request)=>{
  const job=Promise.resolve(app.fetch(request));pending.add(job);
  try {
   const response=await job;
   response.headers.set('cache-control','no-store');response.headers.set('x-content-type-options','nosniff');
   const origin=request.headers.get('origin');if(origin&&settings.origins.includes(origin)){response.headers.set('access-control-allow-origin',origin);response.headers.set('access-control-expose-headers','WWW-Authenticate, MCP-Protocol-Version, MCP-Session-Id, ETag');response.headers.set('vary','Origin');}
   return response;
  }finally{pending.delete(job);}
 };
 return {fetch,metrics,admission,async close(){shutdown.abort();await Promise.allSettled(pending);}};
}
