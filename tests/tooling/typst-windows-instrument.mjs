import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Instrument a disposable copy of the M6 control (252acf3), without hard links.
const root=path.resolve(process.argv[2]);
assert(path.basename(root)==='trace-core');
async function edit(file,pairs){
 const filename=path.join(root,file);
 let data=await fs.readFile(filename,'utf8');
 for(const [a,b] of pairs){assert.equal(data.split(a).length,2,a);data=data.replace(a,()=>b);}
 await fs.writeFile(filename,data);
}
const timed=(key,expr)=>[expr,`globalThis.timed('${key}',()=>${expr})`];
await edit('cli.js',[["import path from",`globalThis.timed=async(key,fn)=>{const t=performance.now();try{return await fn();}finally{globalThis.stages.push([key,performance.now()-t]);}};
import path from`]]);
const shell='read -r a rest </proc/uptime; "$@"; ret=$?; read -r b rest </proc/uptime; printf "STAGE %s %s\\n" "$a" "$b" >&2; exit "$ret"';
await edit('infrastructure/typst-sandbox.js',[
 ["return runFigureProcess('docker'", "return globalThis.timed('docker.'+args[0],()=>runFigureProcess('docker'"],
 ['maxStdout, timeoutMs: 20000 });','maxStdout, timeoutMs: 20000 }));'],
 ["[sandboxImage, 'compile',","['--entrypoint','/bin/sh',sandboxImage,'-c',"+JSON.stringify(shell)+",'time','/bin/typst','compile',"],
 ["[rasterBase, '/bin/bash',","[rasterBase,'/bin/sh','-c',"+JSON.stringify(shell)+",'time','/bin/bash',"],
 ...[['packages','verifyProfile(configured, packages, selected)'],['tools','copyRasterTools(process.env.H5P_MCP_TYPST_RASTER_DIR, arch, tools)'],['publish','publishFigure(output, files, manifest, signal)'],['cleanup','fs.rm(work, { recursive: true, force: true })']].map(([k,e])=>timed(k,e))
]);
await edit('infrastructure/typst-process.js',[['resolve(Buffer.concat(stdout));',`{
 if(args.includes('--attach')){
 const m=/^STAGE ([0-9.]+) ([0-9.]+)$/m.exec(Buffer.concat(stderr).toString());
 if(!m){reject(new Error('Missing engine timing'));return;}
 const name=globalThis.stages.some(([key])=>key==='inside.typst')?'inside.raster':'inside.typst';
 globalThis.stages.push([name,1000*(Number(m[2])-Number(m[1]))]);
 }
 resolve(Buffer.concat(stdout));
}`]]);
await edit('adapters/service.js',[
 ["const parent = await this.authorize(this.exportDir, 'EXPORT');","globalThis.stages=[];const parent = await this.authorize(this.exportDir, 'EXPORT');"],
 ["const asset = await (await this.vault()).upload('asset', 'image/png'", "const store=performance.now();const asset = await (await this.vault()).upload('asset', 'image/png'"],
 ["return { ok: true, directory, manifest: figure.manifest","globalThis.stages.push(['store',performance.now()-store]);await fs.writeFile(path.join(directory,'timings.json'),JSON.stringify(globalThis.stages));return { ok: true, directory, manifest: figure.manifest"]
]);
