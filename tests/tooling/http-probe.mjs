import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const [entry,libraries]=process.argv.slice(2),core=path.dirname(entry);
const {http}=await import(pathToFileURL(path.join(core,'http/server.js')).href);
const {verifier}=await import(pathToFileURL(path.join(core,'http/auth.js')).href);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-http-probe-'));
const key=await generateKeyPair('ES256');
const logs=[];let app;
const listener=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>app.fetch(request)});
const settings={resource:`http://127.0.0.1:${listener.port}/mcp`,issuer:'https://identity.example',jwksFile:path.join(root,'keys.json'),data:path.join(root,'data'),store:path.join(root,'objects'),origins:[],immutable:false,tenantClaim:'tenant_id',port:listener.port};
await fs.writeFile(settings.jwksFile,JSON.stringify({keys:[{...await exportJWK(key.publicKey),kid:'test-key'}]}));
const sign=(tenant='a',scope='h5p:read h5p:author h5p:export h5p:validate h5p:admin:libraries')=>new SignJWT({tenant_id:tenant,scope}).setProtectedHeader({alg:'ES256',kid:'test-key',typ:'at+jwt'}).setIssuer(settings.issuer).setAudience(settings.resource).setSubject('teacher').setExpirationTime('10m').sign(key.privateKey);
const access=await sign(),identity=await verifier(settings).verifyAccessToken(access);
await fs.cp(libraries,path.join(settings.data,identity.extra.principal.tenant,'libraries'),{recursive:true});
app=http(settings,entry=>logs.push(entry));
const connect=async(token,modern=true)=>{
 const client=new Client({name:'f6-probe',version:'1'},modern?{versionNegotiation:{mode:'auto'}}:{});
 await client.connect(new StreamableHTTPClientTransport(new URL(settings.resource),{requestInit:{headers:{authorization:'Bearer '+token}}}));return client;
};
const call=async(client,name,args)=>{const result=(await client.callTool({name,arguments:args})).structuredContent;assert.notEqual(result.ok,false,JSON.stringify(result));return result;};
let client,proxy;
try {
 for(const modern of [false,true]) {
  client=await connect(access,modern);
  const tools=(await client.listTools()).tools;
  assert(!JSON.stringify(tools).includes('"path":'));assert(!tools.some(t=>t.name==='install_h5p_library'));
  assert((await client.readResource({uri:'skill://h5p-authoring/SKILL.md'})).contents.length);
  await client.close();
 }
 client=await connect(access);
 const contract=await call(client,'get_h5p_type_contract',{machine_name:'H5P.TrueFalse',major_version:1,minor_version:8});
 assert((await client.readResource({uri:contract.raw_schema.uri})).contents[0].text.includes('semantics'));
 const prepared=await call(client,'prepare_stored_h5p_activity',{activity:{title:'HTTP math',library:'H5P.TrueFalse 1.8',params:{question:'<p>\\(1+1=2\\)</p>',correct:'true'}}});
 const source=JSON.parse((await client.readResource({uri:'h5p-authoring://v1/examples'})).contents[0].text)[0];
 const pins=JSON.parse((await client.readResource({uri:'h5p-authoring://v1/adapters'})).contents[0].text);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64');
 const assetResponse=await fetch(settings.resource.replace('/mcp','/uploads/assets'),{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'image/png'},body:png});
 assert.equal(assetResponse.status,201);const asset=await assetResponse.json();
 source.assets={picture:asset.object_id};
 source.image={id:'picture',asset:'picture',mime:'image/png',alt:'A square',library:{name:'H5P.Image 1.1',...pins['H5P.Image 1.1']},copyright:{author:'Teacher',license:'CC BY'}};
 const sourcePrepared=await call(client,'prepare_stored_h5p_source',{source});
 const sourceArtifact=await call(client,'export_prepared_h5p_activity',{preparation_id:sourcePrepared.object_id,idempotency_key:'http-source'});
 const remoteDownload=await fetch(settings.resource.replace('/mcp','/artifacts/'+sourceArtifact.object_id),{headers:{authorization:'Bearer '+access}});
 assert.equal(remoteDownload.status,200);
 const remoteFile=path.join(root,'remote-source.h5p');await fs.writeFile(remoteFile,Buffer.from(await remoteDownload.arrayBuffer()));
 const imageFile=path.join(root,'picture.png');await fs.writeFile(imageFile,png);
 const inputFile=path.join(root,'source.json');await fs.writeFile(inputFile,JSON.stringify({...source,assets:{picture:imageFile}}));
 const env={...process.env,H5P_MCP_DATA_DIR:path.join(settings.data,identity.extra.principal.tenant),H5P_MCP_EXPORT_DIR:root,H5P_MCP_ASSET_ROOTS:JSON.stringify([root])};
 const compiled=spawnSync(process.execPath,[entry,'compile',inputFile],{env,encoding:'utf8',timeout:60000});
 assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
 const activityFile=path.join(root,'activity.json');await fs.writeFile(activityFile,JSON.stringify(JSON.parse(compiled.stdout).activity));
 const exported=spawnSync(process.execPath,[entry,'export',activityFile,'cli-source'],{env,encoding:'utf8',timeout:60000});
 assert.equal(exported.status,0,exported.stdout+exported.stderr);
 const inventory=async filename=>{
  const zip=await createRequire(entry)('yauzl-promise').open(filename),files={};
  try{for await(const member of zip){const hash=createHash('sha256');for await(const bytes of await member.openReadStream())hash.update(bytes);files[member.filename]=hash.digest('hex');}}finally{await zip.close();}
  return files;
 };
 assert.deepEqual(await inventory(remoteFile),await inventory(path.join(root,'cli-source.h5p')));
 const rejected=(await client.callTool({name:'prepare_stored_h5p_source',arguments:{source:{...source,assets:{bad:'C:/private.png'}}}})).structuredContent;
 assert.equal(rejected.ok,false);assert(!JSON.stringify(rejected).includes('C:/private'));
 const readonly=await connect(await sign('a','h5p:read'));
 try{assert(!(await readonly.listTools()).tools.some(t=>t.name==='prepare_stored_h5p_source'));await assert.rejects(readonly.callTool({name:'prepare_stored_h5p_source',arguments:{source}}));}finally{await readonly.close();}
 const input={preparation_id:prepared.object_id,idempotency_key:'http-example'};
 const artifact=await call(client,'export_prepared_h5p_activity',input);
 const downloaded=await fetch(settings.resource.replace('/mcp','/artifacts/'+artifact.object_id),{headers:{authorization:'Bearer '+access}});
 assert.equal(downloaded.status,200);const bytes=await downloaded.arrayBuffer();assert.equal(bytes.byteLength,artifact.size);
 const uploaded=await fetch(settings.resource.replace('/mcp','/uploads/packages'),{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/zip'},body:bytes});
 assert.equal(uploaded.status,201);const pkg=await uploaded.json();
 assert.equal((await call(client,'validate_stored_h5p_package',{object_id:pkg.object_id})).ok,true);
 // Installing from owned package ID never downloads a URL or accepts a server path.
 assert(Object.keys((await call(client,'install_h5p_library_package',{object_id:pkg.object_id})).libraries).length);
 const foreign=await connect(await sign('b'));
 try{await assert.rejects(foreign.readResource({uri:artifact.uri}));}finally{await foreign.close();}
 await client.close();await app.close();app=http(settings,entry=>logs.push(entry));
 client=await connect(access);assert.equal((await call(client,'export_prepared_h5p_activity',input)).object_id,artifact.object_id);await client.close();
 assert(!JSON.stringify(logs).includes(access));assert(!JSON.stringify(logs).includes('HTTP math'));
 // The pinned CLI has no bearer-header option. This loopback-only harness injects
 // the test token; OAuth itself is tested directly, never disabled in production.
 proxy=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>{
  const headers=new Headers(request.headers);headers.set('authorization','Bearer '+access);headers.set('host',new URL(settings.resource).host);
  return app.fetch(new Request(settings.resource,{method:request.method,headers,body:request.body,duplex:'half',signal:request.signal}));
 }});
 const cli=path.join(import.meta.dirname,'node_modules/@modelcontextprotocol/conformance/dist/index.js');
 for(const scenario of ['server-initialize','ping','tools-list','resources-list']) {
  await new Promise((resolve,reject)=>{
   const child=spawn('node',[cli,'server','--url',`http://127.0.0.1:${proxy.port}/mcp`,'--scenario',scenario,'--output-dir',path.join(root,'conformance')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let output='';const timeout=setTimeout(()=>child.kill(),60000);
   for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(output.length<1048576)output+=chunk;});
   child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(new Error(scenario+': '+output.slice(-5000)));});
  });
  console.log('HTTP conformance 0.1.16: '+scenario+' passed');
 }
 console.log(JSON.stringify({status:'passed',root,checks:'SDK modern/legacy, scopes, export/import, tenant isolation, restart, offline package administration; conformance legacy subset',tasks:'not advertised'}));
}finally{await client?.close();await app?.close();await proxy?.stop(true);await listener.stop(true);}
