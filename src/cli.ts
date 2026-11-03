#!/usr/bin/env bun
import path from 'node:path';
import {stdio} from './adapters/stdio.js';
import {Service} from './adapters/service.js';
import {readBounded} from './infrastructure/media.js';
import {parseSource,type SourceLocation} from './infrastructure/source-document.js';
import {report} from './adapters/contracts.js';
import {freezeSource,rebuildSource} from './application/source-project.js';
const [command,...args]=process.argv.slice(2);
try {
 if(command==='stdio') await stdio();
 else if(command==='figure') {
  const {figureStatus,renderForceFigure}=await import('./infrastructure/typst-figure.js');
  const controller=new AbortController(),abort=()=>controller.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
   if(args.length===1 && args[0]==='status')console.log(JSON.stringify(await figureStatus(controller.signal)));
   else if(args.length===1 && ['install','repair','remove'].includes(args[0])){
    const {installCompiler,removeCompiler}=await import('./infrastructure/typst-compiler.js');
    console.log(JSON.stringify(args[0]==='remove'?await removeCompiler(controller.signal):await installCompiler(controller.signal,args[0]==='repair')));
   }
   else if((args.length===2 && args[0]==='setup')||(args.length===3 && ['force','rebuild'].includes(args[0]))){
    const service=new Service();
    try{
     await service.initialize();
     const output=await service.authorize(path.resolve(args.at(-1)!),'EXPORT');
     if(args[0]==='setup'){
      const {setupFigureProfile}=await import('./infrastructure/typst-profile.js');
      console.log(JSON.stringify(await setupFigureProfile(output,controller.signal)));
     }else if(args[0]==='rebuild'){
      const root=await service.authorize(path.resolve(args[1]),'ASSET');
      const input=async(name:string,max:number)=>{
       const filename=await service.authorize(path.join(root,name),'ASSET');
       if(path.dirname(filename)!==root)throw new Error('Figure project file outside project directory.');
       return new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(filename,max));
      };
      const manifest=JSON.parse(await input('manifest.json',65536));
      const {renderTypstFigure,checkFigureProject}=await import('./infrastructure/typst-sandbox.js');
      const lockedProfile=checkFigureProject(manifest);
      const source=await input('figure.typ',65536);
      console.log(JSON.stringify(await renderTypstFigure({source,alt:manifest.image?.alt},output,controller.signal,lockedProfile)));
     }else{
      const input=await service.authorize(path.resolve(args[1]),'ASSET');
      console.log(JSON.stringify(await renderForceFigure(input,output,controller.signal)));
     }
    }finally{await service.close();}
   }
   else throw new Error('Use figure status, figure install|repair|remove, figure setup <new-package-root> or figure force <spec.json> <new-directory> | figure rebuild <figure-project> <new-directory>');
  }catch(error){console.error(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}));process.exitCode=1;}
  finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);}
 }
 else if(command==='http') {
  const {config}=await import('./http/auth.js'),{http}=await import('./http/server.js');
  const settings=config(JSON.parse((await readBounded(args[0],65536)).toString('utf8'))),app=http(settings);
  const listener=Bun.serve({hostname:'127.0.0.1',port:settings.port,maxRequestBodySize:134217728,idleTimeout:255,fetch:app.fetch});
  console.error(JSON.stringify({event:'http_ready',host:'127.0.0.1',port:listener.port}));
  let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();await listener.stop(true);};
  process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
 }
 else if(command==='--help'||!command) console.log('h5p-mcp stdio | http <host-config.json> | validate <file.h5p> | export <activity.json> <output-name> | compile/check <source.json|yaml> | build <source.json|yaml> <output-name> | freeze <source.json|yaml> <new-directory> [--figure <asset-id> <figure-project>] | rebuild <project-directory> <output-name> | figure status | figure install|repair|remove | figure setup <new-package-root> | figure force <spec.json> <new-directory> | figure rebuild <figure-project> <new-directory> | admin <refresh|install|package> [name|path]');
 else {
  const service=new Service();await service.initialize();
  try {
   if(command==='freeze'||command==='rebuild'){
    let result;
    if(command==='freeze'){
     const filename=path.resolve(args[0]),{source}=parseSource(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(filename,16777216)),/\.ya?ml$/i.test(filename)?'yaml':'json');
     if(source?.assets&&typeof source.assets==='object')for(const [id,file] of Object.entries(source.assets))if(typeof file==='string')source.assets[id]=path.resolve(path.dirname(filename),file);
     const figures:Record<string,string>=Object.create(null);
     for(let i=2;i<args.length;i+=3){
      const [flag,id,bundle]=args.slice(i,i+3);
      if(flag!=='--figure'||!id||!bundle||Object.hasOwn(figures,id))throw new Error('Expected --figure <asset-id> <figure-project>.');
      figures[id]=path.resolve(bundle);
     }
     result=await freezeSource(source,await service.vault(),await service.authorize(path.resolve(args[1]),'EXPORT'),file=>service.authorize(file,'ASSET'),figures);
    }else{
     const directory=await service.authorize(path.resolve(args[0]),'PACKAGE'),compiled=await rebuildSource(directory);
     const destination=await service.destination(args[1]);
     await service.run('export',{data_dir:path.join(directory,'data'),backend:'native-content',activity:compiled.activity,path:destination},AbortSignal.timeout(300000));
     result={...report('export',true,[],{structure:'passed',semantics:'passed'}),export_mode:'content-only',reconstruction:'exact',artifact:await service.resources.artifact(destination,{preparation:compiled.activity.preparation,export_mode:'content-only'})};
    }
    console.log(JSON.stringify(result));
   }else{
   let name:string,input:unknown,locations:Record<string,SourceLocation>|undefined;
   if(['compile','check','build'].includes(command)) {
    const filename=path.resolve(args[0]),parsed=parseSource(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(filename,16777216)),/\.ya?ml$/i.test(filename)?'yaml':'json'),source=parsed.source;
    locations=parsed.locations;
    if(source&&typeof source==='object'&&source.assets&&typeof source.assets==='object'&&!Array.isArray(source.assets))for(const [id,file] of Object.entries(source.assets))if(typeof file==='string')source.assets[id]=path.resolve(path.dirname(filename),file);
    name=({compile:'compile_h5p_source',check:'check_h5p_source',build:'build_h5p_source'} as Record<string,string>)[command];
    input={source,...(command==='build'?{output_name:args[1]}:{})};
   }
   else if(command==='validate') {name='validate_h5p_package';input={path:args[0]};}
   else if(command==='export') {name='export_h5p_activity';input={activity:JSON.parse((await readBounded(args[0],16777216)).toString('utf8')),output_name:args[1]};}
   else if(command==='admin') {
    name=({refresh:'refresh_h5p_catalog',install:'install_h5p_library',package:'install_h5p_library_package'} as Record<string,string>)[args[0]];
    input=args[0]==='refresh'?{}:args[0]==='install'?{machine_name:args[1]}:{path:args[1]};
   } else throw new Error('Unknown command; use --help');
   const reply=await service.call(name,input);
   if(locations)reply.structuredContent.source_locations=Object.fromEntries((reply.structuredContent.diagnostics||[]).map((item:{pointer:string})=>{
    let pointer=item.pointer;while(!locations![pointer]&&pointer)pointer=pointer.slice(0,pointer.lastIndexOf('/'));
    return [item.pointer,locations![pointer]];
   }));
   await new Promise<void>((resolve,reject)=>process.stdout.write(JSON.stringify(reply.structuredContent)+'\n',error=>error?reject(error):resolve()));
   if(reply.structuredContent.ok===false) process.exitCode=1;
   }
  } finally {await service.close();}
 }
} catch(error:any) {if(error.code)console.log(JSON.stringify({...report('validation',false,error.details||[{code:error.code,stage:'source',reason:'structure'}]),...(error.source_locations?{source_locations:error.source_locations}:{})}));else console.error('H5P command failed; verify arguments and host configuration.');process.exitCode=1;}
