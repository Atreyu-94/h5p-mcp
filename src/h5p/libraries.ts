import fs from 'node:fs/promises';
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
}
