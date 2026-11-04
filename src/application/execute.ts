import path from 'node:path';
import type {CoreRequest} from '../domain/types.js';
import {configureLimits,checkTree} from '../domain/limits.js';

import {preflight} from '../infrastructure/archive.js';
configureLimits(process.env);
/** Internal trusted-host API. Filesystem authorization stays at the host boundary. */
export async function execute(request: CoreRequest): Promise<unknown> {
 checkTree(request);
 if(!path.isAbsolute(request.data_dir)) throw new Error('Absolute data_dir required');
 if(request.action==='compile'){const {compileSource}=await import('./compiler.js');return compileSource(request.source,path.join(request.data_dir,'libraries'));}
 if(request.action==='prepare'||request.action==='export'){const {executeNative}=await import('../h5p/native-content.js');return executeNative({...request,export_mode:request.export_mode??(request.backend==='native-content'?'content-only':'with-libraries')});}
 if(request.action==='inspect-archive'){await preflight(request.path!);return {ok:true};}
 if(request.action==='validate'){const {validatePackage}=await import('../h5p/packages.js');return validatePackage(request.path!,path.join(request.data_dir,'libraries'),request.allow_svg_content);}
 if(request.action==='discover'||request.action==='schema'){const {query}=await import('../h5p/catalog.js');return query(request);}
 if(request.action==='setup'){const {administer}=await import('../h5p/administration.js');return administer(request);}
 if(request.action==='catalog'){const {catalog}=await import('../h5p/catalog.js'),{nativeCatalog}=await import('../h5p/native-catalog.js');return {libraries:await catalog(await nativeCatalog(request.data_dir)),core:'1.28.0'};}
 throw new Error('Unknown action');
}
