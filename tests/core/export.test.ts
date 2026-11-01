import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {load} from '../../src/infrastructure/runtime.js';
import {isolated} from '../../src/infrastructure/worker.js';
import {hash} from '../../src/adapters/resources.js';
import type {Native} from '../../src/domain/types.js';

test('default native backend exports the exact main-library embed modes and falls back to div when absent',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-embed-regression-'));
 const fixture=new URL('../fixtures/libraries.zip',import.meta.url);
 const lock=JSON.parse(await fs.readFile(new URL('../fixtures/libraries.lock.json',import.meta.url),'utf8'));
 try {
  expect(hash(await fs.readFile(fixture))).toBe(lock.sha256);
  const zip=await load('yauzl-promise').open(fileURLToPath(fixture));
  try {
   for await(const entry of zip){
    const target=path.join(root,'libraries',entry.filename);
    if(entry.filename.endsWith('/')){await fs.mkdir(target,{recursive:true});continue;}
    await fs.mkdir(path.dirname(target),{recursive:true});
    const chunks=[];for await(const chunk of await entry.openReadStream())chunks.push(chunk);
    await fs.writeFile(target,Buffer.concat(chunks));
   }
  }finally{await zip.close();}
  const metadataPath=path.join(root,'libraries/H5P.TrueFalse-1.8/library.json');
  const metadata=JSON.parse(await fs.readFile(metadataPath,'utf8'));
  // Fixture mutation isolates the export contract; this is not InteractiveBook playback evidence.
  for(const [index,modes] of [ ['iframe'],['div','iframe'],undefined ].entries()){
   if(modes)metadata.embedTypes=modes;else delete metadata.embedTypes;
   await fs.writeFile(metadataPath,JSON.stringify(metadata));
   const output=path.join(root,`embed-${index}.h5p`);
   const result=await isolated({action:'export',data_dir:root,path:output,activity:{title:'Embed regression',library:'H5P.TrueFalse 1.8',language:'en',license:'U',assets:{},params:{question:'<p>True?</p>',correct:'true'}}},AbortSignal.timeout(30000)) as Native;
   expect(result.h5p_json.embedTypes).toEqual(modes||['div']);
   const exported=await load('yauzl-promise').open(output);
   let packaged:Native;
   try{for await(const entry of exported)if(entry.filename==='h5p.json'){
    const chunks=[];for await(const chunk of await entry.openReadStream())chunks.push(chunk);
    packaged=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   }}finally{await exported.close();}
   expect(packaged.embedTypes).toEqual(modes||['div']);
   expect(packaged.mainLibrary).toBe('H5P.TrueFalse');
   const imported=await isolated({action:'validate',data_dir:root,path:output},AbortSignal.timeout(30000)) as Native;
   expect(imported.ok).toBe(true);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
},150000);
