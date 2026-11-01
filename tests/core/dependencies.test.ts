import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import {load} from '../../src/infrastructure/runtime.js';
import {installPackage} from '../../src/h5p/packages.js';
import type {Native} from '../../src/domain/types.js';

test('Native installation rejects missing exact library dependencies and accepts them when shipped',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-dependency-regression-'));
 const {ZipFile}=load('yazl');
 const dependency={machineName:'H5P.Dependency',majorVersion:1,minorVersion:0};
 const library=(machineName:string,minorVersion=0)=>({title:machineName,machineName,majorVersion:1,minorVersion,patchVersion:0,runnable:0});
 try {
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
     expect((await installPackage(filename,path.join(root,kind+'-'+includeExact))).ok).toBe(true);
    } else {
     const error=await installPackage(filename,path.join(root,kind+'-'+includeExact)).then(()=>null,(failure:Native)=>failure);
     expect(error?.code).toBe('SCHEMA_VALIDATION_FAILED');
    }
   }
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
},30000);
