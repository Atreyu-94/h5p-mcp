import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {parse as parseYaml} from 'yaml';
import {limit} from '../domain/limits.js';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {repositoryRoot} from '../infrastructure/runtime.js';
import {readBounded} from '../infrastructure/media.js';
import {failure} from './contracts.js';
import type {Native} from '../domain/types.js';
export const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export const canonical=(value:Native):Native=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;

export const extensionID='io.modelcontextprotocol/skills';
async function loadSkill(slug:string) {
  const texts=new Map<string,{uri:string,name:string,mimeType:string,text:string}>();
  const root=path.join(repositoryRoot,'.agents/skills',slug);
  const names:string[]=JSON.parse(await fs.readFile(path.join(root,'resources.json'),'utf8'));
  if(new Set(names).size!==names.length||!names.includes('SKILL.md')||!names.includes('resources.json'))throw new Error('Invalid skill manifest');
  const prefix='skill://'+slug+'/';
  const resources=[];
  for(const name of names) {
   if(!/^(?:SKILL\.md|resources\.json|references\/[a-z-]+\.md|examples\/[a-z-]+\.(?:json|typ))$/.test(name)) throw new Error('Invalid packaged skill resource');
   const file=slug==='typst-graphics'&&name.startsWith('examples/')?path.join(repositoryRoot,'examples/scientific-figures',name.slice(9)):path.join(root,name);
   const raw=await readBounded(file,262144),uri=prefix+name;
   texts.set(uri,{uri,name,mimeType:name.endsWith('.json')?'application/json':name.endsWith('.typ')?'text/plain':'text/markdown',text:raw.toString('utf8')});
   resources.push({uri,digest:'sha256:'+hash(raw),size:raw.length});
  }
  const text=texts.get(prefix+'SKILL.md')!.text;
  const header=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if(!header) throw new Error('Missing packaged skill frontmatter');
  const frontmatter=parseYaml(header[1]);
  if(frontmatter?.name!==slug||typeof frontmatter.description!=='string') throw new Error('Invalid packaged skill frontmatter');
  return {texts,skill:{uri:prefix+'SKILL.md',frontmatter,resources}};
 }
const loadSkills=()=>Promise.all(['h5p-authoring','typst-graphics'].map(loadSkill));
let packagedSkill:ReturnType<typeof loadSkills>|undefined;
export class Resources {
 texts=new Map<string,{uri:string,name:string,mimeType:string,text:string}>();
 artifacts=new Map<string,{filename:string,size:number,sha256:string,content:Native}>();
 snapshots:string[]=[];
 skills:Native[]=[];
 get skill(){return this.skills[0];}
 async initialize() {
  packagedSkill??=loadSkills().catch(error=>{packagedSkill=undefined;throw error;});
  const loaded=await packagedSkill;
  this.skills=loaded.map(result=>result.skill);
  for(const {texts} of loaded)
  for(const [uri,resource] of texts)this.texts.set(uri,resource);

 }
 snapshot(value:Native) {
  const text=JSON.stringify(canonical(value));
  if(Buffer.byteLength(text)>2097152) throw failure('LIMIT_EXCEEDED');
  const sha256=hash(text),uri='h5p-schema://snapshot/'+sha256;
  if(!this.texts.has(uri)) {
   while(this.snapshots.length>=8) this.texts.delete(this.snapshots.shift()!);
   this.snapshots.push(uri);
   this.texts.set(uri,{uri,name:'Native schema',mimeType:'application/json',text});
  }
  return {uri,sha256,mime_type:'application/json',size:Buffer.byteLength(text),lifetime:'process lifetime; bounded cache'};
 }
 async artifact(filename:string,manifest:Native,content:Native=null) {
  // Registration describes an exported file; only resource reads enforce the inline byte limit.
  const digest=createHash('sha256');let size=0;
  for await(const chunk of createReadStream(filename)){size+=chunk.length;digest.update(chunk);}
  const uri='h5p-artifact://package/'+randomBytes(16).toString('hex');
  const entry={filename,size,sha256:digest.digest('hex'),content};
  while(this.artifacts.size>=limit('ARTIFACTS',128)) this.artifacts.delete(this.artifacts.keys().next().value!);
  this.artifacts.set(uri,entry);
  return {uri,mime_type:'application/zip',size:entry.size,sha256:entry.sha256,manifest};
 }
 async read(uri:string):Promise<Native> {
  const text=this.texts.get(uri);
  if(text) return {contents:[{uri,mimeType:text.mimeType,text:text.text}]};
  const entry=this.artifacts.get(uri);
  if(!entry) throw failure('PERMISSION_DENIED');
  const maximum=limit('RESOURCE_BYTES',16777216);
  if(entry.size>maximum) throw failure('LIMIT_EXCEEDED');
  const bytes=await readBounded(entry.filename,maximum).catch(error=>{
   if(error.code==='ASSET_TOO_LARGE') throw failure('LIMIT_EXCEEDED');
   throw error;
  });
  if(bytes.length!==entry.size||hash(bytes)!==entry.sha256) throw failure('STALE_PREPARATION');
  return {contents:[{uri,mimeType:'application/zip',blob:bytes.toString('base64')}]};
 }
}
