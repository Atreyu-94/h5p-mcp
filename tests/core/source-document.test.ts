import {test,expect} from 'bun:test';
import {parseSource} from '../../src/infrastructure/source-document.js';
test('JSON and YAML share data and pointers and reject ambiguous documents',()=>{
 const json='{"id":"demo","correct":true,"choices":["a","b"]}',yaml='id: demo\ncorrect: true\nchoices:\n  - a\n  - b\n';
 expect(parseSource(json,'json').source).toEqual(parseSource(yaml,'yaml').source);expect(parseSource(yaml,'yaml').locations['/choices/1']).toEqual({line:5,column:5});
 for(const source of ['a: 1\na: 2','a: &x text\nb: *x','a: !custom x','a: !!str text','1: value','a: .inf','a: 0x10','a: 1\n---\nb: 2','<<: {a: 1}','%YAML 1.1\n---\na: yes'])expect(()=>parseSource(source,'yaml')).toThrow();
 expect(()=>parseSource('{"a":1,"a":2}','json')).toThrow();expect(()=>parseSource('a: text','json')).toThrow();
 expect(parseSource('a: yes\nb: 2026-11-01','yaml').source).toEqual({a:'yes',b:'2026-11-01'});
 try{parseSource('a: 1\na: 2','yaml');}catch(error:any){expect(error.source_locations[''].line).toBe(2);}
});
