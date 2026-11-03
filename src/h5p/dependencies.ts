import type {Activity,Native} from '../domain/types.js';
import {checkTree,limit} from '../domain/limits.js';
import type {LibraryRepository,LibraryVersion} from './libraries.js';

export function libraryVersion(name:string):LibraryVersion {
 const match=/^([A-Za-z][A-Za-z0-9_.-]*) ([0-9]+)\.([0-9]+)$/.exec(name);
 if(!match)throw Object.assign(new Error('Invalid exact library version'),{code:'LIBRARY_VERSION_MISMATCH'});
 const majorVersion=Number(match[2]),minorVersion=Number(match[3]);
 if(!Number.isSafeInteger(majorVersion)||!Number.isSafeInteger(minorVersion))throw Object.assign(new Error('Invalid exact library version'),{code:'LIBRARY_VERSION_MISMATCH'});
 return {machineName:match[1],majorVersion,minorVersion};
}
export interface LibraryNode {version:LibraryVersion;metadata:Native;dependencies:{preloaded:string[];dynamic:string[];editor:string[]}}
/** Resolve installation closure while retaining runtime/editor dependency distinctions. */
export async function resolveLibraries(repository:LibraryRepository,activity:Pick<Activity,'library'|'params'>,mathematics=false) {
 checkTree(activity.params);
 const nodes=new Map<string,LibraryNode>(),visiting=new Set<string>();let edges=0;
 async function add(name:string,depth:number):Promise<void> {
  if(visiting.has(name))throw new Error('Cyclic library dependency');
  if(depth>limit('DEPENDENCY_DEPTH',32))throw new Error('Library dependency depth budget exceeded');
  if(nodes.has(name))return;
  if(nodes.size>=limit('LIBRARIES',1000))throw new Error('Library node budget exceeded');
  const version=libraryVersion(name),metadata=await repository.getLibrary(version);
  const dependencies:LibraryNode['dependencies']={preloaded:[],dynamic:[],editor:[]};
  nodes.set(name,{version,metadata,dependencies});visiting.add(name);
  for(const [field,kind] of [['preloadedDependencies','preloaded'],['dynamicDependencies','dynamic'],['editorDependencies','editor']] as const) {
   const list=metadata[field]??[];
   if(!Array.isArray(list))throw new Error('Invalid library dependencies');
   for(const dependency of list) {
    if(++edges>limit('DEPENDENCY_EDGES',5000))throw new Error('Library edge budget exceeded');
    if(!dependency||typeof dependency.machineName!=='string'||!Number.isSafeInteger(dependency.majorVersion)||dependency.majorVersion<0||!Number.isSafeInteger(dependency.minorVersion)||dependency.minorVersion<0)throw new Error('Invalid library dependency');
    const child=`${dependency.machineName} ${dependency.majorVersion}.${dependency.minorVersion}`;
    dependencies[kind].push(child);await add(child,depth+1);
   }
  }
  visiting.delete(name);
 }
 await add(activity.library,0);
 const pending:Native[]=[activity.params];
 while(pending.length) {
  const value=pending.pop();if(!value||typeof value!=='object')continue;
  if(typeof value.library==='string'&&value.params)await add(value.library,0);
  pending.push(...Object.values(value));
 }
 if(mathematics)await add('H5P.MathDisplay 1.0',0);
 return nodes;
}

/** Libraries that the player must load, independently of the editor installation closure. */
export function runtimeDependencies(graph:Map<string,LibraryNode>,activity:Pick<Activity,'library'|'params'>,mathematics:boolean){
  const preloaded=new Set<string>(),dynamic=new Set<string>();
  function runtime(name:string,kind:'preloaded'|'dynamic') {
   const set=kind==='preloaded'?preloaded:dynamic;if(set.has(name))return;set.add(name);
   const node=graph.get(name)!;
   for(const child of node.dependencies.preloaded)runtime(child,kind);
   for(const child of node.dependencies.dynamic)runtime(child,'dynamic');
  }
  runtime(activity.library,'preloaded');
  const stack:Native[]=[activity.params];
  while(stack.length){const value=stack.pop();if(!value||typeof value!=='object')continue;if(typeof value.library==='string'&&value.params)runtime(value.library,'preloaded');stack.push(...Object.values(value));}
  if(mathematics)runtime('H5P.MathDisplay 1.0','preloaded');
  return {preloaded,dynamic};
}
