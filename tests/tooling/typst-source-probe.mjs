import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const [bun,entry,output]=process.argv.slice(2);
const root=path.resolve(output);
await fs.mkdir(root,{recursive:true});
const client=new Client({name:'typst-source-probe',version:'1'});
try{
 await client.connect(new StdioClientTransport({command:bun,args:[path.resolve(entry),'stdio'],cwd:root,
  env:{...process.env,H5P_MCP_DATA_DIR:path.join(root,'data'),H5P_MCP_STORE_DIR:path.join(root,'store'),
   H5P_MCP_EXPORT_DIR:root,H5P_MCP_EXPORT_ROOTS:JSON.stringify([root])},stderr:'pipe'}));
 assert((await client.listTools()).tools.some(tool=>tool.name==='render_typst_figure'));
 for(const [file,alt] of [['parabola','Parábola y = x²'],['energy','Transición ascendente del nivel E1 al nivel E2']]){
  const source=await fs.readFile(new URL('../fixtures/typst/'+file+'.typ',import.meta.url),'utf8');
  const reply=await client.callTool({name:'render_typst_figure',arguments:{source,alt}});
  assert(reply.structuredContent?.ok,JSON.stringify(reply.content));
  const {directory,preview,manifest}=reply.structuredContent;
  const image=await client.readResource({uri:preview.uri});
  assert.deepEqual(Buffer.from(image.contents[0].blob,'base64'),await fs.readFile(path.join(directory,'figure.png')));
  assert.equal(await fs.readFile(path.join(directory,'figure.typ'),'utf8'),source);
  console.log(JSON.stringify({file,directory,hashes:manifest.hashes}));
 }
}finally{await client.close();}
