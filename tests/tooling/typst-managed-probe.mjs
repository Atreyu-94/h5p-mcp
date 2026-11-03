import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const [bun,entryArg,librariesArg]=process.argv.slice(2);
const entry=path.resolve(entryArg),libraries=path.resolve(librariesArg);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-typst-stdio-'));
const env={...process.env,H5P_MCP_TYPST_ENABLED:'1',H5P_MCP_TYPST_PROVIDER:'managed',
 H5P_MCP_TYPST_PACKAGES:path.join(root,'packages'),H5P_MCP_DATA_DIR:path.join(root,'data'),
 H5P_MCP_STORE_DIR:path.join(root,'store'),H5P_MCP_EXPORT_DIR:path.join(root,'exports'),
 H5P_MCP_EXPORT_ROOTS:JSON.stringify([root]),H5P_MCP_ASSET_ROOTS:JSON.stringify([root])};
delete env.H5P_MCP_TYPST_BIN;
const run=promisify(execFile);
const cli=async(...args)=>JSON.parse((await run(bun,[entry,'figure',...args],{env,windowsHide:true})).stdout);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.cp(libraries,path.join(env.H5P_MCP_DATA_DIR,'libraries'),{recursive:true});
assert.equal((await cli('status')).state,'missing');
const installed=await cli('install');assert.equal(installed.changed,true);
assert.equal((await cli('install')).changed,false);
assert.equal((await cli('status')).state,'profile-incomplete');
await cli('setup',env.H5P_MCP_TYPST_PACKAGES);
assert.equal((await cli('status')).state,'ready');

const client=new Client({name:'typst-probe',version:'1'});
const transport=new StdioClientTransport({command:bun,args:[entry,'stdio'],cwd:root,env,stderr:'pipe'});
try{
 await client.connect(transport);
 const tools=(await client.listTools()).tools;
 assert(tools.some(t=>t.name==='render_force_figure'));
 assert(!tools.some(t=>t.name==='install_typst'));
 const spec={forceN:8,upLabel:'Tensión',downLabel:'Peso',alt:'Dos flechas opuestas de 8 N parten del mismo cuerpo.'};
 const call=async(name,args)=>{
  const reply=await client.callTool({name,arguments:args});
  assert(!reply.isError&&reply.structuredContent?.ok!==false,JSON.stringify(reply));return reply.structuredContent;
 };
 const figure=await call('render_force_figure',spec);
 const preview=(await client.readResource({uri:figure.preview.uri})).contents[0];
 assert.equal(preview.mimeType,'image/png');
 const bytes=Buffer.from(preview.blob,'base64');
 assert.equal(hash(bytes),figure.preview.sha256);
 assert.deepEqual(await fs.readFile(path.join(figure.directory,'figure.png')),bytes);
 const activity={title:'Equilibrio',language:'es',license:'U',library:'H5P.TrueFalse 1.8',
  params:{question:'<p>La aceleración del cuerpo es cero.</p>',correct:'true',media:{type:{library:'H5P.Image 1.1',
   params:{file:{path:'asset:figure',mime:'image/png'},alt:spec.alt}}}},assets:{figure:figure.asset_id}};
 const prepared=await call('prepare_stored_h5p_activity',{activity});
 const artifact=await call('export_prepared_h5p_activity',{preparation_id:prepared.object_id,idempotency_key:'typst-figure-probe'});
 const h5p=Buffer.from((await client.readResource({uri:artifact.uri})).contents[0].blob,'base64');
 const filename=path.join(root,'equilibrio.h5p');await fs.writeFile(filename,h5p);
 const pkg=await call('upload_h5p_package',{mime:'application/zip',path:filename});
 const validated=await call('validate_stored_h5p_package',{object_id:pkg.object_id});
 assert.equal(validated.verification.structure,'passed');
 await call('revoke_stored_h5p_object',{object_id:figure.asset_id});
 await assert.rejects(client.readResource({uri:figure.preview.uri}));
 console.log(JSON.stringify({root,editable:figure.directory,package:filename,png:hash(bytes),h5p:hash(h5p)}));
}finally{await client.close();}

const preserved=path.join(path.dirname(installed.executable),'keep.txt');
await fs.writeFile(preserved,'unrelated');
await fs.appendFile(installed.executable,'damage');
assert.equal((await cli('status')).state,'unavailable');
const repaired=await cli('repair');
assert.notEqual(repaired.executable,installed.executable);
assert.equal((await cli('status')).state,'ready');
assert.equal((await cli('remove')).removed,2);
assert.equal(await fs.readFile(preserved,'utf8'),'unrelated');
assert.equal((await cli('status')).state,'missing');
console.log('Managed compiler lifecycle, stdio PNG, stored H5P export and revocation passed.');
