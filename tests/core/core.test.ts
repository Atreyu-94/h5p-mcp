import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pool} from '../../src/infrastructure/pool.js';
import {Generations,exclusive} from '../../src/infrastructure/generations.js';
import {SemanticsCache} from '../../src/h5p/schema-cache.js';
import {scalarErrors} from '../../src/domain/semantics.js';
import {configureLimits,checkTree} from '../../src/domain/limits.js';
import {pointer} from '../../src/domain/diagnostics.js';
import {containsLatex} from '../../src/h5p/math.js';
import {projectSemantics} from '../../src/domain/contracts.js';
test('native projection preserves flattened groups, dynamic options and extensions',()=>{
 const raw=[{name:'feedback',type:'group',fields:[{name:'answer',type:'library',options:['H5P.Test 1.0'],widget:'x'}]}];
 const projected=projectSemantics(raw);
 expect(projected.fields[0].value_shape).toBe('single_field');
 expect(projected.sublibraries).toEqual(['H5P.Test 1.0']);
 expect(projected.fields[0].fields[0]['x-h5p']).toEqual({widget:'x'});
 expect(raw[0].fields[0].widget).toBe('x');
});
test('portable pure rules preserve exact decimals, pointers and tree budgets',()=>{
 expect(scalarErrors({type:'number',decimals:2},1.23)).toEqual([]);
 expect(scalarErrors({type:'number',decimals:1},1.23)).toHaveLength(1);
 expect(scalarErrors({type:'text',widget:'html',maxLength:1},'<p>x</p>')).toEqual([]);
 expect(pointer(['a/b','~x',0])).toBe('/a~1b/~0x/0');
 expect(containsLatex({text:'\\(x\\)'})).toBe(true);
 configureLimits({H5P_MCP_MAX_NODES:'2'});
 expect(()=>checkTree([1,2])).toThrow();
 configureLimits({});
});
test('package text patterns cannot backtrack and retain search, flags and sticky matching',()=>{
 const check=(pattern:string,value:string,modifiers='')=>scalarErrors({type:'text',regexp:{pattern,modifiers}},value);
 expect(check('^(a+)+$','a'.repeat(64000)+'!')).toEqual(['text does not match regexp']);
 expect(check('^(a+)+$','aaa')).toEqual([]);
 expect(check('abc','xABC','ig')).toEqual([]);
 expect(check('abc','xabc','y')).toHaveLength(1);
 expect(check('abc','abcX','y')).toEqual([]);
 expect(check('(a)\\1','aa')).toEqual(['unsupported or invalid schema regexp']);
 expect(check('(?=a)a','a')).toEqual(['unsupported or invalid schema regexp']);
 expect(check('a'.repeat(2049),'a')).toEqual(['unsupported or invalid schema regexp']);
});
test('schema compilation separates generation, digest and compiler; enforces bounds',()=>{
 const cache=new SemanticsCache(2,1024,2048), fields=[{type:'text',regexp:{pattern:'^x$',modifiers:'g'}}];
 const a=cache.get('one',fields);
 expect(cache.get('one',fields)).toBe(a);
 expect(scalarErrors(a[0],'x')).toEqual([]);
 expect(scalarErrors(a[0],'x')).toEqual([]);
 expect(Object.isFrozen(a[0])).toBe(true);
 expect(cache.get('two',fields)).not.toBe(a);
 expect(cache.get('two',fields,'native-v2')).not.toBe(a);
 expect(cache.size).toBe(2);
 expect(cache.get('one',fields)).not.toBe(a);
 expect(()=>new SemanticsCache(1,2).get('x',fields)).toThrow();
 cache.clear();expect(cache.size).toBe(0);
});
test('pool bounds admission and releases cancelled waiters',async()=>{
 const pool=new Pool(1,1),controller=new AbortController();
 let release!:()=>void;
 const active=pool.run(()=>new Promise<void>(resolve=>{release=resolve;}),new AbortController().signal);
 const queued=pool.run(async()=>42,controller.signal);
 const assertion=queued.then(()=>false,()=>true);
 await expect(pool.run(async()=>0,new AbortController().signal)).rejects.toThrow('Queue full');
 controller.abort();expect(await assertion).toBe(true);
 release();await active;
 expect(pool.running).toBe(0);expect(pool.queued).toBe(0);
});
test('immutable generations survive writer changes and active generations are not evicted',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'h5p-generation-test-')),generations=new Generations(1);
 try {
  await mkdir(path.join(root,'libraries'));
  await writeFile(path.join(root,'libraries','a'),'one');
  const first=await exclusive(root,new AbortController().signal,()=>generations.acquire(root));
  await exclusive(root,new AbortController().signal,()=>writeFile(path.join(root,'libraries','a'),'two'));
  expect(await readFile(path.join(first.root,'libraries','a'),'utf8')).toBe('one');
  await expect(generations.acquire(root)).rejects.toThrow('capacity');
  await first.release();
  const second=await generations.acquire(root);
  expect(await readFile(path.join(second.root,'libraries','a'),'utf8')).toBe('two');
  await second.release();
  await writeFile(path.join(root,'config.json'),'{"unexpected":"oversized"}');
  configureLimits({H5P_MCP_MAX_JSON_BYTES:'8'});
  try {await expect(generations.acquire(root)).rejects.toThrow('budget');}
  finally {configureLimits({});}
  const controller=new AbortController();
  await mkdir(path.join(root,'.core-lock'));
  const waiting=exclusive(root,controller.signal,async()=>0);
  controller.abort();await expect(waiting).rejects.toThrow();
 } finally {await generations.close();await rm(root,{recursive:true,force:true});}
});
