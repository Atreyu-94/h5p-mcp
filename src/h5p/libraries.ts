import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import type {Native} from '../domain/types.js';
import {checkTree} from '../domain/limits.js';
import {readBounded} from '../infrastructure/read-bounded.js';
import {semanticsCache} from './schema-cache.js';

export interface LibraryVersion {machineName:string;majorVersion:number;minorVersion:number}
/** Read-only installed libraries. Does not create stores, install or contact the Hub. */
export interface LibraryRepository {
 getLibrary(version:LibraryVersion):Promise<Native>;
 getSemantics(version:LibraryVersion):Promise<Native[]>;
 getRuntimeWarnings?(version:LibraryVersion):Promise<string[]>;
}
const invalid=()=>Object.assign(new Error('Invalid library identity or metadata'),{code:'LIBRARY_VERSION_MISMATCH'});
export class FileLibraryRepository implements LibraryRepository {
 constructor(readonly root:string) {if(!path.isAbsolute(root))throw invalid();}
 private async directory(version:LibraryVersion) {
  if(!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(version.machineName)||
   !Number.isSafeInteger(version.majorVersion)||version.majorVersion<0||
   !Number.isSafeInteger(version.minorVersion)||version.minorVersion<0)throw invalid();
  const root=await fs.realpath(this.root);
  const directory=await fs.realpath(path.join(root,`${version.machineName}-${version.majorVersion}.${version.minorVersion}`));
  const relative=path.relative(root,directory);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw invalid();
  return directory;
 }
 private async json(directory:string,name:string) {
  const filename=await fs.realpath(path.join(directory,name));
  if(path.dirname(filename)!==directory)throw invalid();
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(filename,2097152)));
  checkTree(value);return value;
 }
 async getLibrary(version:LibraryVersion) {
  const metadata=await this.json(await this.directory(version),'library.json');
  if(!metadata||Array.isArray(metadata)||metadata.machineName!==version.machineName||
   metadata.majorVersion!==version.majorVersion||metadata.minorVersion!==version.minorVersion||
   !Number.isSafeInteger(metadata.patchVersion)||metadata.patchVersion<0)throw invalid();
  return metadata;
 }
 async getTranslation(version:LibraryVersion,language:string) {
  if(!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language))throw invalid();
  const directory=await this.directory(version),languages=await fs.realpath(path.join(directory,'language'));
  if(path.dirname(languages)!==directory)throw invalid();
  return this.json(languages,language+'.json');
 }
 async getSemantics(version:LibraryVersion) {
  const directory=await this.directory(version);
  await this.getLibrary(version);
  const fields=await this.json(directory,'semantics.json');
  if(!Array.isArray(fields))throw invalid();
  return semanticsCache.get(directory,fields);
 }
 async getRuntimeWarnings(version:LibraryVersion):Promise<string[]> {
  // Match tested bytes, including locally patched libraries with unchanged version metadata.
  const issues:Record<string,{file:string;sha256:string;message:string}>={
   'H5P.Blanks-1.14':{file:'js/blanks.js',sha256:'14b1f355a73a50859b55caa065b38a5adddf023c87672210b5d7e60897603580',
    message:'The checking focus label ignores a11yCheckingModeHeader and can remain in English.'},
   'H5P.QuestionSet-1.21':{file:'js/questionset.js',sha256:'766f5fb176f3e117810dac81a1a43d57b3c74d2a5a7bcd7b20f4d9097e4fde2d',
    message:'Aggregate feedback can be absent from the visible results and its live announcement joins segments without spaces.'},
  };
  const name=`${version.machineName}-${version.majorVersion}.${version.minorVersion}`,issue=issues[name];
  if(!issue)return [];
  const directory=await this.directory(version);
  let filename:string;
  try{filename=await fs.realpath(path.join(directory,issue.file));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const relative=path.relative(directory,filename);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw invalid();
  const digest=createHash('sha256').update(await readBounded(filename,2097152)).digest('hex');
  if(digest!==issue.sha256)return [];
  return [`Library runtime: ${name}/${issue.file} SHA-256 ${digest}. ${issue.message} Check the effective destination library and its maintained update before claiming accessibility.`];
 }
}
