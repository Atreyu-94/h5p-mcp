import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {compileSource,adapters} from '../../src/application/compiler.js';
import {renderText,stableId} from '../../src/domain/authoring-source.js';
import type {Native} from '../../src/domain/types.js';
export async function compilerFixture(root:string){
 const filename=new URL('../fixtures/libraries.zip',import.meta.url),lock=JSON.parse(await fs.readFile(new URL('../fixtures/libraries.lock.json',import.meta.url),'utf8'));
 expect(createHash('sha256').update(await fs.readFile(filename)).digest('hex')).toBe(lock.sha256);
 const zip=await createRequire(import.meta.url)('yauzl-promise').open(fileURLToPath(filename));
 try{for await(const entry of zip){const target=path.join(root,'libraries',entry.filename);if(entry.filename.endsWith('/')){await fs.mkdir(target,{recursive:true});continue;}await fs.mkdir(path.dirname(target),{recursive:true});const chunks=[];for await(const chunk of await entry.openReadStream())chunks.push(chunk);await fs.writeFile(target,Buffer.concat(chunks));}}finally{await zip.close();}
}
export const pin=(name:string)=>({name,...adapters[name]});
export const plain=(value:string)=>({format:'plain',value});
export const trueFalse=()=>({schema_version:'1',project_id:'demo',id:'q1',type:'true_false',title:'Test',library:pin('H5P.TrueFalse 1.8'),question:plain('\\(1+1=2\\)'),correct:true,feedback:{correct:plain('Correct'),incorrect:plain('Try again')},ui:{language:'es'}});
export const multiChoice=()=>({schema_version:'1',project_id:'demo',id:'q2',type:'multi_choice',title:'Choice',library:pin('H5P.MultiChoice 1.16'),question:plain('Select lengths'),mode:'multiple',scoring:'partial_minus_incorrect',correct_ids:['m','km'],choices:[{id:'m',text:plain('metre'),selected_feedback:plain('Length')},{id:'s',text:plain('second')},{id:'km',text:plain('kilometre')}],feedback:{correct:plain('All correct'),incorrect:plain('Review')} });

