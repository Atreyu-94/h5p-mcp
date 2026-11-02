import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,readdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Service} from '../../src/adapters/service.js';
import {Resources,hash} from '../../src/adapters/resources.js';
import {valid} from '../../src/adapters/contracts.js';
test('closed public contracts reject invalid input and do not expose administrator tools',async()=>{
 const service=new Service();await service.initialize();
 try {
  expect(service.tools().some(t=>t.name==='install_h5p_library')).toBe(false);
  const denied=await service.call('install_h5p_library',{machine_name:'H5P.TrueFalse'});
  expect(denied.isError).toBe(true);
  expect(denied.structuredContent.diagnostics[0].code).toBe('PERMISSION_DENIED');
  expect(valid('operation_report',denied.structuredContent)).toBe(true);
  const invalid=await service.call('prepare_h5p_activity',{title:'x',library:'bad',params:{},secret:'never echo'});
  expect(invalid.isError).toBe(false);
  expect(JSON.stringify(invalid)).not.toContain('never echo');
  expect(valid('preparation_report',invalid.structuredContent)).toBe(true);
  const legacy=await service.call('get_h5p_activity_schema',{machine_name:'X',install_if_missing:true});
  expect(legacy.isError).toBe(true);
 }finally{await service.close();}
});
test('resource allowlist and artifact integrity fail closed',async()=>{
 const resources=new Resources();await resources.initialize();
 const skillDir=path.resolve(import.meta.dir,'../../.agents/skills/h5p-authoring');
 const files=await readdir(skillDir,{recursive:true,withFileTypes:true});
 const expected=files.filter(file=>file.isFile()).map(file=>path.relative(skillDir,path.join(file.parentPath,file.name)).split(path.sep).join('/'));
 expect(resources.skill.resources.map((item:{uri:string})=>item.uri).sort()).toEqual(expected.map(name=>'skill://h5p-authoring/'+name).sort());
 for(const item of resources.skill.resources) {
  const text=(await resources.read(item.uri)).contents[0].text;
  expect(hash(text)).toBe(item.digest.slice(7));
  expect(Buffer.byteLength(text)).toBe(item.size);
 }
 await expect(resources.read('skill://h5p-authoring/../../package.json')).rejects.toThrow();
 const root=await mkdtemp(path.join(os.tmpdir(),'h5p-resource-'));
 try{
  const filename=path.join(root,'test.h5p');await writeFile(filename,'fixture');
  const artifact=await resources.artifact(filename,{});
  await writeFile(filename,'changed');
  await expect(resources.read(artifact.uri)).rejects.toThrow('STALE_PREPARATION');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('configured roots reject sibling prefixes and empty allowlists',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'h5p-roots-'));
 const service=new Service();
 try {
  await mkdir(path.join(root,'safe'));await mkdir(path.join(root,'safe-other'));
  service.roots.PACKAGE=[path.join(root,'safe')];
  await expect(service.authorize(path.join(root,'safe-other'),'PACKAGE')).rejects.toThrow('PERMISSION_DENIED');
  service.roots.PACKAGE=[];
  await expect(service.authorize(path.join(root,'safe'),'PACKAGE')).rejects.toThrow('PERMISSION_DENIED');
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

