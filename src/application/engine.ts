import type {CoreRequest} from '../domain/types.js';
import {checkTree,limit} from '../domain/limits.js';
import {Pool} from '../infrastructure/pool.js';
import {Generations,exclusive} from '../infrastructure/generations.js';
import {isolated} from '../infrastructure/worker.js';
import {publish} from '../infrastructure/publication.js';
export class Engine {
 private pool=new Pool(limit('WORKERS',2),limit('QUEUE',8));
 private generations=new Generations(limit('GENERATIONS',4));
 async run(request:CoreRequest,signal:AbortSignal=AbortSignal.timeout(limit('SECONDS',300)*1000)):Promise<unknown> {
  checkTree(request);
  return this.pool.run(async()=>{
   const mutation=request.action==='setup'||request.refresh||request.install_if_missing;
   if(mutation) return isolated(request,signal);
   if(request.action==='validate') return isolated(request,signal);
   const snapshot=await exclusive(request.data_dir,signal,()=>this.generations.acquire(request.data_dir,signal));
   try {
    const pinned={...request,data_dir:snapshot.root};
    // Keep untrusted semantics/ZIP work killable; persistent queries share the bounded schema cache.
    if(request.action==='export') return await publish(pinned,signal);
    if(request.action==='compile'||request.action==='prepare') return await isolated(pinned,signal);
    // Load query execution only after acquiring the immutable generation.
    const {execute}=await import('./execute.js');
    return await execute(pinned);
   } finally {await snapshot.release();}
  },signal);
 }
 async close(){await this.generations.close();}
}
