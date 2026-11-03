import fs from 'node:fs/promises';
import path from 'node:path';
import {sha,downloadPinned} from './typst-download.js';
export {sha} from './typst-download.js';
import {readBounded} from './read-bounded.js';

const packages={
 'preview/cetz/0.5.3':{
  tree:'9692d2e82c2cf150778df2fc3db2c06dda6de29cf79f287b74289f409c16e3c4',
  archive:'79ca64869c60aefaf0eccc7e7371ab47cc6cb85bce1ad222e42cf1879c965b5f',size:249144,
 },
 'preview/oxifmt/1.0.0':{
  tree:'b597e0b70b2308446eba7c85bd8acc80fc280943fed1ba1d27475e80c61d7777',
  archive:'7d17a1fc8ad01740ec3cb2b03c7360a4225ff9318e5710765fa98ea6fd59594f',size:20124,
 },
};
export const profile=Object.fromEntries(Object.entries(packages).map(([name,pin])=>[name,pin.tree]));
// These are reviewed Typst package trees, including the CeTZ WASM plugin.
// Check bytes before use and compile from private copies to keep inputs stable.
export async function verifyProfile(root:string,destination?:string) {
 if(!root || !path.isAbsolute(root))throw new Error('Set H5P_MCP_TYPST_PACKAGES to the absolute package root containing preview/.');
 for(const [pkg,expected] of Object.entries(profile)){
  const base=path.join(root,pkg);
  const entries=await fs.readdir(base,{recursive:true,withFileTypes:true});
  const records:string[]=[];
  for(const entry of entries){
   if(!entry.isDirectory()&&!entry.isFile())throw new Error('Unsupported package entry.');
   if(entry.isDirectory())continue;
   const filename=path.join(entry.parentPath,entry.name);
   const name=path.relative(base,filename).split(path.sep).join('/');
   const data=await readBounded(filename,8*1024*1024);
   records.push(name+'\0'+sha(data)+'\n');
   if(destination){
    const target=path.join(destination,pkg,name);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,data,{flag:'wx'});
   }
  }
  if(sha(records.sort().join(''))!==expected)throw new Error('Package digest mismatch: '+pkg);
 }
}

export async function setupFigureProfile(output:string,signal:AbortSignal) {
 if(process.env.H5P_MCP_TYPST_ENABLED!=='1')throw new Error('Enable local figures before configuring the package profile.');
 const temp=await fs.mkdtemp(path.join(path.dirname(output),'.h5p-profile-'));
 try {
  for(const [pkg,{size,archive}] of Object.entries(packages)){
   const [,name,version]=pkg.split('/');
   const bytes=await downloadPinned(`https://packages.typst.org/preview/${name}-${version}.tar.gz`,size,archive,signal,false);
   // Only extract the two exact reviewed registry archives.
   const target=path.join(temp,pkg);await fs.mkdir(target,{recursive:true});
   await new Bun.Archive(bytes).extract(target);
  }
  await verifyProfile(temp);
  signal.throwIfAborted();
  await fs.mkdir(output);
  try{await fs.rename(path.join(temp,'preview'),path.join(output,'preview'));}
  catch(error){await fs.rmdir(output);throw error;}
  return {ok:true,packages:output,profile};
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
