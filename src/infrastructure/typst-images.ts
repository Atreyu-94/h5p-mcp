import fs from 'node:fs/promises';

import path from 'node:path';
import {copyRasterTools,rasterArch,rasterBase} from './typst-raster.js';
import {verifyProfile} from './typst-profile.js';
import {runDocker,dockerPath} from './typst-docker.js';
import {readBounded} from './read-bounded.js';

export const imagePolicy='offline-verified-images-v1';
export const sandboxImage='ghcr.io/typst/typst@sha256:032e292249bcd378480cc7c142cfa324b63ef8aadeb88d7e7230320c4c9c422f';
type Arch=ReturnType<typeof rasterArch>;
export interface ImageLock {arch:Arch;compiler:string;raster:string}
const imageId=(value:unknown):value is string=>typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value);
export function checkImageLock(value:unknown):ImageLock{
 if(!value||typeof value!=='object')throw new Error('Missing verified image lock.');
 const lock=value as ImageLock;
 if(Object.keys(lock).length!==3||!['aarch64','x86_64'].includes(lock.arch)||
    !imageId(lock.compiler)||!imageId(lock.raster)||lock.compiler===lock.raster)throw new Error('Invalid verified image lock.');
 return lock;
}
export async function configuredImages(arch:Arch,expected?:ImageLock){
 const file=process.env.H5P_MCP_TYPST_IMAGE_PROFILE;
 if(!file||!path.isAbsolute(file))throw new Error('Configure H5P_MCP_TYPST_IMAGE_PROFILE with the verified host profile.');
 const profile=JSON.parse((await readBounded(file,4096)).toString('utf8'));
 if(profile.policy!==imagePolicy)throw new Error('Unsupported host image profile.');
 const installed=checkImageLock(profile.images);
 if(installed.arch!==arch||expected&&(expected.arch!==arch||expected.compiler!==installed.compiler||expected.raster!==installed.raster))
  throw new Error('Image profile does not match the engine or the editable project. Select its recorded profile.');
 return installed;
}

export async function setupImages(output:string,signal:AbortSignal){
 if(process.env.H5P_MCP_TYPST_ENABLED!=='1'||process.env.H5P_MCP_TYPST_SANDBOX!=='docker')
  throw new Error('Enable the local Docker figure sandbox first.');
 const packages=process.env.H5P_MCP_TYPST_PACKAGES;
 if(!packages||!path.isAbsolute(packages))throw new Error('Configure the scientific package profile before image setup.');
 const build=(args:string[])=>runDocker(args,signal,65536,args[0]==='build');
 const platform=(await build(['info','--format','{{.OSType}} {{.Architecture}}'])).toString().trim().split(' ');
 if(platform[0]!=='linux')throw new Error('A Linux Docker engine is required.');
 const arch=rasterArch(platform[1]);
 const stage=await fs.mkdtemp(path.join(path.dirname(output),'.image-setup-'));
 try{
  const result:ImageLock={arch,compiler:'',raster:''};
  for(const role of ['compiler','raster'] as const){
   const context=path.join(stage,role),folder=role==='compiler'?'packages':'tools';
   await fs.mkdir(context);
   if(role==='compiler')await verifyProfile(packages,path.join(context,folder));
   else await copyRasterTools(process.env.H5P_MCP_TYPST_RASTER_DIR,arch,path.join(context,folder));
   // BuildKit can reuse a COPY cache entry despite different source mtimes. Normalize them
   // so rebuilding after a cache prune can still reproduce the original layer.
   const tree=path.join(context,folder);
   for(const entry of await fs.readdir(tree,{recursive:true}))await fs.utimes(path.join(tree,entry),0,0);
   await fs.utimes(tree,0,0);
   const base=role==='compiler'?sandboxImage:rasterBase;
   await build(['image','inspect','--format','{{.Id}}',base]);
   const iid=path.join(stage,role+'.id');
   // COPY is the only build step. Executable permissions must also work for Windows build contexts.
   await fs.writeFile(path.join(context,'Dockerfile'),'FROM '+base+'\nCOPY --chown=0:0 --chmod=0555 '+folder+'/ /'+folder+'/\n');
   await build(['build','--network=none','--pull=false','--build-arg','SOURCE_DATE_EPOCH=0','--iidfile',await dockerPath(iid,signal),await dockerPath(context,signal)]);
   const id=(await readBounded(iid,128)).toString().trim();
   if(!imageId(id))throw new Error('Invalid Docker build image identifier.');
   const expected=arch==='aarch64'?'linux/arm64':'linux/amd64';
   const actual=(await build(['image','inspect','--format','{{.Os}}/{{.Architecture}}',id])).toString().trim();
   if(actual!==expected)throw new Error('Unexpected verified image platform: '+actual);
   await build(['image','tag',id,'h5p-mcp/typst-'+role+':'+id.slice(7)]);
   result[role]=id;
  }
  const descriptor={policy:imagePolicy,images:result};
  const file=path.join(stage,'profile.json');
  await fs.writeFile(file,JSON.stringify(descriptor,null,2)+'\n');
  signal.throwIfAborted();
  await fs.link(file,output);
  return {ok:true,profile:output,...descriptor};
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}
