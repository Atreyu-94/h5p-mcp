import {expect,test} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {dockerCommand,dockerPath,runDocker} from '../../src/infrastructure/typst-docker.js';
import {runFigureProcess} from '../../src/infrastructure/typst-process.js';

test('Docker cancellation rejects before starting the transport',async()=>{
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 await expect(runDocker(['info'],controller.signal)).rejects.toThrow('cancelled');
});

test.skipIf(process.platform!=='win32')('Windows rejects invalid WSL distribution configuration',()=>{
 const previous=process.env.H5P_MCP_DOCKER_WSL_DISTRO;
 try{
  process.env.H5P_MCP_DOCKER_WSL_DISTRO='--exec';
  expect(()=>dockerCommand(['info'])).toThrow('Invalid Docker WSL distribution');
 }finally{
  if(previous===undefined)delete process.env.H5P_MCP_DOCKER_WSL_DISTRO;else process.env.H5P_MCP_DOCKER_WSL_DISTRO=previous;
 }
});

test.skipIf(process.platform!=='win32'||process.env.H5P_TEST_TYPST_DOCKER!=='1')('WSL paths preserve spaces and Unicode without shell interpretation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p WSL á '));
 try{
  const file=path.join(root,'literal $(echo surprise).txt');await fs.writeFile(file,'exact bytes');
  const translated=await dockerPath(file),command=dockerCommand([]);
  const bytes=await runFigureProcess(command.executable,[...command.args.slice(0,3),'/bin/cat',translated]);
  expect(bytes.toString()).toBe('exact bytes');
  await expect(dockerPath(path.join(root,'comma,name'))).rejects.toThrow('Unsupported Docker mount path');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
