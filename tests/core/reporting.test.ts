import {test,expect} from 'bun:test';
import {Service} from '../../src/adapters/service.js';
import {feedback} from '../../src/adapters/feedback.js';
import {valid} from '../../src/adapters/contracts.js';
import {projectSemantics} from '../../src/domain/contracts.js';

test('compact discovery retains bounded author labels and useful tool descriptions',async()=>{
 const projected=projectSemantics([{name:'q',type:'text',label:'Question',description:'x'.repeat(1500)}]);
 expect(projected.fields[0].label).toBe('Question');expect(projected.fields[0].description.length).toBe(1024);expect(projected.fields[0].description_truncated).toBe(true);
 const service=new Service();try{expect(service.tools().every(t=>t.description?.length>30)).toBe(true);}finally{await service.close();}
});
test('local and stored preparation preserve multiple bounded errors and feedback without backend paths',async()=>{
 const service=new Service();await service.initialize();
 const details=Array.from({length:120},(_,i)=>({code:'INVALID_PARAMETER',pointer:'/params/q'+i,message:'C:/private/backend'}));
 const result={ok:false,diagnostics:details,warnings:['Remote media require network access during playback and are not embedded.','C:/private/backend'],mathematics:{detected:true,installed:false,error:'C:/private/backend'},transformations:[{pointer:'/params/q0',before:'x'.repeat(3000),after:'safe'}]};
 service.engine.run=async()=>result;
 try{
  const local=(await service.call('prepare_h5p_activity',{title:'Test',library:'H5P.Test 1.0',params:{}})).structuredContent;
  expect(valid('preparation_report',local)).toBe(true);expect(local.diagnostics.length).toBe(100);expect(local.diagnostics_truncated).toBe(true);expect(local.transformations[0].truncated).toBe(true);expect(local.mathematics.installed).toBe(false);expect(JSON.stringify(local)).not.toContain('C:/private');
  service.vault=async()=>({prepare:async()=>{throw Object.assign(new Error('private'),{code:'SCHEMA_VALIDATION_FAILED',details,feedback:feedback(result)});}} as any);
  const stored=(await service.call('prepare_stored_h5p_activity',{activity:{title:'Test',library:'H5P.Test 1.0',params:{}}})).structuredContent;
  expect(valid('error_report',stored)).toBe(true);expect(stored.diagnostics).toEqual(local.diagnostics);expect(stored.transformations).toEqual(local.transformations);expect(stored.warnings).toEqual(local.warnings);
  const success=service.stored({id:'a'.repeat(32),kind:'preparation',expires:1,metadata:{feedback:feedback(result)},files:{}} as any);
  expect(success.mathematics.detected).toBe(true);expect(valid('stored_output',success)).toBe(true);
 }finally{await service.close();}
});
