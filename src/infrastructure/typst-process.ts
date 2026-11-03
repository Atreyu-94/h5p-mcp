import {spawn} from 'node:child_process';

export async function runFigureProcess(executable:string,args:string[],signal?:AbortSignal,maxStdout=65536,timeoutMs=15000):Promise<Buffer> {
 signal?.throwIfAborted();
 // Only run the selected CLI, without inheriting Typst package/font overrides.
 const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH};
 const child=spawn(executable,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 return new Promise((resolve,reject)=>{
  const stdout:Buffer[]=[],stderr:Buffer[]=[];
  let stdoutBytes=0,stderrBytes=0,problem:Error|undefined;
  const stop=(reason:Error)=>{problem??=reason;child.kill('SIGKILL');};
  child.stdout.on('data',(chunk:Buffer)=>{
   stdoutBytes+=chunk.length;
   if(stdoutBytes>maxStdout)stop(new Error('Figure process output budget exceeded.'));
   else stdout.push(chunk);
  });
  child.stderr.on('data',(chunk:Buffer)=>{
   stderrBytes+=chunk.length;
   if(stderrBytes>65536)stop(new Error('Figure process diagnostic budget exceeded.'));
   else stderr.push(chunk);
  });
  const abort=()=>stop(new Error('Figure process cancelled.'));
  const timer=setTimeout(()=>stop(new Error('Figure process timed out.')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',error=>{problem??=error;});
  // Wait for exit and closed pipes before removing the private compilation root.
  child.once('close',code=>{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(problem)reject(problem);
   else if(code!==0)reject(new Error('Figure process failed: '+Buffer.concat(stderr).toString('utf8').trim()));
   else resolve(Buffer.concat(stdout));
  });
 });
}

export async function invoke(executable:string,args:string[],signal?:AbortSignal) {
 return (await runFigureProcess(executable,args,signal)).toString('utf8');
}
