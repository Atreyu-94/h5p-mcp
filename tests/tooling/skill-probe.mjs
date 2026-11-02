import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'yaml';

const prefix='skill://h5p-authoring/';
const uri=prefix+'SKILL.md';
const shape={'~standard':{version:1,vendor:'probe',validate(value){return {value};}}};
const directory=path.resolve(import.meta.dirname,'../../.agents/skills/h5p-authoring');

export async function checkPublishedSkill(client,modern) {
 const files=await fs.readdir(directory,{recursive:true,withFileTypes:true});
 const expected=new Map();
 for(const entry of files.filter(file=>file.isFile())) {
  const filename=path.join(entry.parentPath,entry.name);
  const name=path.relative(directory,filename).split(path.sep).join('/');
  expected.set(prefix+name,await fs.readFile(filename));
 }
 const listed=(await client.listResources()).resources.filter(item=>item.uri.startsWith(prefix));
 assert.deepEqual(listed.map(item=>item.uri).sort(),[...expected.keys()].sort());
 for(const item of listed) {
  const {contents}=await client.readResource({uri:item.uri});
  assert.deepEqual(Buffer.from(contents[0].text),expected.get(item.uri),item.uri);
 }
 if(!modern)return;
 const {skills}=await client.request({method:'skills/list',params:{}},shape);
 assert.equal(skills.length,1);
 const [skill]=skills;
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
