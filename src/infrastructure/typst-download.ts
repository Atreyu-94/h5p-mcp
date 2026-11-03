import {createHash} from 'node:crypto';
export const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');

/** Download a pinned vendor asset. Only the release host uses HTTPS redirects to its CDN. */
export async function downloadPinned(url:string,size:number,digest:string,signal:AbortSignal,release:boolean) {
 const timeout=AbortSignal.any([signal,AbortSignal.timeout(90000)]);
 let current=new URL(url);
 let response=await fetch(current,{redirect:'manual',signal:timeout});
 for(let count=0;[301,302,303,307,308].includes(response.status);count++){
  const location=response.headers.get('location');await response.body?.cancel();
  if(!release||!location||count>=3)throw new Error('Unexpected download redirect.');
  current=new URL(location,current);
  if(current.protocol!=='https:'||current.username||current.password||
   !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(current.host))
   throw new Error('Unapproved release download host.');
  response=await fetch(current,{redirect:'manual',signal:timeout});
 }
 if(!response.ok || !response.body)throw new Error('Cannot download '+url+' (HTTP '+response.status+').');
 if(response.url && new URL(response.url).protocol!=='https:')throw new Error('Expected an HTTPS download.');
 const reader=response.body.getReader(),bytes=Buffer.alloc(size);
 let offset=0;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   if(value.length>size-offset)throw new Error('Unexpected archive size: '+url);
   bytes.set(value,offset);offset+=value.length;
  }
 }finally{await reader.cancel();}
 if(offset!==size||sha(bytes)!==digest)throw new Error('Unverified profile archive or release: '+url);
 return bytes;
}
