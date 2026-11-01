import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('MCP discovery and the first native catalog operation leave Lumi unloaded',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'h5p-startup-test-'));
 const serviceURL=new URL('../../src/adapters/service.ts',import.meta.url).href;
 // A fresh process prevents other test imports from hiding eager editor loading.
 const script=`
  const {Service}=await import(${JSON.stringify(serviceURL)});
  const service=new Service();
  const lumiLoaded=()=>Object.keys(require.cache).some(name=>name.includes('@lumieducation'));
  try {
   await service.initialize();
   const tools=service.tools();
   const before=lumiLoaded();
   const result=await service.engine.run({action:'catalog',data_dir:process.env.H5P_MCP_DATA_DIR});
   console.log(JSON.stringify({before,after:lumiLoaded(),tools:tools.length,libraries:result.libraries}));
  } finally {await service.close();}
 `;
 try {
  const child=spawnSync(process.execPath,['--eval',script],{encoding:'utf8',timeout:10000,windowsHide:true,
   env:{...process.env,H5P_MCP_DATA_DIR:root,H5P_MCP_ADMIN_SCOPES:''}});
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  const result=JSON.parse(child.stdout);
  expect(result.before).toBe(false);
  expect(result.after).toBe(false);
  expect(result.tools).toBeGreaterThan(0);
  expect(result.libraries).toEqual({});
 } finally {await rm(root,{recursive:true,force:true});}
},15000);
