import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {CoreRequest} from '../domain/types.js';
import {configureLimits,checkTree} from '../domain/limits.js';
import {editorAt} from '../h5p/editor.js';
import {catalog,query} from '../h5p/catalog.js';
import {administer} from '../h5p/administration.js';
import {prepare} from '../h5p/preparation.js';
import {exportActivity} from '../h5p/export.js';
import {validate} from '../h5p/validation.js';
import {preflight} from '../infrastructure/archive.js';
configureLimits(process.env);
/** Internal trusted-host API. Filesystem authorization stays at the host boundary. */
export async function execute(request: CoreRequest): Promise<unknown> {
 checkTree(request);
 if(!path.isAbsolute(request.data_dir)) throw new Error('Absolute data_dir required');
 if(request.action==='inspect-archive'){await preflight(request.path!);return {ok:true};}
 if(request.action==='discover'||request.action==='schema') return query(request);
 if(request.action==='setup') {
  for(const filename of request.packages||[]) await preflight(filename);
  return administer(request);
 }
 if(request.action==='validate') await preflight(request.path!,true);
 const libraries=path.join(request.data_dir,'libraries');
 const job=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-core-'));
 try {
  const editor=await editorAt(job,request.action==='validate'?path.join(job,'libraries'):libraries,request.action==='export');
  if(request.action==='catalog') return {libraries:await catalog(editor),core:editor.config.h5pVersion};
  // Await import before finally removes the job's library and temporary stores.
  if(request.action==='validate') return await validate(editor,request.path!);
  if(request.action!=='prepare'&&request.action!=='export') throw new Error('Unknown action');
  const report=await prepare(editor,request,libraries);
  return request.action==='prepare'?report:await exportActivity(editor,request,libraries,report);
 } finally { await fs.rm(job,{recursive:true,force:true}); }
}