test('compiler pins adapters, preserves educational settings, translations, formulas and stable identities',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-compiler-'));try{
  await compilerFixture(root);const libraries=path.join(root,'libraries');
  const source=trueFalse(),before=JSON.stringify(source),first=await compileSource(source,libraries),again=await compileSource(source,libraries);
  expect(first.diagnostics).toEqual([]);expect(first.activity.params.l10n.trueText).toBe('Verdadero');expect(first.activity.params.question).toBe('<p>\\(1+1=2\\)</p>');expect(first.mathematics.detected).toBe(true);expect(first.activity.params.behaviour.feedbackOnCorrect).toBe('<p>Correct</p>');expect(first.activity.params.behaviour.feedbackOnWrong).toBe('<p>Try again</p>');expect(first.activity).toEqual(again.activity);expect(JSON.stringify(source)).toBe(before);
  const multiple=multiChoice(),result=await compileSource(multiple,libraries);expect(result.diagnostics).toEqual([]);expect(result.activity.params.answers.map((a:Native)=>a.correct)).toEqual([true,false,true]);expect(result.activity.params.behaviour).toMatchObject({type:'multi',singlePoint:false,randomAnswers:false,passPercentage:100});expect(result.activity.params.answers[0].tipsAndFeedback.chosenFeedback).toBe('<p>Length</p>');expect(result.activity.params.overallFeedback[1].feedback).toBe('<p>All correct</p>');expect(result.source_map['/params/answers/0/text']).toBe('/choices/0/text');
  const reordered=await compileSource({...multiple,choices:[...multiple.choices].reverse()},libraries);expect(reordered.identities).toEqual(result.identities);expect(reordered.activity.params.answers[2].text).toBe(result.activity.params.answers[0].text);
  const file=path.join(root,'image.png');await fs.writeFile(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64'));
  const picture={...source,assets:{photo:file},image:{id:'photo',asset:'photo',mime:'image/png',alt:'A square',library:pin('H5P.Image 1.1'),copyright:{author:'Teacher',license:'CC BY'}}};
  const illustrated=await compileSource(picture,libraries);expect(illustrated.diagnostics).toEqual([]);expect(illustrated.activity.params.media.type.subContentId).toBe(stableId('demo','q1','photo'));expect(illustrated.activity.params.media.type.params.file.copyright.authors[0].name).toBe('Teacher');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);
test('compiler rejects loss, invalid references, incompatible pins and missing translations with source pointers',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-compiler-errors-'));try{
  await compilerFixture(root);const libraries=path.join(root,'libraries'),source=multiChoice();
  for(const [change,reason] of [[{choices:[source.choices[0],structuredClone(source.choices[0])]},'duplicate'],[{correct_ids:['missing']},'reference'],[{mode:'single'},'cardinality'],[{mode:'single',correct_ids:['m']},'scoring'],[{library:{...source.library,patch:999}},'pin'],[{ui:{language:'zz'}},'translation'],[{question:{format:'markdown',value:'<b>raw</b>'}},'markdown']] as Array<[Native,string]>){const result=await compileSource({...source,...change},libraries);expect(result.ok).toBe(false);expect(result.diagnostics.some((d:Native)=>d.reason===reason)).toBe(true);expect(result.diagnostics.every((d:Native)=>d.pointer.startsWith('/'))).toBe(true);}
  const fallback=await compileSource({...source,ui:{language:'zz',missing:'fallback'}},libraries);expect(fallback.ok).toBe(true);expect(fallback.warnings.some((w:string)=>w.startsWith('Translation unavailable'))).toBe(true);
  const override=await compileSource({...trueFalse(),ui:{language:'es',overrides:{'l10n/trueText':'Sí'}}},libraries);expect(override.ok).toBe(true);expect(override.activity.params.l10n.trueText).toBe('Sí');
  expect((await compileSource({...source,extra:'not representable'},libraries)).ok).toBe(false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);
test('bounded text grammar escapes plain HTML and preserves TeX without interpreting its operators',()=>{
 expect(renderText({format:'plain',value:'<script>x</script> & y'})).toBe('<p>&lt;script&gt;x&lt;/script&gt; &amp; y</p>');
 expect(renderText({format:'markdown',value:'**Bold** and *em* \\(x_1 < x_2\\)'})).toBe('<p><strong>Bold</strong> and <em>em</em> \\(x_1 &lt; x_2\\)</p>');
 expect(()=>renderText({format:'markdown',value:'[link](https://example.com)'})).toThrow();
});

test('CLI and local MCP service share native compilation/build and stored feedback survives real workers',async()=>{
 const {Service}=await import('../../src/adapters/service.js'),{valid}=await import('../../src/adapters/contracts.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-authoring-service-'));
 const oldExport=process.env.H5P_MCP_EXPORT_DIR;process.env.H5P_MCP_EXPORT_DIR=path.join(root,'exports');
 const service=new Service(undefined,{data:root,store:path.join(root,'store')});
 try{
  await compilerFixture(root);await service.initialize();const source=trueFalse();
  expect(service.tools().find(t=>t.name==='compile_h5p_source').inputSchema.properties.source.properties.schema_version.const).toBe('1');
  const checked=(await service.call('check_h5p_source',{source})).structuredContent;expect(checked.ok).toBe(true);expect(valid('authoring_report',checked)).toBe(true);
  const built=(await service.call('build_h5p_source',{source,output_name:'native'})).structuredContent;expect(built.ok).toBe(true);expect(built.export_mode).toBe('content-only');expect(built.verification.importation).toBe('not_run');
  expect((await service.call('build_h5p_source',{source,output_name:'native'})).structuredContent.diagnostics[0].code).toBe('OUTPUT_ALREADY_EXISTS');
  const invalid=(await service.call('compile_h5p_source',{source:{schema_version:'wrong',type:'unknown'}})).structuredContent;expect(invalid.diagnostics.length).toBeGreaterThan(2);expect(invalid.diagnostics[0].stage).toBe('source');expect(invalid.isError).toBeUndefined();
  const filename=path.join(root,'source.json');await fs.writeFile(filename,JSON.stringify(source));
  const cli=Bun.spawn([process.execPath,fileURLToPath(new URL('../../dist/core/cli.js',import.meta.url)),'compile',filename],{env:{...process.env,H5P_MCP_DATA_DIR:root},stdout:'pipe',stderr:'pipe'});
  const [out,err]=await Promise.all([new Response(cli.stdout).text(),new Response(cli.stderr).text()]);expect({code:await cli.exited,err}).toEqual({code:0,err:''});expect(JSON.parse(out).activity.params).toEqual(checked.activity.params);expect(JSON.parse(out).activity.preparation.libraries).toEqual(checked.activity.preparation.libraries);expect(JSON.parse(out).identities).toEqual(checked.identities);
  await fs.writeFile(filename,'null');
  const invalidCli=Bun.spawn([process.execPath,fileURLToPath(new URL('../../dist/core/cli.js',import.meta.url)),'check',filename],{env:{...process.env,H5P_MCP_DATA_DIR:root},stdout:'pipe',stderr:'pipe'});
  const invalidOutput=await new Response(invalidCli.stdout).text();expect(await invalidCli.exited).toBe(1);expect(JSON.parse(invalidOutput).diagnostics).toEqual((await service.call('check_h5p_source',{source:null})).structuredContent.diagnostics);
  const failure=(await service.call('prepare_stored_h5p_activity',{activity:{title:'Bad',library:'H5P.TrueFalse 1.8',params:{question:'<script>unsafe</script>',correct:'neither'}}})).structuredContent;
  expect(failure.ok).toBe(false);expect(failure.diagnostics.length).toBeGreaterThanOrEqual(2);expect(failure.transformations[0].pointer).toBe('/params/question');expect(JSON.stringify(failure)).not.toContain(root);
  const stored=(await service.call('prepare_stored_h5p_activity',{activity:{title:'Math',library:'H5P.TrueFalse 1.8',params:{question:'<p>\\(x\\)</p>',correct:'true'}}})).structuredContent;
  expect(stored.kind).toBe('preparation');expect(stored.mathematics.detected).toBe(true);expect(stored.warnings.length).toBeGreaterThan(0);expect(valid('stored_output',stored)).toBe(true);
  const persisted=await (await service.vault()).objects.get(stored.object_id,'preparation');expect(persisted.metadata.feedback.mathematics.detected).toBe(true);
 }finally{await service.close();if(oldExport===undefined)delete process.env.H5P_MCP_EXPORT_DIR;else process.env.H5P_MCP_EXPORT_DIR=oldExport;await fs.rm(root,{recursive:true,force:true});}
},120000);

 test('QuestionSet preserves child identities, scores and aggregate feedback and rejects unsupported children',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-question-set-'));try{
  await compilerFixture(root);const libraries=path.join(root,'libraries');
  const child=(value:Native)=>{const copy={...value};delete copy.schema_version;delete copy.project_id;return copy;};
  const source={schema_version:'1',project_id:'demo',id:'quiz',type:'question_set',title:'Quiz',library:pin('H5P.QuestionSet 1.21'),pass_percentage:60,questions:[child(trueFalse()),child(multiChoice())],feedback:{correct:plain('Passed'),incorrect:plain('Review')}};
  const result=await compileSource(source,libraries);
  expect(result.diagnostics).toEqual([]);expect(result.ok).toBe(true);
  expect(result.activity.params.questions[0].subContentId).toBe(stableId('demo','q1'));
  expect(result.activity.params.questions[1].params.behaviour.singlePoint).toBe(false);
  expect(result.activity.params.endGame.overallFeedback).toEqual([{from:0,to:59,feedback:'Review'},{from:60,to:100,feedback:'Passed'}]);
  expect(result.source_map['/params/questions/1/params/answers/0/text']).toBe('/questions/1/choices/0/text');
  const reordered=await compileSource({...source,questions:[...source.questions].reverse()},libraries);expect(reordered.identities).toEqual(result.identities);
  const duplicated=await compileSource({...source,questions:[source.questions[0],{...structuredClone(source.questions[0]),id:'copy'}]},libraries);expect(duplicated.ok).toBe(true);expect(duplicated.identities.copy).not.toBe(duplicated.identities.q1);
  const invalid=await compileSource({...source,questions:[source.questions[0],structuredClone(source.questions[0])]},libraries);expect(invalid.ok).toBe(false);expect(invalid.diagnostics).toContainEqual(expect.objectContaining({pointer:'/questions/1/id',reason:'duplicate'}));
  expect((await compileSource({...source,questions:[structuredClone(source)]},libraries)).ok).toBe(false);
  const missing=await compileSource({...source,questions:[{...source.questions[0],library:{...source.questions[0].library,patch:999}}]},libraries);expect(missing.diagnostics[0].pointer).toBe('/questions/0/library');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);
