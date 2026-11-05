import {expect,test} from 'bun:test';
import {mapFiles} from '../../src/infrastructure/file-work.js';

test.each(['failure','abort'])('file work drains active tasks on %s before returning',async mode=>{
 const gates=Array.from({length:8},()=>Promise.withResolvers<number>());
 const started=Promise.withResolvers<void>(),abort=new AbortController();
 const problem=Object.assign(new Error('disk full'),{code:'ENOSPC'});
 let active=0,count=0,settled=false;
 const result=mapFiles(Array.from({length:20},(_,i)=>i),async i=>{
  active++;count++;if(count===8)started.resolve();
  try{return await gates[i].promise;}finally{active--;}
 },abort.signal).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 await started.promise;expect(active).toBe(8);
 if(mode==='failure')gates[0].reject(problem);else {abort.abort(problem);gates[0].resolve(0);}
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(settled).toBe(false);expect(count).toBe(8);
 for(let i=1;i<8;i++)gates[i].resolve(i);
 expect(await result).toBe(problem);expect(active).toBe(0);expect(count).toBe(8);
});

test('file work replenishes slots without batch barriers and preserves input order',async()=>{
 const slow=Promise.withResolvers<number>(),ninth=Promise.withResolvers<void>();
 const result=mapFiles(Array.from({length:9},(_,i)=>i),async i=>{
  if(i===0)return slow.promise;
  if(i===8)ninth.resolve();return i;
 });
 await ninth.promise;slow.resolve(0);
 expect(await result).toEqual(Array.from({length:9},(_,i)=>i));
});
