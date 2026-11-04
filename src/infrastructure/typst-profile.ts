import fs from 'node:fs/promises';
import path from 'node:path';
import {sha,downloadPinned} from './typst-download.js';
export {sha} from './typst-download.js';
import {readBounded} from './read-bounded.js';

const originalPackages={
 'preview/cetz/0.5.3':{
  tree:'9692d2e82c2cf150778df2fc3db2c06dda6de29cf79f287b74289f409c16e3c4',
  archive:'79ca64869c60aefaf0eccc7e7371ab47cc6cb85bce1ad222e42cf1879c965b5f',size:249144,
 },
 'preview/oxifmt/1.0.0':{
  tree:'b597e0b70b2308446eba7c85bd8acc80fc280943fed1ba1d27475e80c61d7777',
  archive:'7d17a1fc8ad01740ec3cb2b03c7360a4225ff9318e5710765fa98ea6fd59594f',size:20124,
 },
};
const packages={
 ...originalPackages,
 'preview/lilaq/0.6.0':{
  tree:'085f2ba7b30d926f65fb7e0d0545d6b548daf9ad4c89e5d25d9ac8c234a04544',
  archive:'41e7839e9e4eaf5c0b5ec93f23d387233bce439fe226326b06c2fa01f2fc251f',size:103580,
 },
 'preview/elembic/1.1.1':{
  tree:'8ef498d89962ce037b6526ff5e83ed89c0a475b05f60a63488b8819f0b06783a',
  archive:'e3a8ec6b2ad5f43d93ae31dd5742de7256c57719675636179cd818f26ca7bb88',size:71350,
 },
 'preview/zero/0.6.1':{
  tree:'345e7321d9da59c2cab047e868f298eeb2398d07149f8e82897fb5f14c8ee6b6',
  archive:'87ffec0d591551ab5d1465c40582e4441876dd8f70ef88a2d577297f5977768f',size:24395,
 },
 'preview/tiptoe/0.4.0':{
  tree:'11436865b809f9c08432ae2b8a0c6ceb0a61996d173cb24e00fb1aa637e52756',
  archive:'1be772c335902a7554b5164a5a4145bfd886867ac1b26478b74d5e4bf9eb6b3f',size:15543,
 },
 'preview/chemformula/0.1.3':{
  tree:'aae8dd7f13842c140fe95a454f778cd2d886af2b81a74094ce854b5644130133',
  archive:'e54638acad5fac1ad45aa054b2555a72733bdaa38469012b7537b0c296246b3e',size:7723,
 },
 'preview/typed-smiles/0.13.0':{
  tree:'52ec0eff2010e2f588e36eb5777934b6f0006173e7577f364b6decb036ad6892',
  archive:'7023eb04e6bf4b32ad106e4ad405bcf3e1050d8decea53448e026ac534626760',size:300402,
 },
 'preview/cetz/0.5.2':{
  tree:'2f421d8ebcc5554c78a8a641e70bff0e5b8a507a4071b433e46b6243c81b7545',
  archive:'77cf8490114ae04c6e665a11efa691d284a0cadb9719771b5708c1197292f23f',size:218960,
 },
};
export const originalProfile=Object.fromEntries(Object.entries(originalPackages).map(([key,pin])=>[key,pin.tree]));
export const profile=Object.fromEntries(Object.entries(packages).map(([name,pin])=>[name,pin.tree]));
// These are reviewed Typst package trees, including the CeTZ WASM plugin.
// Check bytes before use and compile from private copies to keep inputs stable.
export async function verifyProfile(root:string,destination?:string,selected=profile) {
 if(!root || !path.isAbsolute(root))throw new Error('Set H5P_MCP_TYPST_PACKAGES to the absolute package root containing preview/.');
 const trustedRoot=await fs.realpath(root);
 for(const [pkg,expected] of Object.entries(selected)){
  let base=trustedRoot;
  for(const part of pkg.split('/')){
   base=path.join(base,part);
   if(!(await fs.lstat(base)).isDirectory())throw new Error('Unsupported package directory: '+pkg);
  }
  const records:string[]=[],dirs=[''];
  let members=0,bytes=0;
  while(dirs.length){
   const relative=dirs.pop()!;
   const directory=await fs.opendir(path.join(base,relative));
   for await(const entry of directory){
    if(++members>256)throw new Error('Package entry budget exceeded.');
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory()){dirs.push(name);continue;}
    if(!entry.isFile())throw new Error('Unsupported package entry: '+name);
    const remaining=16*1024*1024-bytes;
    const data=await readBounded(path.join(base,name),Math.min(remaining,8*1024*1024));
    bytes+=data.length;
    records.push(name+'\0'+sha(data)+'\n');
    if(destination){
     const target=path.join(destination,pkg,name);
     await fs.mkdir(path.dirname(target),{recursive:true});
     await fs.writeFile(target,data,{flag:'wx'});
    }
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
   // Only extract archives matching the pinned size and digest.
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
