import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import {load} from '../../src/infrastructure/runtime.js';
import {editorAt} from '../../src/h5p/editor.js';
import {validate} from '../../src/h5p/validation.js';
import type {Native} from '../../src/domain/types.js';

test('Lumi rejects missing exact library dependencies and accepts them when shipped',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-dependency-regression-'));
 const {ZipFile}=load('yazl');
 const dependency={machineName:'H5P.Dependency',majorVersion:1,minorVersion:0};
 const library=(machineName:string,minorVersion=0)=>({title:machineName,machineName,majorVersion:1,minorVersion,patchVersion:0,runnable:0});
 try {
  const editor=await editorAt(path.join(root,'data'),path.join(root,'libraries'));
  expect(editor.config.coreApiVersion).toEqual({major:1,minor:28});
  expect(editor.config.validateLibraryDependencies).toBe(true);
  for(const kind of ['preloadedDependencies','editorDependencies','dynamicDependencies']) {
   for(const includeExact of [false,true]) {
    const zip=new ZipFile(),filename=path.join(root,`${kind}-${includeExact}.h5p`);
    const add=(name:string,value:unknown)=>zip.addBuffer(Buffer.from(JSON.stringify(value)),name);
    add('h5p.json',{title:'Dependency regression',language:'en',mainLibrary:'H5P.Probe',embedTypes:['div'],preloadedDependencies:[{machineName:'H5P.Probe',majorVersion:1,minorVersion:0}]});
    add('content/content.json',{});
    add('H5P.Probe-1.0/semantics.json',[]);
    add('H5P.Probe-1.0/library.json',{...library('H5P.Probe'),[kind]:[dependency]});
    // A newer minor does not satisfy an exact H5P dependency.
    add('H5P.Dependency-1.1/library.json',library('H5P.Dependency',1));
    if(includeExact)add('H5P.Dependency-1.0/library.json',library('H5P.Dependency'));
    const written=pipeline(zip.outputStream,createWriteStream(filename));zip.end();await written;
    if(includeExact) {
     expect((await validate(editor,filename)).ok).toBe(true);
    } else {
     const error=await validate(editor,filename).then(()=>null,(failure:Native)=>failure);
     expect(error?.code).toBe('SCHEMA_VALIDATION_FAILED');
     expect(error?.message).toContain('missing-required-library');
     expect(error?.message).toContain('H5P.Dependency-1.0');
    }
    // Each case starts with no installed libraries, including prior accepted cases.
    await fs.rm(path.join(root,'libraries'),{recursive:true,force:true});
    await fs.mkdir(path.join(root,'libraries'));
   }
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
},30000);
