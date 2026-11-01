#!/usr/bin/env bun
import path from 'node:path';
import {stdio} from './adapters/stdio.js';
import {Service} from './adapters/service.js';
import {readBounded} from './infrastructure/media.js';
const [command,...args]=process.argv.slice(2);
try {
 if(command==='stdio') await stdio();
 else if(command==='http') {
  const {config}=await import('./http/auth.js'),{http}=await import('./http/server.js');
  const settings=config(JSON.parse((await readBounded(args[0],65536)).toString('utf8'))),app=http(settings);
  const listener=Bun.serve({hostname:'127.0.0.1',port:settings.port,maxRequestBodySize:134217728,idleTimeout:255,fetch:app.fetch});
  console.error(JSON.stringify({event:'http_ready',host:'127.0.0.1',port:listener.port}));
  let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();await listener.stop(true);};
  process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
 }
 else if(command==='--help'||!command) console.log('h5p-mcp stdio | http <host-config.json> | validate <file.h5p> | export <activity.json> <output-name> | compile/check <source.json> | build <source.json> <output-name> | admin <refresh|install|package> [name|path]');
 else {
  const service=new Service();await service.initialize();
  try {
   let name:string,input:unknown;
   if(['compile','check','build'].includes(command)) {
    const filename=path.resolve(args[0]),source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(filename,16777216)));
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
   await new Promise<void>((resolve,reject)=>process.stdout.write(JSON.stringify(reply.structuredContent)+'\n',error=>error?reject(error):resolve()));
   if(reply.structuredContent.ok===false) process.exitCode=1;
  } finally {await service.close();}
 }
} catch {console.error('H5P command failed; verify arguments and host configuration.');process.exitCode=1;}
