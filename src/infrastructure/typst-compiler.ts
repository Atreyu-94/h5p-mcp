import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {downloadPinned,sha} from './typst-download.js';
import {invoke,runFigureProcess} from './typst-process.js';
import {exclusive} from './generations.js';
import {readBounded} from './read-bounded.js';

export const typstVersion='0.15.1';
interface Release {target:string;size:number;archive:string;binary:string}
// GitHub release v0.15.1. Binary digests are from the independently verified archives.
const releases:Record<string,Release>={
 'win32-x64':{target:'x86_64-pc-windows-msvc',size:22463684,archive:'19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736',binary:'081217a463adb006f8894b44227fe4b9c9e91fc85f5463d5948e8370db9bb31e'},
 'win32-arm64':{target:'aarch64-pc-windows-msvc',size:21246627,archive:'4ab28e1b71ec3184d38d580ab797f499b6770d952b6b19167be5cea5c2662e14',binary:'597aa7d38d47aba6c031939ad2b00cd83f3544029e7bbc2bb2270d560b6b4b6c'},
 'darwin-x64':{target:'x86_64-apple-darwin',size:15635600,archive:'7f9fdd9584866245de9a79e0add8f9236fae6f40a8a45e2c4771ccc14db4e0fa',binary:'a6fb5786e71f6f95d8323b326353770734c1e4624e7c108783ea578723916b46'},
 'darwin-arm64':{target:'aarch64-apple-darwin',size:14438168,archive:'48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a',binary:'7c4a136b377f3689400afe37b4f0fe3528d50faaa55cbb1106ac8a128f86ba1a'},
 'linux-x64':{target:'x86_64-unknown-linux-musl',size:17462992,archive:'a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c',binary:'29273eaa04f6d00edd0c2bec578f565fc9c65be856bfbffc894567c68ed0b237'},
 'linux-arm64':{target:'aarch64-unknown-linux-musl',size:16216812,archive:'5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee',binary:'3088dd985a891d804a98c69db24dfca77a35878e45d40e38c79cf36d72bcd4c1'},
};
export function releaseFor(platform:string,arch:string) {
 const release=releases[platform+'-'+arch];
 if(!release)throw new Error('No managed Typst release for '+platform+'/'+arch+'. Configure H5P_MCP_TYPST_BIN manually.');
 return release;
}
const managedRoot=()=>path.join(path.resolve(process.env.H5P_MCP_DATA_DIR||path.join(os.homedir(),'.h5p-mcp')),'typst-managed');
const binaryName=()=>process.platform==='win32'?'typst.exe':'typst';
const buildName=/^build-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const missing=(err:unknown)=>(err as NodeJS.ErrnoException).code==='ENOENT';
async function active(root:string) {
 let name:string;
 try{name=(await readBounded(path.join(root,'active'),100)).toString('utf8').trim();}
 catch(error){if(missing(error))return null;throw error;}
 if(!buildName.test(name))throw new Error('Invalid managed Typst selection.');
 return name;
}
export async function managedExecutable() {
 const root=managedRoot(),name=await active(root);
 if(!name)return null;
 const dir=path.join(root,name),exe=path.join(dir,binaryName());
 if(!(await fs.lstat(dir)).isDirectory()||!(await fs.lstat(exe)).isFile()||
   sha(await readBounded(exe,128*1024*1024))!==releaseFor(process.platform,process.arch).binary)
  throw new Error('Managed Typst integrity check failed; run figure repair.');
 return exe;
}

async function unpackRelease(release:Release,archive:string,dir:string,signal:AbortSignal){
 const tar=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe'):'/usr/bin/tar';
 for(const name of [binaryName(),'LICENSE','NOTICE']){
  // Extract named members to stdout; archive paths never become writable host paths.
  const stdout=await runFigureProcess(tar,['-xOf',archive,'typst-'+release.target+'/'+name],signal,128*1024*1024,45000);
  if(name===binaryName()&&sha(stdout)!==release.binary)throw new Error('Unexpected Typst executable digest.');
  await fs.writeFile(path.join(dir,name),stdout,{flag:'wx',mode:name===binaryName()?0o755:0o644});
 }
}

