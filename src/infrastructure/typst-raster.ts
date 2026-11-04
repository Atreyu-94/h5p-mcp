import fs from 'node:fs/promises';
import path from 'node:path';
import {downloadPinned,sha} from './typst-download.js';
import {readBounded} from './read-bounded.js';

export const rasterPolicy='offline-resvg-oxipng-v1';
export const rasterBase='ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852';
const resvgVersion='0.49.0',oxipngVersion='10.2.1';
const releases={
 x86_64:{
  resvg:{size:1954483,archive:'216637e75e909e53e3098b0875cd5f7da2fdc8b4359771b4a29b539afff9d3f5',binary:'1fc436320a57d0a47709fc43de7b377687e0836c556708e83b79eb1a018d2304'},
  oxipng:{size:528412,archive:'1813750ef592c5350ca79c88f98b2c0876d05c826dc7156245256d4255c1ad17',binary:'df8f3e79e6ef06d8515d4949d19d872ae4e82fe16bc1fe6ad1efe181e3a21780'},
 },
 aarch64:{
  resvg:{size:1827526,archive:'00356cb6984836d7638fe10597a01ec4776b0c356e164538f165eca067f0d982',binary:'d4341fbf5a5601f91f4fccc5fc0d734eabea19de34a2fda4aa99e2405ba5738b'},
  oxipng:{size:492703,archive:'ff21aa2a005b324c8dfbdf13cd2f469fb6728b27dacded82635824ecd12e3b35',binary:'80d7955f81ee1c0279116b528a1675200717568e456d0ad2cf983882ff351fab'},
 },
};
export function rasterArch(value:string){
 if(['amd64','x86_64'].includes(value))return 'x86_64';
 if(['arm64','aarch64'].includes(value))return 'aarch64';
 throw new Error('Unsupported raster engine architecture: '+value);
}
type Arch=keyof typeof releases;
export function rasterLock(arch:Arch){
 return {arch,base:rasterBase,resvg:resvgVersion,resvgSha256:releases[arch].resvg.binary,
  oxipng:oxipngVersion,oxipngSha256:releases[arch].oxipng.binary,level:1};
}
export async function setupRaster(root:string,arch:Arch,signal:AbortSignal){
 if(process.env.H5P_MCP_TYPST_ENABLED!=='1')throw new Error('Enable figures before configuring the rasterizer.');
 const stage=await fs.mkdtemp(path.join(path.dirname(root),'.raster-setup-'));
 try{
  await fs.mkdir(path.join(stage,'tools'));
  for(const name of ['resvg','oxipng'] as const){
   const pin=releases[arch][name],stem='oxipng-'+oxipngVersion+'-'+arch+'-unknown-linux-musl';
   const url=name==='resvg'?'https://github.com/linebender/resvg/releases/download/v'+resvgVersion+'/resvg-linux-'+arch+'.tar.gz':
    'https://github.com/oxipng/oxipng/releases/download/v'+oxipngVersion+'/'+stem+'.tar.gz';
   const archive=await downloadPinned(url,pin.size,pin.archive,signal,true);
   const files=await new Bun.Archive(archive).files();
   const member=files.get(name==='resvg'?'resvg':stem+'/oxipng');
   if(!member||member.size>16*1024*1024)throw new Error('Missing pinned raster executable.');
   const bytes=Buffer.from(await member.arrayBuffer());
   if(sha(bytes)!==pin.binary)throw new Error('Raster executable digest mismatch.');
   await fs.writeFile(path.join(stage,'tools',name),bytes,{mode:0o755,flag:'wx'});
  }
  signal.throwIfAborted();
  await fs.mkdir(root);
  try{await fs.rename(path.join(stage,'tools'),path.join(root,'tools'));}
  catch(error){await fs.rmdir(root);throw error;}
  return {ok:true,root,rasterizer:rasterLock(arch)};
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}
export async function copyRasterTools(root:string|undefined,arch:Arch,target:string){
 if(!root||!path.isAbsolute(root))throw new Error('Set H5P_MCP_TYPST_RASTER_DIR to the installed raster profile.');
 const tools=path.join(await fs.realpath(root),'tools');
 if(!(await fs.lstat(tools)).isDirectory())throw new Error('Invalid raster tool directory.');
 await fs.mkdir(target);
 for(const name of ['resvg','oxipng'] as const){
  const file=path.join(tools,name);
  if(!(await fs.lstat(file)).isFile())throw new Error('Invalid raster executable.');
  const bytes=await readBounded(file,16*1024*1024);
  if(sha(bytes)!==releases[arch][name].binary)throw new Error('Raster executable integrity check failed; run figure raster-setup for this engine.');
  await fs.writeFile(path.join(target,name),bytes,{mode:0o755,flag:'wx'});
 }
}
