import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {storageProbe} from './storage-probe.mjs';
import {checkPublishedSkill} from './skill-probe.mjs';
const [bun,entry,libraries]=process.argv.slice(2);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-f4-'));
const env={...process.env,PATH:path.dirname(bun),H5P_MCP_DATA_DIR:path.join(root,'data'),H5P_MCP_EXPORT_DIR:path.join(root,'exports'),H5P_MCP_ADMIN_SCOPES:'',H5P_MCP_ASSET_ROOTS:JSON.stringify([root])};
delete env.H5P_MCP_LUMI_RUNTIME;
if(libraries) await fs.cp(libraries,path.join(root,'data/libraries'),{recursive:true});
for(const modern of [false,true]) {
 const client=new Client({name:'f4-probe',version:'1'},modern?{versionNegotiation:{mode:'auto'}}:{});
 const args=entry.endsWith('.tgz')?['x','--bun','--package',entry,'h5p-mcp','stdio']:[entry,'stdio'];
 // A 16 MiB raw resource needs more than the SDK's default 10 MiB after base64.
 const transport=new StdioClientTransport({command:bun,args,cwd:root,env,stderr:'pipe',maxBufferSize:33554432});
 let errors='';transport.stderr?.on('data',chunk=>errors+=chunk);
 try {
  console.log(JSON.stringify({stage:'connect',modern,entry}));
  await client.connect(transport);
  console.log(JSON.stringify({stage:'discovery',modern}));
  const tools=(await client.listTools()).tools;
  assert(tools.some(t=>t.name==='prepare_h5p_activity'));
  assert(!tools.some(t=>t.name==='install_h5p_library'));
  await checkPublishedSkill(client,modern);
  await assert.rejects(client.readResource({uri:'file:///etc/passwd'}));
  const invalid=await client.callTool({name:'prepare_h5p_activity',arguments:{}});
  assert.equal(invalid.isError,false);
  assert.equal(invalid.structuredContent.ok,false);
  const denied=await client.callTool({name:'refresh_h5p_catalog',arguments:{}});
  assert.equal(denied.isError,true);
  assert.equal(denied.structuredContent.diagnostics[0].code,'PERMISSION_DENIED');
  console.log(JSON.stringify({stage:'catalog',modern}));
  const found=await client.callTool({name:'search_h5p_types',arguments:{installed_only:true}});
  assert(Array.isArray(found.structuredContent.activities),JSON.stringify(found));
  if(libraries&&modern) {
   for(const type of ['true-false','multiple-choice','accordion','question-set']) {
    const example=JSON.parse((await client.readResource({uri:'skill://h5p-authoring/examples/'+type+'.json'})).contents[0].text);
    const prepared=await client.callTool({name:'prepare_h5p_activity',arguments:example});
    assert.equal(prepared.structuredContent.ok,true,JSON.stringify(prepared));
    const exported=await client.callTool({name:'export_h5p_activity',arguments:{activity:prepared.structuredContent.activity,output_name:type}});
    assert.equal(exported.structuredContent.ok,true,JSON.stringify(exported));
    const artifact=exported.structuredContent.artifact;
    const bytes=Buffer.from((await client.readResource({uri:artifact.uri})).contents[0].blob,'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
    const checked=await client.callTool({name:'validate_h5p_package',arguments:{path:path.join(root,'exports',type+'.h5p')}});
    assert.equal(checked.structuredContent.ok,true,JSON.stringify(checked));
    if(type==='true-false'&&!entry.endsWith('.tgz')) {
     const input=path.join(root,'cli-input.json');await fs.writeFile(input,JSON.stringify(example));
     const cli=(args)=>spawnSync(bun,[entry,...args],{cwd:root,env,encoding:'utf8',timeout:30000});
     const exportedCLI=cli(['export',input,'cli-proof']);assert.equal(exportedCLI.status,0,exportedCLI.stdout+exportedCLI.stderr);
     const validatedCLI=cli(['validate',path.join(root,'exports/cli-proof.h5p')]);assert.equal(validatedCLI.status,0,validatedCLI.stdout+validatedCLI.stderr);
     const admin=cli(['admin','refresh']);assert.equal(admin.status,1);assert.equal(JSON.parse(admin.stdout).diagnostics[0].code,'PERMISSION_DENIED');
     assert((await fs.readFile(entry,'utf8')).startsWith('#!/usr/bin/env bun'));
    }
    console.log(type+': prepare/export/import passed');
   }
  }
  if(modern&&libraries) {
   await storageProbe(client,root,async(scopes)=>{
    const reopened=new Client({name:'f5-restart',version:'1'},{versionNegotiation:{mode:'auto'}});
    await reopened.connect(new StdioClientTransport({command:bun,args,cwd:root,env:{...env,H5P_MCP_ADMIN_SCOPES:scopes},stderr:'pipe',maxBufferSize:33554432}));
    return reopened;
   });
  } else if(modern) {
   await fs.mkdir(path.join(root,'data/.core-lock'));
   const pending=client.callTool({name:'search_h5p_types',arguments:{}}).then(()=>false,()=>true);
   await new Promise(resolve=>setTimeout(resolve,30));await client.close();assert(await pending);
   await fs.rmdir(path.join(root,'data/.core-lock'));
  }
  console.log(JSON.stringify({modern,tools:tools.length,skills:'passed',shutdown:'passed',errors}));
 } catch(error){console.error(errors);throw error;} finally {await client.close();}
}
console.log(JSON.stringify({status:'passed',root,entry,runtime:bun,childPATH:env.PATH,conformance:'official HTTP CLI not applicable to stdio'}));