export async function installCompiler(signal:AbortSignal,repair=false) {
 if(process.env.H5P_MCP_TYPST_ENABLED!=='1')throw new Error('Enable figures before installing Typst.');
 const release=releaseFor(process.platform,process.arch),root=managedRoot();
 return exclusive(root,AbortSignal.any([signal,AbortSignal.timeout(180000)]),async()=>{
  if(!repair){
   const current=await active(root);
   if(current){
    const receipt=JSON.parse((await readBounded(path.join(root,current,'receipt.json'),4096)).toString('utf8'));
    if(receipt.version===typstVersion && receipt.target===release.target){
     const executable=await managedExecutable();
     return {ok:true,version:typstVersion,executable,changed:false};
    }
   }
  }
  const name='build-'+randomUUID(),dir=path.join(root,name);
  const temp=await fs.mkdtemp(path.join(root,'.install-'));
  let published=false,created=false;
  try{
   const ext=process.platform==='win32'?'.zip':'.tar.xz';
   const url='https://github.com/typst/typst/releases/download/v'+typstVersion+'/typst-'+release.target+ext;
   const bytes=await downloadPinned(url,release.size,release.archive,signal,true);
   const archive=path.join(temp,'download'+ext);
   await fs.writeFile(archive,bytes,{flag:'wx'});
   await fs.mkdir(dir);created=true;
   await unpackRelease(release,archive,dir,signal);
   const exe=path.join(dir,binaryName());
   if(!(await invoke(exe,['--version'],signal)).startsWith('typst '+typstVersion+' '))throw new Error('Compiler version mismatch.');
   const source=path.join(temp,'smoke.typ'),png=path.join(temp,'smoke.png');
   await fs.writeFile(source,'#set page(width:20pt,height:20pt,margin:0pt)\nOK');
   await invoke(exe,['compile','--root',temp,'--ignore-system-fonts',source,png],signal);
   if((await readBounded(png,1048576)).subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Compiler smoke test failed.');
   await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify({format:1,name,target:release.target,version:typstVersion,sha256:release.binary}));
   await fs.writeFile(path.join(temp,'active'),name+'\n');signal.throwIfAborted();
   await fs.rename(path.join(temp,'active'),path.join(root,'active'));published=true;
   return {ok:true,version:typstVersion,executable:exe,changed:true};
  }finally{
   if(created&&!published)await fs.rm(dir,{recursive:true,force:true});
   await fs.rm(temp,{recursive:true,force:true});
  }
 });
}

export async function removeCompiler(signal:AbortSignal) {
 const root=managedRoot();
 return exclusive(root,AbortSignal.any([signal,AbortSignal.timeout(15000)]),async()=>{
  const selected=await active(root);
  const builds:Array<{name:string;binary:string}>=[];
  for(const entry of await fs.readdir(root,{withFileTypes:true})){
   if(!entry.isDirectory()||!buildName.test(entry.name))continue;
   const dir=path.join(root,entry.name),file=path.join(dir,'receipt.json');
   if(!await fs.lstat(file).then(stat=>stat.isFile(),err=>{if(missing(err))return false;throw err;}))continue;
   const r=JSON.parse((await readBounded(file,4096)).toString('utf8'));
   if(r.format===1&&r.name===entry.name&&typeof r.target==='string'&&
     Object.values(releases).some(pin=>pin.target===r.target)&&/^[a-f0-9]{64}$/.test(r.sha256)){
    builds.push({name:entry.name,binary:r.target.endsWith('windows-msvc')?'typst.exe':'typst'});
   }
  }
  if(selected&&!builds.some(build=>build.name===selected))throw new Error('Refusing to remove an unrecognized managed installation.');
  if(selected)await fs.unlink(path.join(root,'active'));
  for(const {name,binary} of builds){
   const dir=path.join(root,name);
   for(const file of [binary,'LICENSE','NOTICE','receipt.json'])await fs.rm(path.join(dir,file),{force:true});
   // Leave any unrelated user files in place.
   if(!(await fs.readdir(dir)).length)await fs.rmdir(dir);
  }
  return {ok:true,removed:builds.length};
 });
}
