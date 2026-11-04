import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'yaml';

const shape={'~standard':{version:1,vendor:'probe',validate(value){return {value};}}};

export async function checkPublishedSkill(client,modern) {
 for(const slug of ['h5p-authoring','typst-graphics']){
  const prefix='skill://'+slug+'/',uri=prefix+'SKILL.md';
  const directory=path.resolve(import.meta.dirname,'../../.agents/skills',slug);
  const expected=new Map();
  for(const name of JSON.parse(await fs.readFile(path.join(directory,'resources.json'),'utf8'))){
   const source=slug==='typst-graphics'&&name.startsWith('examples/')?path.resolve(import.meta.dirname,'../../examples/scientific-figures',name.slice(9)):path.join(directory,name);
   expected.set(prefix+name,await fs.readFile(source));
  }
  const listed=(await client.listResources()).resources.filter(item=>item.uri.startsWith(prefix));
  assert.deepEqual(listed.map(item=>item.uri).sort(),[...expected.keys()].sort());
  for(const item of listed) {
   const {contents}=await client.readResource({uri:item.uri});
   assert.deepEqual(Buffer.from(contents[0].text),expected.get(item.uri),item.uri);
  }
  if(!modern)continue;
  const tools=await client.request({method:'tools/list',params:{}},shape);
  assert.equal(tools.cacheScope,'private');assert(tools.ttlMs>0);
  const guide=await client.request({method:'resources/read',params:{uri}},shape);
  assert.equal(guide.cacheScope,'public');assert(guide.ttlMs>0);
  const {skills}=await client.request({method:'skills/list',params:{}},shape);
  assert.equal(skills.length,2);
  const skill=skills.find(item=>item.uri===uri);
  assert.equal(skill.uri,uri);
  const header=expected.get(uri).toString().split(/^---\r?$/m)[1];
  assert.deepEqual(skill.frontmatter,parse(header));
  assert.deepEqual((await client.request({method:'skills/get',params:{uri}},shape)).skill,skill);
  assert.deepEqual(skill.resources.map(item=>item.uri).sort(),[...expected.keys()].sort());
  for(const item of skill.resources) {
   const bytes=expected.get(item.uri);
   assert.equal(item.size,bytes.length);
   assert.equal(item.digest,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
  }
  await assert.rejects(client.request({method:'skills/get',params:{uri:uri+'/../security.md'}},shape));
 }
}
