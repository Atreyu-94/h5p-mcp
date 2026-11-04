import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const [baseArg,stagesArg,rasterArg]=process.argv.slice(2);
if(!rasterArg)throw new Error('Usage: node typst-raster-benchmark.mjs <baseline-run> <stage-run> <raster-experiment>');
const out=path.resolve(rasterArg),base=path.resolve(baseArg),bench=path.join(out,'paired');
await fs.mkdir(bench);
const json=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const write=async(f,data)=>fs.writeFile(path.join(bench,f),JSON.stringify(data,null,2)+'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
const exec=promisify(execFile);
const setup=await json(path.join(base,'install.json'));
const prior=await json(path.join(base,'samples/environment.json'));
const baseline=(await json(path.join(base,'samples/summary.json'))).cases;
const stage=(await json(path.join(path.resolve(stagesArg),'summary.json'))).cases;
const image=(await fs.readFile(path.join(out,'image-id.txt'),'utf8')).trim();
assert(/^sha256:[a-f0-9]{64}$/.test(image));
const work=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-raster-bench-'));
const tar=path.join(base,'h5p-mcp-0.1.0.tgz');
assert.equal(hash(await fs.readFile(tar)),setup.tarballSHA256.toLowerCase());
await fs.writeFile(path.join(work,'package.json'),JSON.stringify({private:true,dependencies:{'h5p-mcp':'file:'+tar}}));
await exec('bun',['install','--ignore-scripts','--backend=copyfile'],{cwd:work,windowsHide:true});
const controlPackage=path.join(work,'node_modules/h5p-mcp'),candidatePackage=path.join(work,'node_modules/h5p-raster-experiment');
await fs.cp(controlPackage,candidatePackage,{recursive:true});
const core=path.join(candidatePackage,'dist/core'),direct=path.join(controlPackage,'dist/core/cli.js');
const pristine=path.join(work,'original');
await fs.mkdir(pristine);
await exec('tar',['-xzf',tar,'-C',pristine]);
async function verifyTree(root){
 for(const relative of await fs.readdir(path.join(pristine,'package/dist/core'),{recursive:true})){
  const original=path.join(pristine,'package/dist/core',relative);
  if((await fs.stat(original)).isFile())assert.equal(hash(await fs.readFile(path.join(root,'dist/core',relative))),hash(await fs.readFile(original)),relative);
 }
}
await verifyTree(controlPackage);
await verifyTree(candidatePackage);
async function edit(file,pairs){
 const target=path.join(core,file);let js=await fs.readFile(target,'utf8');
 for(const [old,next] of pairs){assert.equal(js.split(old).length,2,'Unexpected implementation: '+old);js=js.replace(old,()=>next);}
 await fs.writeFile(target,js);
}
// This is an experiment on a separate install. The shipped CLI and image remain untouched.
await edit('infrastructure/typst-page.js',[
 ['async function renderSinglePage(compile)','async function renderSinglePage(compile,rasterize)'],
 ["const png = await compile('png');","const png = rasterize ? await rasterize(svg,maxWidth,maxHeight) : await compile('png');"]
]);
await edit('infrastructure/typst-sandbox.js',[
 ["'--mount', 'type=bind,src=' + packages", "...(format==='png' ? ["+JSON.stringify(image)+",'--dpi','192','--skip-system-fonts','/input/figure.svg','-c'] : ['--mount', 'type=bind,src=' + packages"],
 ["'/input/figure.typ', '-'];","'/input/figure.typ', '-'])];"],
 ["const page = await renderSinglePage(format => compile(root, packages, format, signal));",`
    const page = await renderSinglePage(format => compile(root, packages, format, signal),async svg=>{
      const rasterRoot=path.join(work,'raster-input');
      await fs.mkdir(rasterRoot);
      await fs.writeFile(path.join(rasterRoot,'figure.svg'),svg,{flag:'wx',mode:0o644});
      return compile(rasterRoot,packages,'png',signal);
    });`],
 ["renderPolicy: 'offline-single-page-v1', compiler:", "renderPolicy:'m6-experimental-resvg',rasterImage:"+JSON.stringify(image)+",compiler:"]
]);
const dir=new URL('../../examples/scientific-figures/',import.meta.url);
const cases=await json(new URL('learner-es.json',dir));
for(const c of cases)c.source=await fs.readFile(new URL(c.file,dir),'utf8');
await write('environment.json',{host:os.version(),cpu:os.cpus()[0].model,commit:setup.commit,tarball:setup.tarballSHA256,work,image,
 binSha256:hash(await fs.readFile(path.join(out,'image/resvg'))),archiveSha256:hash(await fs.readFile(path.join(out,'resvg-linux-x86_64.tar.gz'))),
 docker:(await exec('docker',['info','--format','{{.ServerVersion}} / {{.OSType}} / {{.NCPU}} / {{.MemTotal}}'])).stdout.trim()});
await verifyTree(controlPackage);
const sessions={},rows=[],candidateHashes=new Map();
function stats(ms){
 const sorted=ms.toSorted((a,b)=>a-b);
 return {n:ms.length,median:sorted[Math.ceil(sorted.length/2)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]};
}
async function summarize(){
 const result=cases.map(c=>{
  const warm=rows.filter(r=>r.ok&&r.round>0&&r.file===c.file);
  return {file:c.file,priorP95:baseline.find(x=>x.file===c.file).warm.p95Ms,stageP95:stage.find(x=>x.file===c.file).metrics.ms.p95,
   direct:stats(warm.filter(r=>r.variant==='direct').map(r=>r.ms)),raster:stats(warm.filter(r=>r.variant==='raster').map(r=>r.ms))};
 });
 await write('summary.json',{result,failed:rows.filter(r=>!r.ok)});
}
async function sample(c,variant,round){
 const row={file:c.file,variant,round};
 try{
  const start=performance.now();
  const reply=await sessions[variant].callTool({name:'render_typst_figure',arguments:{source:c.source,alt:c.alt}});
  row.ms=performance.now()-start;
  assert(reply.structuredContent?.ok,JSON.stringify(reply.content));
  const r=reply.structuredContent;
  assert.equal(r.manifest.renderPolicy,variant==='direct'?'offline-single-page-v1':'m6-experimental-resvg');
  const svg=await fs.readFile(path.join(r.directory,'figure.svg')),png=await fs.readFile(path.join(r.directory,'figure.png'));
  row.svgHash=hash(svg);row.pngHash=hash(png);row.pngBytes=png.length;
  const ref=baseline.find(x=>x.file===c.file).first;
  assert.equal(row.svgHash,ref.svgHash);
  if(variant==='direct')assert.equal(row.pngHash,ref.pngHash);
  else if(candidateHashes.has(c.file))assert.equal(row.pngHash,candidateHashes.get(c.file));
  else candidateHashes.set(c.file,row.pngHash);
  if(round===0)await fs.writeFile(path.join(bench,c.file+'.'+variant+'.png'),png);
  row.ok=true;
 }catch(e){row.ok=false;row.error=String(e);}
 rows.push(row);await fs.appendFile(path.join(bench,'samples.jsonl'),JSON.stringify(row)+'\n');
 if(!row.ok&&round===0)throw new Error(row.error);
}
try{
 for(const [variant,entry] of [['direct',direct],['raster',path.join(core,'cli.js')]]){
  const client=new Client({name:'m6-raster-ab',version:'1'});
  const env={...process.env,H5P_MCP_TYPST_ENABLED:'1',H5P_MCP_TYPST_SANDBOX:'docker',H5P_MCP_TYPST_PACKAGES:path.join(prior.work,'packages'),
   H5P_MCP_DATA_DIR:path.join(work,variant,'data'),H5P_MCP_STORE_DIR:path.join(work,variant,'store'),H5P_MCP_EXPORT_DIR:path.join(work,variant,'exports')};
  await client.connect(new StdioClientTransport({command:'bun',args:[entry,'stdio'],env,cwd:work,stderr:'pipe'}));
  sessions[variant]=client;
 }
 for(let round=0;round<=30;round++){
  for(let offset=0;offset<cases.length;offset++){
   const c=cases[(round+offset)%cases.length];
   for(const variant of (round+cases.indexOf(c))%2?['direct','raster']:['raster','direct'])await sample(c,variant,round);
  }
  await summarize();console.log('Round',round,'of 30');
 }
}finally{await Promise.all(Object.values(sessions).map(c=>c.close()));await summarize();}
if(rows.some(r=>!r.ok))process.exitCode=1;
