import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {profile,sha,verifyProfile} from './typst-profile.js';
import {invoke} from './typst-process.js';
import {managedExecutable,typstVersion} from './typst-compiler.js';
import {load} from './runtime.js';
import {readBounded} from './read-bounded.js';

const version=typstVersion;
const source=`#import "@preview/cetz:0.5.3"
#set page(width: auto, height: auto, margin: 8pt, fill: white)
#set text(size: 12pt)
#let spec = json("figure.json")
#cetz.canvas({
  import cetz.draw: *
  line((0,0), (0,1.6), mark: (end: ">"))
  line((0,0), (0,-1.6), mark: (end: ">"))
  circle((0,0), radius: 0.09, fill: black)
  content((0.25,0.95), anchor: "west", text(spec.upLabel + " = " + str(spec.forceN) + " N"))
  content((0.25,-0.95), anchor: "west", text(spec.downLabel + " = " + str(spec.forceN) + " N"))
})
`;
const failure=(code:string,message:string)=>Object.assign(new Error(message),{code});
type Spec={forceN:number;upLabel:string;downLabel:string;alt:string};
function parseSpec(v:Partial<Spec>|null):Spec {
 const label=(x:unknown,max:number)=>typeof x==='string' && x.trim().length>0 && x.length<=max && !/[\r\n\t]/.test(x);
 if(!v || Object.keys(v).some(k=>!['forceN','upLabel','downLabel','alt'].includes(k)) ||
  typeof v.forceN!=='number'||!Number.isFinite(v.forceN)||v.forceN<=0||v.forceN>1e6||!label(v.upLabel,36)||!label(v.downLabel,36)||!label(v.alt,512))
  throw failure('INVALID_PARAMETER','Expected forceN in (0, 1000000], two short labels and alternative text.');
 return {forceN:v.forceN,upLabel:v.upLabel!,downLabel:v.downLabel!,alt:v.alt!};
}

export async function figureStatus(signal?:AbortSignal) {
 if(process.env.H5P_MCP_TYPST_ENABLED!=='1')return {state:'disabled'} as const;
 const explicit=process.env.H5P_MCP_TYPST_BIN;
 if(explicit && !path.isAbsolute(explicit))throw failure('INVALID_PARAMETER','H5P_MCP_TYPST_BIN must be absolute.');
 const provider=process.env.H5P_MCP_TYPST_PROVIDER||'system';
 if(!explicit && !['managed','system'].includes(provider))throw failure('INVALID_PARAMETER','Expected managed or system compiler provider.');
 const managed=provider==='managed' && !explicit;
 let executable:string|null;
 try{executable=explicit||(managed?await managedExecutable():Bun.which('typst'));}
 catch(error){return {state:'unavailable',reason:(error as Error).message} as const;}
 if(!executable)return {state:'missing'} as const;
 let detected:string;
 try{detected=(await invoke(executable,['--version'],signal)).trim();}
 catch(error){
  if(signal?.aborted)throw error;
  if((error as NodeJS.ErrnoException).code==='ENOENT')return {state:'missing',executable} as const;
  return {state:'unavailable',executable} as const;
 }
 if(detected.split(/\s+/).slice(0,2).join(' ')!=='typst '+version)return {state:'incompatible',detected,expected:version} as const;
 const packages=process.env.H5P_MCP_TYPST_PACKAGES||'';
 try{await verifyProfile(packages);}
 catch(error){return {state:'profile-incomplete',reason:(error as Error).message} as const;}
 return {state:'ready',provider:explicit?'explicit':provider,executable,detected,packages} as const;
}

export async function renderForceFigure(input:string,output:string,signal?:AbortSignal) {
 return renderForceSpec(JSON.parse((await readBounded(input,8192)).toString('utf8')),output,signal);
}

export async function renderForceSpec(input:Partial<Spec>,output:string,signal?:AbortSignal) {
 const spec=parseSpec(input);
 const status=await figureStatus(signal);
 if(status.state!=='ready')throw failure('RENDERER_UNAVAILABLE','Typst status: '+status.state+'; run figure status for details.');
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-figure-'));
 try{
  const root=path.join(work,'source'),packages=path.join(work,'packages'),cache=path.join(work,'cache');
  await fs.mkdir(root);await fs.mkdir(cache);
  await verifyProfile(status.packages,packages);
  const json=JSON.stringify(spec,null,2)+'\n';
  await fs.writeFile(path.join(root,'figure.typ'),source);await fs.writeFile(path.join(root,'figure.json'),json);
  const files:Record<string,Buffer>={'figure.typ':Buffer.from(source),'figure.json':Buffer.from(json)};
  for(const ext of ['svg','png']){
   const name='figure.'+ext, target=path.join(work,name);
   await invoke(status.executable,['compile','--root',root,'--package-path',packages,'--package-cache-path',cache,
    '--ignore-system-fonts','--creation-timestamp','0','--ppi','192',path.join(root,'figure.typ'),target],signal);
   files[name]=await readBounded(target,4*1024*1024);
  }
  // Dimensions are an output check for this fixed template, not a policy for arbitrary SVG uploads.
  const probe=load('probe-image-size').sync;
  const png=probe(files['figure.png']),svg=probe(files['figure.svg']);
  if(png?.type!=='png'||png.width<=0||png.height<=0||png.width*png.height>16000000)
   throw failure('INVALID_OUTPUT','Invalid PNG dimensions.');
  if(svg?.type!=='svg'||svg.wUnits!=='pt'||svg.hUnits!=='pt'||!Number.isFinite(svg.width+svg.height)||svg.width<=0||svg.height<=0)
   throw failure('INVALID_OUTPUT','Invalid SVG dimensions.');
  const {width,height}=png;
  const manifest={version:1,template:'vertical-equilibrium',compiler:status.detected,
   compilerSha256:sha(await readBounded(status.executable,128*1024*1024)),packages:profile,fonts:'embedded',ppi:192,
   image:{path:'figure.png',mime:'image/png',width,height,alt:spec.alt},master:{path:'figure.svg',mime:'image/svg+xml',width:svg.width,height:svg.height,unit:'pt'},
   hashes:Object.fromEntries(Object.entries(files).map(([name,data])=>[name,sha(data)]))};
  files['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  signal?.throwIfAborted();
  await fs.mkdir(output); // Exclusive claim; preserve any existing destination.
  const created:string[]=[];
  try{
   for(const [name,data] of Object.entries(files)){
    const target=path.join(output,name),file=await fs.open(target,'wx');created.push(target);
    try{await file.writeFile(data);}finally{await file.close();}
   }
  }catch(error){for(const target of created)await fs.unlink(target);await fs.rmdir(output);throw error;}
  return {ok:true,directory:output,manifest};
 }finally{await fs.rm(work,{recursive:true,force:true});}
}
