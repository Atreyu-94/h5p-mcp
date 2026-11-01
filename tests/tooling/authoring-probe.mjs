import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
const [bun,root]=process.argv.slice(2),repo=path.resolve(import.meta.dirname,'../..');
const installed=path.join(root,'node_modules/h5p-mcp-authoring-probe'),load=createRequire(path.join(installed,'package.json'));
assert.throws(()=>load.resolve('@lumieducation/h5p-server'));assert.equal(await fs.access(path.join(installed,'h5p_mcp/lumi')).then(()=>true,()=>false),false);
const entry=path.join(installed,'dist/core/cli.js'),data=path.join(root,'data'),exports=path.join(root,'exports');
const fixture=path.join(repo,'tests/fixtures/libraries.zip'),lock=JSON.parse(await fs.readFile(path.join(repo,'tests/fixtures/libraries.lock.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(hash(await fs.readFile(fixture)),lock.sha256);
const archive=await load('yauzl-promise').open(fixture);
try{for await(const member of archive){const target=path.join(data,'libraries',member.filename);if(member.filename.endsWith('/')){await fs.mkdir(target,{recursive:true});continue;}await fs.mkdir(path.dirname(target),{recursive:true});const chunks=[];for await(const chunk of await member.openReadStream())chunks.push(chunk);await fs.writeFile(target,Buffer.concat(chunks));}}finally{await archive.close();}
const env={...process.env,H5P_MCP_DATA_DIR:data,H5P_MCP_EXPORT_DIR:exports,H5P_MCP_ASSET_ROOTS:JSON.stringify([root])};
const examples=JSON.parse(await fs.readFile(path.join(installed,'h5p_mcp/contracts/authoring-examples-v1.json'),'utf8'));
const pins=JSON.parse(await fs.readFile(path.join(installed,'h5p_mcp/contracts/authoring-adapters-v1.json'),'utf8'));
examples.push({...examples[0],id:'formula',question:{format:'markdown',value:'**Fórmula** \\(x_1 < x_2\\)'}});
examples.push({...examples[1],id:'single',mode:'single',scoring:'all_or_nothing',correct_ids:['metre']});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64');await fs.writeFile(path.join(root,'image.png'),png);
examples.push({...examples[0],id:'picture',assets:{picture:'image.png'},image:{id:'figure',asset:'picture',mime:'image/png',alt:'A square',library:{name:'H5P.Image 1.1',...pins['H5P.Image 1.1']},copyright:{author:'Teacher',license:'CC BY'}}});
const client=new Client({name:'authoring-probe',version:'1'},{versionNegotiation:{mode:'auto'}}),transport=new StdioClientTransport({command:bun,args:[entry,'stdio'],cwd:root,env,stderr:'pipe'});
let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk);
const observations=[];
const call=async(name,args)=>{const reply=await client.callTool({name,arguments:args});assert.notEqual(reply.isError,true,JSON.stringify(reply));return reply.structuredContent;};
const cli=(command,file,name)=>{const result=spawnSync(bun,[entry,command,file,...(name?[name]:[])],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16777216});assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(result.stdout);};
try{
 await client.connect(transport);
 const tools=(await client.listTools()).tools;for(const name of ['compile_h5p_source','check_h5p_source','build_h5p_source'])assert(tools.some(t=>t.name===name));
 assert((await client.readResource({uri:'h5p-authoring://v1/schema'})).contents[0].text.includes('schema_version'));
 for(const [index,source] of examples.entries()){
  const file=path.join(root,`source-${index}.json`);await fs.writeFile(file,JSON.stringify(source));
  const expected=cli('compile',file),checked=cli('check',file);assert(expected.ok);assert.deepEqual(checked.activity,expected.activity);
  const local=structuredClone(source);if(local.assets)for(const id of Object.keys(local.assets))local.assets[id]=path.resolve(root,local.assets[id]);
  const compiled=await call('compile_h5p_source',{source:local});assert(compiled.ok,JSON.stringify(compiled));assert.deepEqual(compiled.activity,expected.activity);assert.deepEqual(compiled.source_map,expected.source_map);
  const built=await call('build_h5p_source',{source:local,output_name:`mcp-${index}`});assert(built.ok,JSON.stringify(built));assert.equal(built.export_mode,'content-only');assert.equal(built.verification.importation,'not_run');
  assert(cli('build',file,`cli-${index}`).ok);
  const bytes=Buffer.from((await client.readResource({uri:built.artifact.uri})).contents[0].blob,'base64');assert.equal(hash(bytes),built.artifact.sha256);
  const zip=await load('yauzl-promise').open(path.join(exports,`mcp-${index}.h5p`)),members=[];let content;
  try{for await(const member of zip){members.push(member.filename);const chunks=[];for await(const chunk of await member.openReadStream())chunks.push(chunk);if(member.filename==='content/content.json')content=JSON.parse(Buffer.concat(chunks));if(member.filename.startsWith('content/media/'))assert.deepEqual(Buffer.concat(chunks),png);}}finally{await zip.close();}
  assert(members.every(name=>name==='h5p.json'||name.startsWith('content/')));assert.equal(content.question,compiled.activity.params.question);
  if(source.type==='true_false')assert.equal(content.correct,String(source.correct));else assert.deepEqual(content.answers.map(a=>a.correct),source.choices.map(c=>source.correct_ids.includes(c.id)));
  if(source.image){assert.equal(content.media.type.params.file.width,1);assert.equal(content.media.type.subContentId,compiled.identities.figure);}
  observations.push({id:source.id,cli_mcp_parity:'passed',content_only:'passed',answer_preservation:'passed',package_sha256:hash(bytes)});console.log(`authoring ${source.id}: CLI/MCP parity and build passed without Lumi`);
 }
 const invalid=await call('compile_h5p_source',{source:{...examples[1],correct_ids:['missing']}});assert.equal(invalid.ok,false);assert.equal(invalid.diagnostics[0].pointer,'/correct_ids/0');assert.equal(invalid.diagnostics[0].stage,'source');assert(!JSON.stringify(invalid).includes(root));
 assert.equal(stderr,'');
 await fs.writeFile(path.join(root,'authoring-report.json'),JSON.stringify({status:'passed',lumi_resolvable:false,installed,observations,importation:'not_run',playback:'not_run',grading:'not_run'},null,2));
}finally{await client.close();}
