import {test,expect,spyOn} from 'bun:test';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {validatePackage,installPackage} from '../../src/h5p/packages.js';
const {ZipFile}=createRequire(import.meta.url)('yazl');
import {pipeline} from 'node:stream/promises';import {createWriteStream} from 'node:fs';
test('native imports reject missing exact dependencies in every role, newer Core and unsafe paths',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-native-import-errors-'));
 const meta=(name:string,minor=0)=>({machineName:name,title:name,majorVersion:1,minorVersion:minor,patchVersion:0,runnable:0});
 async function pack(name:string,files:Record<string,unknown>){const zip=new ZipFile(),filename=path.join(root,name+'.h5p');for(const [key,value] of Object.entries(files))zip.addBuffer(Buffer.from(JSON.stringify(value)),key,{compress:false});const writing=pipeline(zip.outputStream,createWriteStream(filename));zip.end();await writing;return filename;}
 try{
  const two=await pack('two',{'H5P.A-1.0/library.json':meta('H5P.A'),'H5P.B-1.0/library.json':meta('H5P.B')});
  const original=await pack('original',{'H5P.Original-1.0/library.json':meta('H5P.Original')});
  const mkdir=fs.mkdir;
  const swap=spyOn(fs,'mkdir').mockImplementation(async(...args:Parameters<typeof mkdir>)=>{
   if(path.basename(String(args[0]))==='contents')await fs.copyFile(two,original);
   return mkdir(...args);
  });
  const replaced=path.join(root,'replace-input');
  try{await installPackage(original,replaced);}finally{swap.mockRestore();}
  expect(await fs.readFile(original)).toEqual(await fs.readFile(two));
  expect(await fs.readdir(path.join(replaced,'libraries'))).toEqual(['H5P.Original-1.0']);
  const target=path.join(root,'interrupted'),rename=fs.rename;
  let published=0;
  const fault=spyOn(fs,'rename').mockImplementation(async(from,to)=>{
   if(++published===2)throw Object.assign(new Error('disk full'),{code:'ENOSPC',errno:-28});
   return rename(from,to);
  });
  try{await expect(installPackage(two,target)).rejects.toMatchObject({code:'ENOSPC'});}
  finally{fault.mockRestore();}
  const folders=await fs.readdir(path.join(target,'libraries'));expect(folders).toHaveLength(1);
  expect(await fs.readdir(path.join(target,'libraries',folders[0]))).toEqual(['library.json']);
  expect((await installPackage(two,target)).ok).toBe(true);
  for(const role of ['preloadedDependencies','dynamicDependencies','editorDependencies']){
   const filename=await pack(role,{'H5P.Test-1.0/library.json':{...meta('H5P.Test'),[role]:[{machineName:'H5P.Child',majorVersion:1,minorVersion:0}]},'H5P.Child-1.1/library.json':meta('H5P.Child',1)});
   await expect(installPackage(filename,path.join(root,'store'))).rejects.toBeDefined();expect(await fs.readdir(path.join(root,'store/libraries'))).toEqual([]);
  }
  const core=await pack('core',{'H5P.Test-1.0/library.json':{...meta('H5P.Test'),coreApi:{majorVersion:9,minorVersion:0}}});await expect(installPackage(core,path.join(root,'store'))).rejects.toMatchObject({code:'TARGET_INCOMPATIBLE'});
  const resources=await pack('resources',{'H5P.Test-1.0/library.json':{...meta('H5P.Test'),preloadedJs:[{path:'../escape.js'}]}});await expect(installPackage(resources,path.join(root,'store'))).rejects.toBeDefined();
  const active=await pack('active',{'H5P.Test-1.0/library.json':meta('H5P.Test'),'H5P.Test-1.0/unsafe.php':'active'});await expect(installPackage(active,path.join(root,'store'))).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
  const incomplete=await pack('incomplete',{'h5p.json':{title:'Test',mainLibrary:'H5P.Missing',preloadedDependencies:[{machineName:'H5P.Missing',majorVersion:1,minorVersion:0}]},'content/content.json':{}});await expect(validatePackage(incomplete)).rejects.toBeDefined();
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('native package validation checks license filenames, all bundled graphs and original metadata',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-package-regression-'));
 const dependency={machineName:'H5P.Test',majorVersion:1,minorVersion:0};
 const metadata={title:'Test',language:'en',license:'U',mainLibrary:'H5P.Test',embedTypes:['div'],preloadedDependencies:[dependency]};
 const library={...dependency,title:'Test',patchVersion:0,runnable:1};
 let index=0;
 async function pack(meta:unknown=metadata,extra:Record<string,unknown>={}){
  const zip=new ZipFile(),filename=path.join(root,String(index++)+'.h5p');
  for(const [key,value] of Object.entries({'h5p.json':meta,'content/content.json':{},'H5P.Test-1.0/library.json':library,'H5P.Test-1.0/semantics.json':[],...extra}))zip.addBuffer(Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)),key,{compress:false});
  const writing=pipeline(zip.outputStream,createWriteStream(filename));zip.end();await writing;return filename;
 }
 try{
  const safe=await pack(metadata,{'H5P.Test-1.0/LICENSE':'License','H5P.Test-1.0/LICENSE.txt':'License','H5P.Test-1.0/NOTICE.md':'Notice'});
  expect((await validatePackage(safe)).ok).toBe(true);
  expect((await installPackage(safe,path.join(root,'safe'))).ok).toBe(true);
  const pdf={'content/media/document.pdf':Buffer.from('%PDF-1.4\n%%EOF'),
   'content/content.json':{attachment:{path:'media/document.pdf',mime:'application/pdf'}}};
  for(const type of ['file','image']){
   const filename=await pack(metadata,{...pdf,'H5P.Test-1.0/semantics.json':[{type,name:'attachment'}]});
   if(type==='file')expect((await validatePackage(filename)).ok).toBe(true);
   else await expect(validatePackage(filename)).rejects.toMatchObject({details:expect.arrayContaining([
    expect.objectContaining({code:'MIME_MISMATCH',pointer:'/params/attachment'})])});
  }
  const content=await pack(metadata,{'H5P.Test-1.0/library.json':library});
  const zip=new ZipFile(),only=path.join(root,'content-only.h5p');
  zip.addBuffer(Buffer.from(JSON.stringify(metadata)),'h5p.json');zip.addBuffer(Buffer.from('{}'),'content/content.json');
  const writing=pipeline(zip.outputStream,createWriteStream(only));zip.end();await writing;
  expect(await validatePackage(only)).toMatchObject({ok:false,package_mode:'content-only',missing_local_libraries:['H5P.Test 1.0']});
  await installPackage(content,path.join(root,'target'));
  expect(await validatePackage(only,path.join(root,'target/libraries'))).toMatchObject({ok:true,package_mode:'content-only',required_libraries:['H5P.Test 1.0']});
  const math={machineName:'H5P.MathDisplay',majorVersion:1,minorVersion:0};
  const withFormula={'content/content.json':{text:'Use \\(x\\)'},'H5P.Test-1.0/semantics.json':[{type:'text',name:'text'}],
   'H5P.MathDisplay-1.0/library.json':{...math,title:'MathDisplay',patchVersion:0,runnable:0}};
  for(const manifest of [metadata,{...metadata,dynamicDependencies:[math]}])
   await expect(validatePackage(await pack(manifest,withFormula))).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
  expect((await validatePackage(await pack({...metadata,preloadedDependencies:[dependency,math]},withFormula))).ok).toBe(true);
  const child={...dependency,machineName:'H5P.Child'};
  const files={'H5P.Child-1.0/library.json':{...library,...child,runnable:0}};
  const dynamicChild={...files,'H5P.Test-1.0/library.json':{...library,dynamicDependencies:[child]}};
  await expect(validatePackage(await pack(metadata,dynamicChild))).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
  expect((await validatePackage(await pack({...metadata,dynamicDependencies:[child]},dynamicChild))).ok).toBe(true);
  expect((await validatePackage(await pack({...metadata,preloadedDependencies:[dependency,child]},dynamicChild))).ok).toBe(true);
  const editorOnly={...files,'H5P.Test-1.0/library.json':{...library,editorDependencies:[child]}};
  expect((await validatePackage(await pack(metadata,editorOnly))).ok).toBe(true);
  for(const name of ['LICENSE.php','COPYING.phtml','NOTICE.cgi','LICENSE-MIT.php']){
   const file=await pack(metadata,{['H5P.Test-1.0/'+name]:'not executed'});
   await expect(validatePackage(file)).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
   await expect(installPackage(file,path.join(root,'unsafe'))).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
  }
  for(const role of ['preloadedDependencies','dynamicDependencies','editorDependencies']){
   const file=await pack(metadata,{'H5P.Orphan-1.0/library.json':{...library,machineName:'H5P.Orphan',runnable:0,[role]:[{...dependency,machineName:'H5P.Missing'}]}});
   await expect(validatePackage(file)).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
   await expect(installPackage(file,path.join(root,'orphan'))).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
  }
  for(const patch of [
   {embedTypes:[]},{embedTypes:['script']},{embedTypes:'div'},{embedTypes:undefined},
   {language:undefined},{language:''},{license:false},{license:''},
   {preloadedDependencies:[{...dependency,majorVersion:'1'}]},
   {dynamicDependencies:{}},{authors:[{name:'Author'}]},{changes:'invalid'}
  ])await expect(validatePackage(await pack({...metadata,...patch}))).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
  await expect(validatePackage(await pack({...metadata,preloadedDependencies:{}}))).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
  expect((await validatePackage(await pack({...metadata,embedTypes:['iframe','div'],license:undefined}))).ok).toBe(true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
