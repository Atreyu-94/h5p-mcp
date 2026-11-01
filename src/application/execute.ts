import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {CoreRequest} from '../domain/types.js';
import {configureLimits,checkTree} from '../domain/limits.js';

import {preflight} from '../infrastructure/archive.js';
configureLimits(process.env);
/** Internal trusted-host API. Filesystem authorization stays at the host boundary. */
export async function execute(request: CoreRequest): Promise<unknown> {
 checkTree(request);
 if(!path.isAbsolute(request.data_dir)) throw new Error('Absolute data_dir required');
 if(request.action==='compile'){const {compileSource}=await import('./compiler.js');return compileSource(request.source,path.join(request.data_dir,'libraries'));}
 if(request.backend==='native-content'){const {executeNative}=await import('../h5p/native-content.js');return executeNative(request);}
 if(request.action==='inspect-archive'){await preflight(request.path!);return {ok:true};}
 if(request.action==='validate'){const {validatePackage}=await import('../h5p/packages.js');return validatePackage(request.path!);}
 if(request.action==='discover'||request.action==='schema'){const {query}=await import('../h5p/catalog.js');return query(request);}
 if(request.action==='setup'){const {administer}=await import('../h5p/administration.js');return administer(request);}
 if(request.action==='catalog'){const {catalog}=await import('../h5p/catalog.js'),{nativeCatalog}=await import('../h5p/native-catalog.js');return {libraries:await catalog(await nativeCatalog(request.data_dir)),core:'1.28.0'};}
 const {editorAt}=await import('../h5p/editor.js');

 const {prepare}=await import('../h5p/preparation.js');
 const {exportActivity}=await import('../h5p/export.js');

 const libraries=path.join(request.data_dir,'libraries');
 const job=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-core-'));
 try {
  const editor=await editorAt(job,libraries,request.action==='export');

  // Legacy prepare/export remain until the transport migration.

  if(request.action!=='prepare'&&request.action!=='export') throw new Error('Unknown action');
  const report=await prepare(editor,request,libraries);
  return request.action==='prepare'?report:await exportActivity(editor,request,libraries,report);
 } finally { await fs.rm(job,{recursive:true,force:true}); }
}
