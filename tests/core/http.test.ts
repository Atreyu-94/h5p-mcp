import {test,expect,spyOn} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {http,chunks} from '../../src/http/server.js';
import {config,verifier,scopes} from '../../src/http/auth.js';
import {Admission} from '../../src/http/admission.js';
import {Objects} from '../../src/storage/objects.js';

async function fixture() {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-http-test-'));
 const key=await generateKeyPair('ES256'),publicKey={...await exportJWK(key.publicKey),kid:'one',alg:'ES256'};
 const settings=config({resource:'http://127.0.0.1:3000/mcp',issuer:'https://identity.example',jwksFile:path.join(root,'keys.json'),data:path.join(root,'data'),store:path.join(root,'store'),origins:['https://client.example'],immutable:true});
 await fs.writeFile(settings.jwksFile,JSON.stringify({keys:[publicKey]}));
 const logs:unknown[]=[];const app=http(settings,entry=>logs.push(entry));
 const token=(claims:Record<string,unknown>={},header:Record<string,string>={})=>new SignJWT({scope:scopes.join(' '),tenant_id:'school-a',...claims}).setProtectedHeader({alg:'ES256',kid:'one',typ:'at+jwt',...header}).setIssuer(String(claims.iss||settings.issuer)).setAudience(String(claims.aud||settings.resource)).setSubject(String(claims.sub||'teacher-a')).setExpirationTime(claims.exp as number||Math.floor(Date.now()/1000)+300).sign(key.privateKey);
 const request=(pathname:string,access?:string,init:RequestInit={})=>app.fetch(new Request('http://127.0.0.1:3000'+pathname,{...init,headers:{host:'127.0.0.1:3000',...(access?{authorization:'Bearer '+access}:{}),...init.headers}}));
 return {root,settings,app,logs,key,token,request,async close(){await app.close();await fs.rm(root,{recursive:true,force:true});}};
}
test('HTTP bearer per request, issuer/audience/expiry/type, key rotation, Host and Origin',async()=>{
 const f=await fixture();
 try {
  const missing=await f.request('/mcp');expect(missing.status).toBe(401);expect(missing.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
  const metadata=await (await f.request('/.well-known/oauth-protected-resource/mcp')).json();expect(metadata.authorization_servers).toEqual([f.settings.issuer]);
  for(const claims of [{aud:'https://other.example/mcp'},{iss:'https://other.example'},{exp:1},{nbf:Math.floor(Date.now()/1000)+600},{tenant_id:null}])expect((await f.request('/mcp',await f.token(claims))).status).toBe(401);
  expect((await f.request('/mcp',await f.token({}, {typ:'JWT'}))).status).toBe(401);
  const token=await f.token();
  expect((await f.request('/mcp',token,{headers:{origin:'https://attacker.example'}})).status).toBe(403);
  expect((await f.request('/mcp',token,{headers:{host:'attacker.example'}})).status).toBe(403);
  expect((await f.request('/mcp',token,{headers:{host:'127.0.0.1:9999'}})).status).toBe(403);
  expect((await f.request('/mcp',await f.token({scope:'h5p:author'}))).status).toBe(403);
  await fs.writeFile(f.settings.jwksFile,JSON.stringify({keys:[{...await exportJWK((await generateKeyPair('ES256')).publicKey),kid:'two'}]}));
  expect((await f.request('/mcp',token)).status).toBe(401);
  expect(JSON.stringify(f.logs)).not.toContain(token);expect(JSON.stringify(f.logs)).not.toContain('teacher-a');
 }finally{await f.close();}
});
test('HTTP serves small resources inline and points oversized reads to an authenticated download',async()=>{
 const f=await fixture();
 try{
  const token=await f.token(),other=await f.token({sub:'other'}),principal=(await verifier(f.settings).verifyAccessToken(token)).extra.principal;
  const store=new Objects(f.settings.store,principal);await store.initialize();
  try{
   for(const size of [1024,13*1048576]){
    const bytes=Buffer.alloc(size,37);
    const item=await store.publish('artifact',60000,async stage=>{await fs.writeFile(path.join(stage,'payload'),bytes);return {mime:'application/zip'};});
    const uri='h5p-artifact://stored/'+item.id;
    const read=async(access:string)=>{
     const result=await f.request('/mcp',access,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'resources/read',params:{uri}})});
     expect(result.status).toBe(200);const body=await result.text();
     return JSON.parse(body.startsWith('event:')?body.split('\n').find(line=>line.startsWith('data:'))!.slice(5):body);
    };
    if(size===1024){expect((await read(token)).result.contents[0].blob).toBe(bytes.toString('base64'));continue;}
    const get=spyOn(Objects.prototype,'get');
    try{
     expect((await read(token)).result.contents[0]).toEqual({uri,mimeType:'text/uri-list',text:'http://127.0.0.1:3000/artifacts/'+item.id});
     expect((await read(other)).error).toBeDefined();expect(get).not.toHaveBeenCalled();
    }finally{get.mockRestore();}
    const response=await f.request('/artifacts/'+item.id,token);
    expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
   }
  }finally{store.close();}
 }finally{await f.close();}
});
test('remote uploads and downloads enforce scopes, ownership, signatures and path-free tools',async()=>{
 const f=await fixture();
 try {
  const token=await f.token(),read=await f.token({scope:'h5p:read'}),other=await f.token({tenant_id:'school-b'}),owner=await f.token({sub:'teacher-b'});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64');
  const init={method:'POST',headers:{'content-type':'image/png'},body:png};
  expect((await f.request('/uploads/assets',read,init)).status).toBe(403);
  expect((await f.request('/uploads/assets',token,{...init,body:'not PNG'})).status).toBe(400);
  expect((await f.request('/uploads/assets',token,{...init,headers:{'content-type':'image/png','content-length':'67108865'}})).status).toBe(413);
  expect((await f.request('/uploads/assets',token,init)).status).toBe(201);
  const principal=(await verifier(f.settings).verifyAccessToken(token)).extra.principal;
  const store=new Objects(f.settings.store,principal);await store.initialize();
  const artifact=await store.publish('artifact',10000,async(stage)=>{await fs.writeFile(path.join(stage,'payload'),'private bytes');return {mime:'application/zip'};});store.close();
  expect(await (await f.request('/artifacts/'+artifact.id,token)).text()).toBe('private bytes');
  for(const wrong of [other,owner])expect((await f.request('/artifacts/'+artifact.id,wrong)).status).toBe(404);
  const rpc=(body:unknown,t=token)=>f.request('/mcp',t,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(body)});
  expect((await rpc([{jsonrpc:'2.0',id:1,method:'tools/list'}])).status).toBe(400);
  const denied=await rpc({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'prepare_stored_h5p_activity',arguments:{}}},read);expect(denied.status).toBe(403);expect(denied.headers.get('www-authenticate')).toContain('h5p:author');
  const response=await rpc({jsonrpc:'2.0',id:1,method:'tools/list'});expect(response.status).toBe(200);
  const text=await response.text();const result=JSON.parse(text.startsWith('event:')?text.split('\n').find(line=>line.startsWith('data:'))!.slice(5):text);
  expect(result.result.tools.some((t:{name:string})=>t.name==='prepare_stored_h5p_activity')).toBe(true);
  expect(result.result.tools.some((t:{name:string})=>t.name==='install_h5p_library_package')).toBe(false);
  expect(JSON.stringify(result.result.tools)).not.toContain('"path":');
  expect((await f.request('/uploads/assets?url=http://169.254.169.254/',token,init)).status).toBe(400);
 }finally{await f.close();}
});
test('stream cancellation/byte budgets and per-principal admission release capacity',async()=>{
 const controller=new AbortController();let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({pull(){},cancel(){cancelled=true;}});
 const waiting=(async()=>{for await(const _ of chunks(stream,2,controller.signal)){void _;}})();
 controller.abort();await expect(waiting).rejects.toThrow();expect(cancelled).toBe(true);
 const oversized=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(3));c.close();}});
 await expect((async()=>{for await(const _ of chunks(oversized,2,new AbortController().signal)){void _;}})()).rejects.toThrow();
 const queue=new Admission(),principal={tenant:'a',owner:'a'},signal=new AbortController().signal;
 let release!:()=>void;const blocked=new Promise<void>(resolve=>release=resolve);
 const a=queue.run(principal,signal,()=>blocked),b=queue.run(principal,signal,()=>blocked);
 await expect(queue.run(principal,signal,async()=>{})).rejects.toThrow();release();await Promise.all([a,b]);
 expect(queue.pool.running).toBe(0);expect(queue.pool.queued).toBe(0);
 await queue.run(principal,signal,async()=>{});
});
test('HTTP cancellation releases a waiting engine and does not remove another lock',async()=>{
 const f=await fixture();
 try {
  const access=await f.token(),principal=(await verifier(f.settings).verifyAccessToken(access)).extra.principal;
  const lock=path.join(f.settings.data,principal.tenant,'.core-lock');await fs.mkdir(lock,{recursive:true});
  const controller=new AbortController();
  const pending=f.request('/mcp',access,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'search_h5p_types',arguments:{}}})});
  await new Promise(resolve=>setTimeout(resolve,50));controller.abort();
  expect((await pending).status).toBe(408);expect(f.app.admission.pool.running).toBe(0);expect((await fs.stat(lock)).isDirectory()).toBe(true);
 }finally{await f.close();}
});
