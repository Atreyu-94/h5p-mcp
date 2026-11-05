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
export const multiChoice=()=>({schema_version:'1',project_id:'demo',id:'q2',type:'multi_choice',title:'Choice',library:pin('H5P.MultiChoice 1.16'),question:plain('Select lengths'),mode:'multiple',scoring:'partial_minus_incorrect',correct_ids:['m','km'],choices:[{id:'m',text:plain('metre'),hint:plain('Compare units'),selected_feedback:plain('Length')},{id:'s',text:plain('second')},{id:'km',text:plain('kilometre')}],feedback:{correct:plain('All correct'),incorrect:plain('Review')} });

test('conflicting rendered choices identify both source locations',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-choices-'));
 try{
  await compilerFixture(root);
  const libraries=path.join(root,'libraries');
  const check=(source:Native)=>compileSource(source,libraries);
  const child:Native=multiChoice();
  child.choices[0].text=plain('2 m/s²');
  child.choices[1].text={format:'markdown',value:'2   m/s²'};
  const errors=(await check(child)).diagnostics;
  expect(errors.map((d:Native)=>d.pointer)).toEqual(['/choices/0/text','/choices/1/text']);
  delete child.schema_version;delete child.project_id;
  const set={schema_version:'1',project_id:'demo',id:'series',title:'Series',type:'question_set',library:pin('H5P.QuestionSet 1.21'),pass_percentage:100,questions:[child]};
  expect((await check(set)).diagnostics.map((d:Native)=>d.pointer)).toEqual(['/questions/0/choices/0/text','/questions/0/choices/1/text']);
  for(const [a,b] of [['mW','MW'],['+2','−2'],['**A**','A'],['x²','x2']]){
   child.choices[0].text={format:'markdown',value:a};child.choices[1].text=plain(b);
   expect((await check(set)).ok).toBe(true);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);

test('compiler pins adapters, preserves educational settings, translations, formulas and stable identities',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-compiler-'));try{
  await compilerFixture(root);const libraries=path.join(root,'libraries');
  const source=trueFalse(),before=JSON.stringify(source),first=await compileSource(source,libraries),again=await compileSource(source,libraries);
  expect(first.diagnostics).toEqual([]);expect(first.activity.params.l10n.trueText).toBe('Verdadero');expect(first.activity.params.question).toBe('<p>\\(1+1=2\\)</p>');expect(first.mathematics.detected).toBe(true);expect(first.activity.params.behaviour.feedbackOnCorrect).toBe('Correct');expect(first.activity.params.behaviour.feedbackOnWrong).toBe('Try again');expect(first.activity).toEqual(again.activity);expect(JSON.stringify(source)).toBe(before);
  const multiple=multiChoice(),result=await compileSource(multiple,libraries);expect(result.diagnostics).toEqual([]);expect(result.activity.params.answers.map((a:Native)=>a.correct)).toEqual([true,false,true]);expect(result.activity.params.behaviour).toMatchObject({type:'multi',singlePoint:false,randomAnswers:false,passPercentage:100});expect(result.activity.params.answers[0].tipsAndFeedback.chosenFeedback).toBe('<p>Length</p>');expect(result.activity.params.answers[0].tipsAndFeedback.tip).toBe('<p>Compare units</p>');expect(result.activity.params.overallFeedback[1].feedback).toBe('All correct');expect(result.source_map['/params/answers/0/text']).toBe('/choices/0/text');
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

test('math authoring identifies the exact source field, including nested Blanks alternatives',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-equations-'));
 try{
  await compilerFixture(root);
  const libraries=path.join(root,'libraries');
  for(const format of ['plain','markdown']){
   const bad=await compileSource({...trueFalse(),question:{format,value:'Close \\(x+1'}},libraries);
   expect(bad.ok).toBe(false);
   expect(bad.diagnostics[0]).toMatchObject({pointer:'/question/value',code:'MATH_DELIMITER_INVALID'});
  }
  const child={type:'blanks',id:'b',title:'B',library:pin('H5P.Blanks 1.14'),question:plain('Compare $x^2$'),case_sensitive:true,
   blocks:[{id:'line',segments:[plain('Use \\(x\\). '),{id:'answer',answers:['2','\\(2\\)']}]}]};
  const result=await compileSource({schema_version:'1',project_id:'p',id:'quiz',title:'Quiz',type:'question_set',
   library:pin('H5P.QuestionSet 1.21'),pass_percentage:50,questions:[child]},libraries);
  expect(result.ok).toBe(true);
  const {feedback}=await import('../../src/adapters/feedback.js');
  const warnings=feedback(result).warnings.filter((w:string)=>w.startsWith('Math notation'));
  expect(warnings.length).toBe(2);
  expect(warnings.join(' ')).toContain('/questions/0/question/value');
  expect(warnings.join(' ')).toContain('/questions/0/blocks/0/segments/1/answers/1');
 } finally {await fs.rm(root,{recursive:true,force:true});}
},120000);

test('Markdown accepts long blank-line runs and still rejects indented list markers',()=>{
 expect(renderText({format:'markdown',value:'\n'.repeat(16000)+'x'})).toBe('<p></p><p>x</p>');
 expect(()=>renderText({format:'markdown',value:'Previous\n\n  1. item'})).toThrow();
});
test('bounded text grammar escapes plain HTML and preserves TeX without interpreting its operators',()=>{
 expect(renderText({format:'plain',value:'<script>x</script> & y'})).toBe('<p>&lt;script&gt;x&lt;/script&gt; &amp; y</p>');
 expect(renderText({format:'markdown',value:'**Bold** and *em* \\(x_1 < x_2\\)'})).toBe('<p><strong>Bold</strong> and <em>em</em> \\(x_1 &lt; x_2\\)</p>');
 expect(renderText({format:'markdown',value:'`\\(bad` and $x_1$ and \\[y\\]'})).toBe('<p><code>\\(bad</code> and $x_1$ and \\[y\\]</p>');
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
  expect(checked.scoring_preview).toMatchObject({status:'scored',maximum:1});
  const storedSource=(await service.call('prepare_stored_h5p_source',{source})).structuredContent;
  expect(storedSource.scoring_preview).toEqual(checked.scoring_preview);
  const {scoring_preview:preview,...legacy}=storedSource;
  expect(preview.maximum).toBe(1);expect(valid('stored_output',legacy)).toBe(true);
  expect(valid('stored_output',storedSource)).toBe(true);
  const saved=await (await service.vault()).objects.get(storedSource.object_id,'preparation');
  expect(saved.metadata.feedback.scoring_preview).toEqual(checked.scoring_preview);
  const built=(await service.call('build_h5p_source',{source,output_name:'native'})).structuredContent;expect(built.ok).toBe(true);expect(built.scoring_preview).toEqual(checked.scoring_preview);expect(JSON.stringify(built.activity)).not.toContain('scoring_preview');expect(built.export_mode).toBe('content-only');expect(built.verification.importation).toBe('not_run');
  expect((await service.call('build_h5p_source',{source,output_name:'native'})).structuredContent.diagnostics[0].code).toBe('OUTPUT_ALREADY_EXISTS');
  const invalid=(await service.call('compile_h5p_source',{source:{schema_version:'wrong',type:'unknown'}})).structuredContent;expect(invalid.diagnostics.length).toBeGreaterThan(2);expect(invalid.diagnostics[0].stage).toBe('source');expect(invalid.isError).toBeUndefined();
  const unfair=multiChoice();unfair.choices[1].text=structuredClone(unfair.choices[0].text);
  for(const tool of ['check_h5p_source','compile_h5p_source','build_h5p_source']){
   const args=tool==='build_h5p_source'?{source:unfair,output_name:'unfair'}:{source:unfair};
   const rejected=(await service.call(tool,args)).structuredContent;
   expect(rejected.ok).toBe(false);expect(rejected.artifact).toBeUndefined();expect(await fs.readdir(path.join(root,'exports'))).not.toContain('unfair.h5p');
   expect(rejected.diagnostics.map((d:Native)=>d.pointer)).toEqual(['/choices/0/text','/choices/1/text']);
  }
  const filename=path.join(root,'source.json');await fs.writeFile(filename,JSON.stringify(source));
  const cli=Bun.spawn([process.execPath,fileURLToPath(new URL('../../dist/core/cli.js',import.meta.url)),'compile',filename],{env:{...process.env,H5P_MCP_DATA_DIR:root},stdout:'pipe',stderr:'pipe'});
  const [out,err]=await Promise.all([new Response(cli.stdout).text(),new Response(cli.stderr).text()]);expect({code:await cli.exited,err}).toEqual({code:0,err:''});expect(JSON.parse(out).activity.params).toEqual(checked.activity.params);expect(JSON.parse(out).activity.preparation.libraries).toEqual(checked.activity.preparation.libraries);expect(JSON.parse(out).identities).toEqual(checked.identities);
  await fs.writeFile(filename,JSON.stringify({...source,question:plain('\\(x')}));
  const mathCli=Bun.spawn([process.execPath,fileURLToPath(new URL('../../dist/core/cli.js',import.meta.url)),'check',filename],{env:{...process.env,H5P_MCP_DATA_DIR:root},stdout:'pipe'});
  const mathOutput=JSON.parse(await new Response(mathCli.stdout).text());
  expect(await mathCli.exited).toBe(1);expect(mathOutput.diagnostics[0]).toMatchObject({pointer:'/question/value',code:'MATH_DELIMITER_INVALID'});
  expect(mathOutput.diagnostics[0].message).toContain('\\)');expect(mathOutput.source_locations['/question/value'].line).toBe(1);
  await fs.writeFile(filename,'null');
  const invalidCli=Bun.spawn([process.execPath,fileURLToPath(new URL('../../dist/core/cli.js',import.meta.url)),'check',filename],{env:{...process.env,H5P_MCP_DATA_DIR:root},stdout:'pipe',stderr:'pipe'});
  const invalidOutput=await new Response(invalidCli.stdout).text();expect(await invalidCli.exited).toBe(1);expect(JSON.parse(invalidOutput).diagnostics).toEqual((await service.call('check_h5p_source',{source:null})).structuredContent.diagnostics);
  const failure=(await service.call('prepare_stored_h5p_activity',{activity:{title:'Bad',library:'H5P.TrueFalse 1.8',params:{question:'<script>unsafe</script>',correct:'neither'}}})).structuredContent;
  expect(failure.ok).toBe(false);expect(failure.diagnostics.length).toBeGreaterThanOrEqual(2);expect(failure.transformations[0].pointer).toBe('/params/question');expect(JSON.stringify(failure)).not.toContain(root);
  const stored=(await service.call('prepare_stored_h5p_activity',{activity:{title:'Math',library:'H5P.TrueFalse 1.8',params:{question:'<p>\\(x\\) and $y^2$</p>',correct:'true'}}})).structuredContent;
  expect(stored.kind).toBe('preparation');expect(stored.mathematics.detected).toBe(true);expect(stored.warnings.length).toBeGreaterThan(0);expect(valid('stored_output',stored)).toBe(true);
  const persisted=await (await service.vault()).objects.get(stored.object_id,'preparation');expect(persisted.metadata.feedback.mathematics.detected).toBe(true);
  expect(persisted.metadata.feedback.warnings).toEqual(stored.warnings);expect(stored.warnings.join(" ")).toContain("/params/question");
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
  const spanish=await compileSource({...source,ui:{language:'es',missing:'fallback'}},libraries);
  expect(result.scoring_preview.maximum).toBe(3);expect(result.scoring_preview.items.map((item:Native)=>item.share)).toEqual([1/3,2/3]);
  expect(spanish.activity.params.progressType).toBe('textual');
  expect(spanish.activity.params.texts).toMatchObject({previous:'Anterior',next:'Siguiente'});
  expect(spanish.activity.params.endGame).toMatchObject({message:'Resultados',amountCorrect:'@finals de @totals puntos',scoreHeader:'Puntuación'});
  expect(spanish.activity.params.introPage).toMatchObject({showIntroPage:false,startButtonText:'Iniciar prueba'});
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

test('Blanks separates answer alternatives from Markdown and Accordion pins its text children',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-composition-'));try{
  await compilerFixture(root);const libraries=path.join(root,'libraries');
  const source:Native={schema_version:'1',project_id:'demo',id:'blanks',type:'blanks',title:'Blanks',library:pin('H5P.Blanks 1.14'),question:plain('Complete'),case_sensitive:true,blocks:[{id:'line',segments:[{format:'markdown',value:'**Length** \\(x_1\\): '},{id:'answer',answers:['metre','meter']}]}],feedback:{correct:plain('Good'),incorrect:plain('Review')}};
  const result=await compileSource(source,libraries);expect(result.diagnostics).toEqual([]);expect(result.ok).toBe(true);expect(result.activity.params.questions[0]).toContain('*metre/meter*');expect(result.activity.params.questions[0]).toContain('<strong>Length</strong>');expect(result.activity.params.behaviour).toMatchObject({caseSensitive:true,acceptSpellingErrors:false});
  for(const answer of ['a/b','a:b','a*b',' padded','a\nb']){const bad=structuredClone(source);bad.blocks[0].segments[1].answers=[answer];expect((await compileSource(bad,libraries)).diagnostics).toContainEqual(expect.objectContaining({pointer:'/blocks/0/segments/1/answers/0',reason:'delimiter'}));}
  const two=structuredClone(source);
  two.blocks[0].segments.push({id:'extra',answers:['second']});
  expect((await compileSource(two,libraries)).scoring_preview).toMatchObject({maximum:2,items:[{rule:'one_per_correct_gap'}]});
  const star=structuredClone(source);star.blocks[0].segments[0]=plain('x*y');expect((await compileSource(star,libraries)).ok).toBe(false);
  const panel={id:'panel',title:'Topic',text:{format:'markdown',value:'**Explanation**'},library:pin('H5P.AdvancedText 1.1')};
  const accordion={schema_version:'1',project_id:'demo',id:'accordion',type:'accordion',title:'Accordion',library:pin('H5P.Accordion 1.0'),panels:[panel]};
  const compiled=await compileSource(accordion,libraries);expect(compiled.scoring_preview).toEqual({status:"unscored",maximum:0,items:[]});expect(compiled.diagnostics).toEqual([]);expect(compiled.activity.params.panels[0].content.subContentId).toBe(stableId('demo','accordion','panel'));expect(compiled.activity.params.panels[0].content.params.text).toBe('<p><strong>Explanation</strong></p>');
  const child=structuredClone(source);delete child.schema_version;delete child.project_id;
  const set=await compileSource({schema_version:'1',project_id:'demo',id:'set',type:'question_set',title:'Set',library:pin('H5P.QuestionSet 1.21'),pass_percentage:50,questions:[child]},libraries);expect(set.diagnostics).toEqual([]);expect(set.ok).toBe(true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);

test('durable source units reconstruct after TTL expiry and reject drift without touching originals',async()=>{
 const {Objects}=await import('../../src/storage/objects.js'),{Vault}=await import('../../src/storage/vault.js'),{freezeSource,rebuildSource}=await import('../../src/application/source-project.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-source-unit-'));let now=Date.now();const objects=new Objects(path.join(root,'store'),{tenant:'local',owner:'local'},()=>now),vault=new Vault(objects,root);
 try{
  await compilerFixture(root);await objects.initialize();const source=trueFalse(),project=path.join(root,'project');
  const frozen=await freezeSource(source,vault,project,async filename=>filename);expect(frozen.ok).toBe(true);
  const first=await rebuildSource(project);expect(first.ok).toBe(true);
  now+=366*86400000;await objects.collect();
  const second=await rebuildSource(project);expect(second.activity).toEqual(first.activity);
  await expect(freezeSource(source,vault,project,async filename=>filename)).rejects.toBeDefined();
  const filename=path.join(project,'data/libraries/H5P.TrueFalse-1.8/semantics.json');await fs.appendFile(filename,' ');
  await expect(rebuildSource(project)).rejects.toMatchObject({code:'OBJECT_INTEGRITY_FAILED'});
  expect((await compileSource(source,path.join(root,'libraries'))).ok).toBe(true);
 }finally{await vault.close();await fs.rm(root,{recursive:true,force:true});}
},120000);

test('pinned QuestionSet runtime sums child scores and uses aggregate feedback thresholds',async()=>{
 const {runInNewContext}=await import('node:vm');const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-score-proof-'));
 try{
  await compilerFixture(root);const base=path.join(root,'libraries');
  const runtime=await fs.readFile(path.join(base,'H5P.QuestionSet-1.21/js/questionset.js'),'utf8');
  const mc=await fs.readFile(path.join(base,'H5P.MultiChoice-1.16/js/multichoice.js'),'utf8');
  const method=(js:string,signature:string)=>{
   const start=js.indexOf(signature);expect(start).toBeGreaterThanOrEqual(0);
   const end=js.indexOf('\n  };',start);
   return js.slice(js.indexOf('function',start),end+4);
  };
  const source=multiChoice();
  const compiled=await compileSource(source,base);
  const params={...compiled.activity.params,weight:1,userAnswers:[] as number[]};
  const context:Native={params,blankIsCorrect:false,score:0};
  context.calculateMaxScore=runInNewContext('('+method(mc,'var calculateMaxScore =')+')',context);
  const max=runInNewContext('('+method(mc,'this.getMaxScore =')+')',context);
  const score=runInNewContext('('+method(mc,'var calcScore =')+')',context);
  expect(max()).toBe(compiled.scoring_preview.maximum);
  for(const [answers,points] of [[[],0],[[0],1],[[0,1],0],[[0,2],2],[[0,1,2],1],[[],0]] as Array<[number[],number]>){
   params.userAnswers=answers;score();expect(context.score).toBe(points);
  }
  const exact=await compileSource({...source,scoring:'all_or_nothing'},base);
  params.behaviour=exact.activity.params.behaviour;
  expect(max()).toBe(exact.scoring_preview.maximum);
  for(const [answers,points] of [[[0],0],[[0,2],1],[[0,1,2],0]] as Array<[number[],number]>){
   params.userAnswers=answers;score();expect(context.score).toBe(points);
  }
  const children=[{getScore:()=>1,getMaxScore:()=>1},{getScore:()=>1,getMaxScore:()=>2}];
  const extract=(name:string)=>{const match=runtime.match(new RegExp('this\\.'+name+' = (function \\(\\) \\{[\\s\\S]*?\\n  \\});'));expect(match).not.toBeNull();return runInNewContext('('+match![1]+')',{questionInstances:children});};
  expect(extract('getScore')()).toBe(2);expect(extract('getMaxScore')()).toBe(3);
  const question=await fs.readFile(path.join(base,'H5P.Question-1.5/scripts/question.js'),'utf8'),match=question.match(/Question\.determineOverallFeedback = (function \(feedbacks, scoreRatio\) \{[\s\S]*?\n  \});/);expect(match).not.toBeNull();
  const feedback=runInNewContext('('+match![1]+')'),ranges=[{from:0,to:59,feedback:'Review'},{from:60,to:100,feedback:'Passed'}];expect(feedback(ranges,0.5999)).toBe('Review');expect(feedback(ranges,0.6)).toBe('Passed');expect(feedback(ranges,1)).toBe('Passed');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);

test('QuestionSet children inherit UI defaults while retaining explicit child overrides',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-ui-inheritance-'));
 try{
  await compilerFixture(root);
  const child:Native=trueFalse();delete child.schema_version;delete child.project_id;
  child.ui={overrides:{'l10n/trueText':'Sí'}};
  const source:Native={schema_version:'1',project_id:'demo',id:'quiz',type:'question_set',title:'Quiz',library:pin('H5P.QuestionSet 1.21'),pass_percentage:60,ui:{language:'es',missing:'fallback'},questions:[child]};
  const result=await compileSource(source,path.join(root,'libraries'));
  expect(result.diagnostics).toEqual([]);
  expect(result.activity.params.questions[0].params.l10n).toMatchObject({trueText:'Sí',falseText:'Falso'});
  expect(result.activity.params.questions[0].metadata).toEqual({title:child.title});
  expect(result.source_map['/params/questions/0/metadata/title']).toBe('/questions/0/title');
  child.ui.language='en';child.title='A & <img src=x onerror=alert(1)>';
  const english=await compileSource(source,path.join(root,'libraries'));
  expect(english.diagnostics).toEqual([]);
  expect(english.activity.params.questions[0].metadata.title).toBe('A &amp; &lt;img src=x onerror=alert(1)&gt;');
  expect(english.activity.params.questions[0].params.l10n).toMatchObject({trueText:'Sí',falseText:'False'});
  child.ui={language:'zz'};
  expect((await compileSource(source,path.join(root,'libraries'))).ok).toBe(true);
  child.ui.missing='error';
  const missing=await compileSource(source,path.join(root,'libraries'));
  expect(missing.diagnostics).toContainEqual(expect.objectContaining({pointer:'/questions/0/ui/language',reason:'translation'}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);

test.skipIf(process.env.H5P_TEST_TYPST_DOCKER!=='1')('portable figure project survives expiry, edits and two independent H5P exports',async()=>{
 const {Service}=await import('../../src/adapters/service.js');
 const {Objects}=await import('../../src/storage/objects.js'),{Vault}=await import('../../src/storage/vault.js');
 const {freezeSource,rebuildSource}=await import('../../src/application/source-project.js');
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-edit-'));
 const data=path.join(tmp,'data'),store=path.join(tmp,'store');
 let now=Date.now();
 const objects=new Objects(store,{tenant:'local',owner:'local'},()=>now),vault=new Vault(objects,data);
 const oldExport=process.env.H5P_MCP_EXPORT_DIR;
 process.env.H5P_MCP_EXPORT_DIR=tmp;
 const teacher=new Service(undefined,{data,store}),other=new Service({tenant:'local',owner:'other'},{data,store});
 teacher.vault=async()=>vault;
 try{
  await compilerFixture(data);await objects.initialize();
  const text=await fs.readFile(new URL('../fixtures/typst/parabola.typ',import.meta.url),'utf8');
  const figure=(await teacher.call('render_typst_figure',{source:text,alt:'Parabola'})).structuredContent;
  expect(figure.ok).toBe(true);
  expect((await teacher.readResource(figure.source.uri)).contents[0]).toMatchObject({mimeType:'text/plain',text});
  await expect(other.readResource(figure.source.uri)).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  const illustration={id:'curve',asset:'curve',mime:'image/png',alt:'Parabola',copyright:{author:'Teacher',license:'CC BY'},library:pin('H5P.Image 1.1')};
  const activities=[trueFalse(),multiChoice()];
  for(const activity of activities){
   const prepared=await vault.prepare({...activity,image:illustration,assets:{curve:figure.asset_id}},86400000,undefined,undefined,true);
   const exported=await vault.export(prepared.id,'export-'+activity.id);
   const zip=await createRequire(import.meta.url)('yauzl-promise').open(path.join(exported.root,'payload'));
   const media:string[]=[];
   try{
    for await(const entry of zip){
     if(!entry.filename.startsWith('content/')||!entry.filename.endsWith('.png'))continue;
     const hash=createHash('sha256');
     for await(const bytes of await entry.openReadStream())hash.update(bytes);
     media.push(hash.digest('hex'));
    }
   }finally{await zip.close();}
   expect(media).toContain(figure.manifest.hashes['figure.png']);
  }
  const project=path.join(tmp,'portable');
  const activity={...activities[0],image:illustration,assets:{curve:path.join(figure.directory,'figure.png')}};
  const entry=fileURLToPath(new URL('../../dist/core/cli.js',import.meta.url));
  const input=path.join(tmp,'activity.json');
  await fs.writeFile(input,JSON.stringify(activity));
  const capture=Bun.spawn([process.execPath,entry,'freeze',input,project,'--figure','curve',figure.directory],{
   env:{...process.env,H5P_MCP_DATA_DIR:data,H5P_MCP_STORE_DIR:path.join(tmp,'capture-store')},stdout:'pipe',stderr:'pipe'});
  const frozen=await new Response(capture.stdout).text(),captureError=await new Response(capture.stderr).text();
  if(await capture.exited!==0)throw new Error(captureError+frozen);
  expect(JSON.parse(frozen).format).toBe('h5p-source-project-v2');
  const moved=path.join(tmp,'relocated');
  await fs.rename(project,moved);
  now+=86400001;await objects.collect();
  await expect(teacher.readResource(figure.source.uri)).rejects.toMatchObject({code:'OBJECT_EXPIRED'});
  const offline=Bun.spawn([process.execPath,entry,'rebuild',moved,'offline-copy.h5p'],{
   env:{...process.env,H5P_MCP_EXPORT_DIR:tmp,H5P_MCP_TYPST_ENABLED:'0',H5P_MCP_DATA_DIR:data},stdout:'pipe',stderr:'pipe'});
  const result=await new Response(offline.stdout).text(),diagnostics=await new Response(offline.stderr).text();
  if(await offline.exited!==0)throw new Error(diagnostics+result);
  expect(JSON.parse(result).ok).toBe(true);
  const portable=path.join(moved,'figures','curve'),edited=path.join(tmp,'edited');
  await fs.writeFile(path.join(portable,'figure.typ'),text.replace('stroke: blue','stroke: red'));
  const proc=Bun.spawn([process.execPath,fileURLToPath(new URL('../../dist/core/cli.js',import.meta.url)),
   'figure','rebuild',portable,edited],{env:{...process.env,H5P_MCP_DATA_DIR:data},stdout:'pipe',stderr:'pipe'});
  const output=await new Response(proc.stdout).text(),err=await new Response(proc.stderr).text();
  if(await proc.exited!==0)throw new Error(err+output);
  expect(JSON.parse(output).manifest.hashes['figure.png']).not.toBe(figure.manifest.hashes['figure.png']);
  await expect(rebuildSource(moved)).rejects.toMatchObject({code:'OBJECT_INTEGRITY_FAILED'});
  const invalid=path.join(tmp,'mismatched');
  await expect(freezeSource(activity,vault,invalid,async f=>f,{curve:edited})).rejects.toMatchObject({code:'STALE_PREPARATION'});
  expect(await fs.exists(path.join(invalid,'project.lock.json'))).toBe(false);
 }finally{
  if(oldExport===undefined)delete process.env.H5P_MCP_EXPORT_DIR;else process.env.H5P_MCP_EXPORT_DIR=oldExport;
  await teacher.close();await other.close();await vault.close();await fs.rm(tmp,{recursive:true,force:true});
 }
},180000);

test('stored SVG is validated, owner scoped and embedded only for a host-approved target',async()=>{
 const {Service}=await import('../../src/adapters/service.js');
 const {validatePackage}=await import('../../src/h5p/packages.js');
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-svg-target-')),store=path.join(tmp,'store');
 const host=new Service(undefined,{data:tmp,store}),other=new Service({tenant:'local',owner:'other'},{data:tmp,store});
 const previous=process.env.H5P_MCP_SVG_CONTENT_TARGETS;
 delete process.env.H5P_MCP_SVG_CONTENT_TARGETS;
 try{
  await compilerFixture(tmp);
  const file=path.join(tmp,'figure.svg');
  const vector=process.env.H5P_TEST_SVG_FILE?await fs.readFile(process.env.H5P_TEST_SVG_FILE):
   Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50pt" height="20pt" viewBox="0 0 50 20"><path d="M1 1L49 19" stroke="#000000"/></svg>');
  await fs.writeFile(file,vector);
  const upload=async()=> (await host.call('upload_h5p_asset',{path:file,mime:'image/svg+xml'})).structuredContent;
  const asset=await upload();expect(asset.kind).toBe('asset');
  const resource=(await host.readResource(asset.uri)).contents[0];
  expect(resource.mimeType).toBe('image/svg+xml');expect(Buffer.from(resource.blob,'base64')).toEqual(vector);
  await expect(other.readResource(asset.uri)).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  await fs.writeFile(file,vector.toString().replace('</svg>','<script/></svg>'));
  expect((await upload()).ok).toBe(false);
  await fs.writeFile(file,vector);
  const vault=await host.vault();
  const source:Native={...multiChoice(),image:{id:'curve',asset:'curve',mime:'image/svg+xml',alt:'Curve',copyright:{author:'Teacher',license:'CC BY'},library:pin('H5P.Image 1.1')},assets:{curve:asset.object_id}};
  if(process.env.H5P_TEST_SVG_FILE){
   const example=JSON.parse(await fs.readFile(new URL('../../examples/scientific-figures/motion-question.json',import.meta.url),'utf8'));
   Object.assign(source,example,{image:{...example.image,mime:'image/svg+xml'},assets:{grafica:asset.object_id}});
  }
  const prepared=await vault.prepare(source,86400000,undefined,undefined,true);
  const profile=await vault.target({core:{major:1,minor:28},inventory_at:new Date().toISOString(),can_install:true,libraries:[]});
  await expect(vault.export(prepared.id,'no-target')).rejects.toMatchObject({code:'TARGET_INCOMPATIBLE'});
  await expect(vault.export(prepared.id,'default',profile.id)).rejects.toMatchObject({code:'TARGET_INCOMPATIBLE'});
  process.env.H5P_MCP_SVG_CONTENT_TARGETS=profile.id;
  const artifact=await vault.export(prepared.id,'vector',profile.id),filename=path.join(artifact.root,'payload');
  expect(artifact.metadata.target.svg_target_profile_id).toBe(profile.id);
  const libraries=path.join(tmp,'libraries');
  await expect(validatePackage(filename,libraries)).rejects.toMatchObject({code:'TARGET_INCOMPATIBLE'});
  expect((await validatePackage(filename,libraries,true)).ok).toBe(true);
  const imported=await vault.upload('package','application/zip',(await import('node:fs')).createReadStream(filename));
  const validate=async(target?:string)=>(await host.call('validate_stored_h5p_package',{object_id:imported.id,...(target?{target_profile_id:target}:{})})).structuredContent;
  expect((await validate()).ok).toBe(false);
  expect((await validate(profile.id)).ok).toBe(true);
  const zip=await createRequire(import.meta.url)('yauzl-promise').open(filename);
  try{
   const expected='media/'+asset.sha256+'.svg';let embedded=false,routed=false;
   for await(const entry of zip){
    if(!['content/content.json','content/'+expected].includes(entry.filename))continue;
    const bufs=[];for await(const chunk of await entry.openReadStream())bufs.push(chunk);
    const bytes=Buffer.concat(bufs);
    if(entry.filename==='content/'+expected){expect(bytes).toEqual(vector);embedded=true;}
    else{expect(JSON.parse(bytes.toString()).media.type.params.file).toMatchObject({path:expected,mime:'image/svg+xml'});routed=true;}
   }
   expect(embedded&&routed).toBe(true);
  }finally{await zip.close();}
  if(process.env.H5P_TEST_SVG_EXPORT)await fs.copyFile(filename,process.env.H5P_TEST_SVG_EXPORT);
  delete process.env.H5P_MCP_SVG_CONTENT_TARGETS;
  await expect(vault.export(prepared.id,'vector',profile.id)).rejects.toMatchObject({code:'TARGET_INCOMPATIBLE'});
 }finally{
  if(previous===undefined)delete process.env.H5P_MCP_SVG_CONTENT_TARGETS;else process.env.H5P_MCP_SVG_CONTENT_TARGETS=previous;
  await host.close();await other.close();await fs.rm(tmp,{recursive:true,force:true});
 }
},120000);
