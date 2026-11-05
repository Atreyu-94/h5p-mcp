import pMap from 'p-map';

/** Drain started I/O before callers release a lease or remove staging. */
export async function mapFiles<T,R>(items:readonly T[],work:(item:T)=>Promise<R>,signal?:AbortSignal):Promise<R[]> {
 signal?.throwIfAborted();
 let failure:{error:unknown}|undefined;
 try {
  const values=await pMap(items,async item=>{
   if(failure)throw failure.error;
   try{signal?.throwIfAborted();return await work(item);}
   catch(error){failure??={error};throw error;}
  },{concurrency:8,stopOnError:false});
  signal?.throwIfAborted();return values;
 }catch(error){throw failure?failure.error:error;}
}
