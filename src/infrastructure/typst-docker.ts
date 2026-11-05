import {runFigureProcess} from './typst-process.js';

/** Windows uses the CLI inside WSL; no Desktop pipe or TCP daemon is required. */
export function dockerCommand(args:string[]) {
 if(process.platform!=='win32')return {executable:'docker',args:['--host','unix:///var/run/docker.sock',...args]};
 const distro=process.env.H5P_MCP_DOCKER_WSL_DISTRO||'Ubuntu';
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(distro))throw new Error('Invalid Docker WSL distribution.');
 return {executable:'wsl.exe',args:['--distribution',distro,'--exec','/usr/bin/docker','--host','unix:///var/run/docker.sock',...args]};
}

export function runDocker(args:string[],signal?:AbortSignal,maxStdout=65536,build=false){
 const command=dockerCommand(args);
 return runFigureProcess(command.executable,command.args,signal,{maxStdout,timeoutMs:build?180000:20000,dockerBuild:build});
}

export async function dockerPath(value:string,signal?:AbortSignal){
 if(process.platform!=='win32')return value;
 const command=dockerCommand([]);
 const result=await runFigureProcess(command.executable,[...command.args.slice(0,3),'wslpath','-a','-u',value],signal);
 const translated=result.toString('utf8').trim();
 if(!translated.startsWith('/')||/[,"\r\n]/.test(translated))throw new Error('Unsupported Docker mount path.');
 return translated;
}
