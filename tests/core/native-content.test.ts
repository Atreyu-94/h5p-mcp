import {fileURLToPath} from 'node:url';
import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {Engine} from '../../src/application/engine.js';
import {preflight} from '../../src/infrastructure/archive.js';
import {prepareActivity} from '../../src/application/authoring.js';
import type {Native} from '../../src/domain/types.js';
const load=createRequire(import.meta.url);
async function fixture(root:string) {
 const filename=new URL('../fixtures/libraries.zip',import.meta.url),lock=JSON.parse(await fs.readFile(new URL('../fixtures/libraries.lock.json',import.meta.url),'utf8'));
 expect(createHash('sha256').update(await fs.readFile(filename)).digest('hex')).toBe(lock.sha256);
 const zip=await load('yauzl-promise').open(fileURLToPath(filename));
 try{for await(const entry of zip){const target=path.join(root,'libraries',entry.filename);if(entry.filename.endsWith('/')){await fs.mkdir(target,{recursive:true});continue;}await fs.mkdir(path.dirname(target),{recursive:true});const chunks=[];for await(const chunk of await entry.openReadStream())chunks.push(chunk);await fs.writeFile(target,Buffer.concat(chunks));}}finally{await zip.close();}
}
async function entries(filename:string) {
 const zip=await load('yauzl-promise').open(filename),files=new Map<string,Buffer>();
 try{for await(const entry of zip){const chunks=[];for await(const chunk of await entry.openReadStream())chunks.push(chunk);files.set(entry.filename,Buffer.concat(chunks));}}finally{await zip.close();}return files;
}
test('native HTML and metadata policy blocks changes without rewriting answers or formulas',async()=>{
 const activity={title:'Policy',language:'en',license:'U',library:'H5P.Test 1.0',params:{question:'<p>\\(x^2\\)</p>'}};
 const libraries={getLibrary:async()=>({runnable:1}),getSemantics:async()=>[{name:'question',type:'text',widget:'html',tags:['p','a']}]};
 const context={libraries,coreApiVersion:{major:1,minor:28}};
 expect((await prepareActivity(context,activity)).ok).toBe(true);
 for(const question of ['<script>alert(1)</script>','<p onclick="alert(1)">x</p>','<a href="javascript:alert(1)">x</a>','<iframe src="https://example.com"></iframe>']){
  const input={...activity,params:{question}},report=await prepareActivity(context,input);
  expect(report.ok).toBe(false);expect(report.transformations[0].pointer).toBe('/params/question');expect(input.params.question).toBe(question);
 }
 for(const changes of [{title:''},{language:'es-419'},{license:'invented'}])expect((await prepareActivity(context,{...activity,...changes})).ok).toBe(false);
});

test('native content backend exports corpus, verified media and runtime dependencies through workers',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-native-corpus-')),engine=new Engine();
 try{
  await fixture(root);const examples:Native[]=[];
  for(const name of ['true-false','multiple-choice','question-set','accordion'])examples.push(JSON.parse(await fs.readFile(new URL(`../../.agents/skills/h5p-authoring/examples/${name}.json`,import.meta.url),'utf8')));
  examples.push({title:'Blanks',library:'H5P.Blanks 1.14',params:{text:'<p>Complete</p>',questions:['A *metre*.']}});
  examples.push({title:'Math',library:'H5P.TrueFalse 1.8',params:{question:'<p>\\(1+1=2\\)</p>',correct:'true'}});
  const image=path.join(root,'image.png'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64');await fs.writeFile(image,png);
  examples.push({title:'Image',library:'H5P.TrueFalse 1.8',assets:{image},params:{question:'<p>Image?</p>',correct:'true',media:{type:{library:'H5P.Image 1.1',params:{file:{path:'asset:image',mime:'image/png'},alt:'Image'}}}}});
  for(const [index,example] of examples.entries()){
   const activity={language:'en',license:'U',...example},request={backend:'native-content' as const,data_dir:root};
   const prepared=await engine.run({...request,action:'prepare',activity}) as Native;expect(prepared.ok).toBe(true);expect(prepared.activity.preparation.version).toBe(2);
   const output=path.join(root,`case-${index}.h5p`),result=await engine.run({...request,action:'export',activity:prepared.activity,path:output}) as Native;
   expect(result.export_mode).toBe('content-only');expect(result.verification.importation).toBe('not_run');await preflight(output,true);
   const files=await entries(output);expect([...files.keys()].every(name=>name==='h5p.json'||name.startsWith('content/'))).toBe(true);
   const content=JSON.parse(files.get('content/content.json')!.toString()),metadata=JSON.parse(files.get('h5p.json')!.toString());
   expect(metadata).not.toHaveProperty('dynamicDependencies');expect(metadata.mainLibrary).toBe(example.library.split(' ')[0]);expect(content).toEqual(result.content_json);
   expect(metadata.preloadedDependencies.some((item:Native)=>item.machineName.startsWith('H5PEditor'))).toBe(false);
   if(example.title==='Math'){expect(content.question).toBe(example.params.question);expect(metadata.preloadedDependencies.some((item:Native)=>item.machineName==='H5P.MathDisplay')).toBe(true);}
   if(example.title==='Image'){expect(files.get('content/'+content.media.type.params.file.path)).toEqual(png);expect(content.media.type.params.file.width).toBe(1);}
  }
 }finally{await engine.close();await fs.rm(root,{recursive:true,force:true});}
},120000);

test('native exports reject drift and preserve destinations on collision, limit or cancellation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-native-failures-')),engine=new Engine();
 const oldLimit=process.env.H5P_MCP_MAX_ZIP_ARCHIVE_BYTES;
 try{
  await fixture(root);
  const activity={title:'Failure tests',language:'en',license:'U',library:'H5P.TrueFalse 1.8',params:{question:'<p>True?</p>',correct:'true'}};
  const request={backend:'native-content' as const,data_dir:root};
  const report=await engine.run({...request,action:'prepare',activity}) as Native;
  const output=path.join(root,'existing.h5p');await fs.writeFile(output,'original');
  await expect(engine.run({...request,action:'export',activity,path:output})).rejects.toMatchObject({code:'EEXIST'});expect(await fs.readFile(output,'utf8')).toBe('original');
  const metadataFile=path.join(root,'libraries/H5P.TrueFalse-1.8/library.json'),metadata=JSON.parse(await fs.readFile(metadataFile,'utf8'));metadata.patchVersion++;metadata.embedTypes=['iframe'];await fs.writeFile(metadataFile,JSON.stringify(metadata));
  await expect(engine.run({...request,action:'export',activity:report.activity,path:path.join(root,'drift.h5p')})).rejects.toMatchObject({code:'STALE_PREPARATION'});expect(await fs.exists(path.join(root,'drift.h5p'))).toBe(false);
  const fresh=await engine.run({...request,action:'export',activity,path:path.join(root,'iframe.h5p')}) as Native;expect(fresh.h5p_json.embedTypes).toEqual(['iframe']);
  process.env.H5P_MCP_MAX_ZIP_ARCHIVE_BYTES='32';await expect(engine.run({...request,action:'export',activity,path:path.join(root,'limit.h5p')})).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});expect(await fs.exists(path.join(root,'limit.h5p'))).toBe(false);
  const controller=new AbortController();controller.abort();await expect(engine.run({...request,action:'export',activity,path:path.join(root,'cancelled.h5p')},controller.signal)).rejects.toBeDefined();expect(await fs.exists(path.join(root,'cancelled.h5p'))).toBe(false);
  expect((await fs.readdir(root)).some(name=>name.startsWith('.h5p-core-'))).toBe(false);
 }finally{if(oldLimit===undefined)delete process.env.H5P_MCP_MAX_ZIP_ARCHIVE_BYTES;else process.env.H5P_MCP_MAX_ZIP_ARCHIVE_BYTES=oldLimit;await engine.close();await fs.rm(root,{recursive:true,force:true});}
},120000);

test('native storage supports the same verified container as both audio and video',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-native-container-')),engine=new Engine();
 try{
  const directory=path.join(root,'libraries/H5P.Container-1.0');await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'library.json'),JSON.stringify({machineName:'H5P.Container',majorVersion:1,minorVersion:0,patchVersion:0,runnable:1}));
  await fs.writeFile(path.join(directory,'semantics.json'),JSON.stringify([{name:'sound',type:'audio'},{name:'clip',type:'video'}]));
  // Signature fixture only; this does not claim codec or browser validity.
  const bytes=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex'),filename=path.join(root,'container.mp4');await fs.writeFile(filename,bytes);
  const activity={title:'Shared container',language:'en',license:'U',library:'H5P.Container 1.0',assets:{media:filename},params:{sound:[{path:'asset:media',mime:'audio/mp4'}],clip:[{path:'asset:media',mime:'video/mp4'}]}};
  const output=path.join(root,'container.h5p'),result=await engine.run({backend:'native-content',action:'export',data_dir:root,activity,path:output}) as Native;
  const files=await entries(output);expect(result.content_json.sound[0].path.endsWith('.m4a')).toBe(true);expect(result.content_json.clip[0].path.endsWith('.mp4')).toBe(true);
  expect(files.get('content/'+result.content_json.sound[0].path)).toEqual(bytes);expect(files.get('content/'+result.content_json.clip[0].path)).toEqual(bytes);expect(await fs.readFile(filename)).toEqual(bytes);
 }finally{await engine.close();await fs.rm(root,{recursive:true,force:true});}
},30000);

test('default export preserves permitted content without the legacy sanitizer',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-legacy-preservation-')),engine=new Engine();
 try{
  await fixture(root);
  const semanticsFile=path.join(root,'libraries/H5P.TrueFalse-1.8/semantics.json');
  const semantics=JSON.parse(await fs.readFile(semanticsFile,'utf8'));
  semantics.find((field:Native)=>field.name==='question').tags.push('a');
  await fs.writeFile(semanticsFile,JSON.stringify(semantics));
  const activity={title:'Preservation',language:'en',license:'U',library:'H5P.TrueFalse 1.8',params:{question:'<p><a href="https://example.com" title="Keep this">Question</a></p>',correct:'true'}};
  const prepared=await engine.run({action:'prepare',data_dir:root,activity}) as Native;
  expect(prepared.ok).toBe(true);
  const output=path.join(root,'changed.h5p');
  const exported=await engine.run({action:'export',data_dir:root,activity:prepared.activity,path:output}) as Native;
  expect(exported.content_json.question).toBe(activity.params.question);
  expect(await fs.exists(output)).toBe(true);
  expect(activity.params.question).toContain('title="Keep this"');
 }finally{await engine.close();await fs.rm(root,{recursive:true,force:true});}
},30000);

test('native full export preserves every pinned library file and keeps editor dependencies out of runtime metadata',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-full-native-')),engine=new Engine();
 try{
  await fixture(root);const activity={title:'Full quiz',language:'en',license:'U',library:'H5P.QuestionSet 1.21',params:{introPage:{showIntroPage:false},questions:[{library:'H5P.TrueFalse 1.8',params:{question:'<p>True?</p>',correct:'true'}}],endGame:{showAnimations:false,skippable:false}}};
  const mainFile=path.join(root,'libraries/H5P.QuestionSet-1.21/library.json'),main=JSON.parse(await fs.readFile(mainFile,'utf8'));
  main.dynamicDependencies=[{machineName:'H5P.Audio',majorVersion:1,minorVersion:5}];await fs.writeFile(mainFile,JSON.stringify(main));
  const output=path.join(root,'full.h5p'),result=await engine.run({action:'export',backend:'native-content',export_mode:'with-libraries',data_dir:root,activity,path:output}) as Native;
  expect(result.h5p_json.dynamicDependencies).toEqual([{machineName:'H5P.Audio',majorVersion:1,minorVersion:5}]);
  expect(result.h5p_json.preloadedDependencies.some((item:Native)=>item.machineName==='H5P.Audio')).toBe(false);
  expect(result.export_mode).toBe('with-libraries');await preflight(output,true);
  const files=await entries(output);let count=2;
  for(const [name,library] of Object.entries(result.preparation_manifest.libraries) as Array<[string,Native]>){
   const folder=name.replace(' ','-');for(const [file,digest] of Object.entries(library.files)){count++;expect(createHash('sha256').update(files.get(folder+'/'+file)!).digest('hex')).toBe(digest as string);}
  }
  expect(files.size).toBe(count);expect([...files.keys()].some(name=>name.startsWith('H5PEditor.'))).toBe(true);expect([...files.keys()].some(name=>name.includes('/language/es.json'))).toBe(true);
  expect(result.h5p_json.preloadedDependencies.some((item:Native)=>item.machineName.startsWith('H5PEditor.'))).toBe(false);expect(result.verification.importation).toBe('not_run');
 }finally{await engine.close();await fs.rm(root,{recursive:true,force:true});}
},120000);

test('native package validation is read-only, installation detects conflicts, and Hub requests are explicit',async()=>{
 const {validatePackage,installPackage}=await import('../../src/h5p/packages.js'),{query}=await import('../../src/h5p/catalog.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-package-ops-')),engine=new Engine();let server:ReturnType<typeof Bun.serve>|undefined;
 try{
  await fixture(root);const filename=path.join(root,'full.h5p');await engine.run({action:'export',backend:'native-content',export_mode:'with-libraries',data_dir:root,path:filename,activity:{title:'Native',language:'en',license:'U',library:'H5P.TrueFalse 1.8',params:{question:'<p>Correct?</p>',correct:'true'}}});
  expect((await validatePackage(filename)).engine).toBe('native-package-v1');
  const target=path.join(root,'target');expect((await installPackage(filename,target)).ok).toBe(true);expect((await installPackage(filename,target)).ok).toBe(true);
  await fs.appendFile(path.join(target,'libraries/H5P.TrueFalse-1.8/semantics.json'),' ');await expect(installPackage(filename,target)).rejects.toMatchObject({code:'LIBRARY_VERSION_MISMATCH'});
  const empty=path.join(root,'empty');await fs.mkdir(empty);expect((await query({action:'discover',data_dir:empty,offset:0,limit:20})).total).toBe(0);expect(await fs.readdir(empty)).toEqual([]);
  let hits=0;server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async request=>{hits++;const url=new URL(request.url);if(url.pathname==='/sites')return Response.json({uuid:'native-test-site'});if(request.method==='POST')return Response.json({contentTypes:[{id:'H5P.TrueFalse',title:'True False',version:{major:1,minor:8,patch:21},coreApiVersionNeeded:{major:1,minor:28}}]});return new Response(await fs.readFile(filename));}});
  const base=`http://127.0.0.1:${server.port}/`;await fs.writeFile(path.join(empty,'config.json'),JSON.stringify({hubRegistrationEndpoint:base+'sites',hubContentTypesEndpoint:base+'types/'}));
  await query({action:'discover',data_dir:empty,offset:0,limit:20});expect(hits).toBe(0);
  expect((await query({action:'discover',refresh:true,data_dir:empty,offset:0,limit:20})).total).toBe(1);expect(hits).toBe(2);
  await query({action:'discover',data_dir:empty,offset:0,limit:20});expect(hits).toBe(2);
  const installed=await query({action:'schema',install_if_missing:true,machine_name:'H5P.TrueFalse',data_dir:empty});expect(installed.library).toBe('H5P.TrueFalse 1.8');expect(hits).toBe(4);
 }finally{await server?.stop(true);await engine.close();await fs.rm(root,{recursive:true,force:true});}
},120000);

test('native subcontent supplies missing titles, preserves metadata and rejects invalid shapes',async()=>{
 const libraries={getLibrary:async()=>({runnable:1,title:'Default child title'}),getSemantics:async(version:Native)=>version.machineName==='H5P.Parent'?[{name:'child',type:'library',options:['H5P.Child 1.0']}]:[]};
 const context={libraries,coreApiVersion:{major:1,minor:28}};
 const input:Native={title:'Parent',language:'en',license:'U',library:'H5P.Parent 1.0',params:{child:{library:'H5P.Child 1.0',params:{}}}};
 const before=JSON.stringify(input),prepared=await prepareActivity(context,input);
 expect(prepared.ok).toBe(true);expect(prepared.activity.params.child.metadata).toEqual({title:'Default child title'});expect(JSON.stringify(input)).toBe(before);
 expect((await prepareActivity(context,prepared.activity)).activity.params).toEqual(prepared.activity.params);
 for(const metadata of [{title:'Explicit title',license:'CC BY',authors:[{name:'Teacher',role:'Author'}]},{title:''},{license:'CC BY'}]){
  input.params.child.metadata=metadata;
  const result=await prepareActivity(context,input);expect(result.ok).toBe(true);
  expect(result.activity.params.child.metadata).toEqual({title:'Default child title',...metadata});
 }
 for(const title of ['<img src=x onerror=alert(1)>','<svg onload=alert(1)>x</svg>','<a href="javascript:alert(1)">x</a>']){
  input.params.child.metadata={title};const result=await prepareActivity(context,input);
  expect(result.ok).toBe(false);expect(result.diagnostics.some((item:Native)=>item.code==='CONTENT_TRANSFORMATION_REQUIRED')).toBe(true);
  expect(result.transformations[0].pointer).toBe('/params/child/metadata/title');expect(input.params.child.metadata.title).toBe(title);
 }
 for(const metadata of [null,[],42,{title:null},{title:42}]){
  input.params.child.metadata=metadata;
  const result=await prepareActivity(context,input);expect(result.ok).toBe(false);
  expect(result.diagnostics.some((item:Native)=>item.code==='INVALID_METADATA'&&item.pointer.startsWith('/params/child/metadata'))).toBe(true);
 }
});

test('exported QuestionSet runs its pinned final screen for zero/full scores and exposes retry',async()=>{
 const {runInNewContext}=await import('node:vm');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-final-screen-')),engine=new Engine();
 try{
  await fixture(root);
  const example=JSON.parse(await fs.readFile(new URL('../../.agents/skills/h5p-authoring/examples/question-set.json',import.meta.url),'utf8'));
  const output=path.join(root,'fixed.h5p');
  await engine.run({action:'export',data_dir:root,path:output,activity:{language:'en',license:'U',...example}});
  const files=await entries(output),params=JSON.parse(files.get('content/content.json')!.toString());
  expect(params.questions[0].metadata.title).toBe('True/False Question');
  const runtime=files.get('H5P.QuestionSet-1.21/js/questionset.js')!.toString();
  const match=runtime.match(/var _displayEndGame = (function \(\) \{[\s\S]*?\n  \});\s*\n\s*var registerImageLoadedListener/);
  expect(match).not.toBeNull();
  function finish(content:Native,score:number){
   const screens:Native[]=[],buttons:Native[]=[],completed:Native[]=[];let retries=0,shownScore=-1;
   // Only the DOM/host boundary is stubbed; execute the unmodified final-screen function.
   const dom:Native={0:{appendChild:()=>{}},children:()=>dom,hide:()=>dom,filter:()=>dom,remove:()=>dom,removeClass:()=>dom,append:()=>dom,html:()=>dom,show:()=>dom};
   const self:Native={getScore:()=>score,getMaxScore:()=>1,trigger:()=>{},triggerXAPICompleted:(...args:Native[])=>completed.push(args),resetTask:()=>{retries++;},$progressAnnouncer:dom};
   const H5P={Question:{determineOverallFeedback:()=>''},Components:{ResultScreen:(options:Native)=>{screens.push(options);return {};},Button:(options:Native)=>{buttons.push(options);return {};}},JoubelUI:{createScoreBar:()=>({appendTo:()=>{},setMaxScore:()=>{},setScore:(value:number)=>{shownScore=value;}})}};
   runInNewContext('('+match![1]+')()',{params:content,self,H5P,$:()=>dom,$myDom:dom,rendered:false,scoreBar:undefined,questionInstances:[self],setTimeout:(fn:()=>void)=>fn(),showSolutions:()=>{},_showQuestion:()=>{}});
   expect(completed).toEqual([[score,1,score===1]]);
   expect(screens[0].questionGroups[0].questions).toEqual([{title:content.questions[0].metadata.title,points:score+'/1'}]);
   expect(shownScore).toBe(score);
   const retry=buttons.find(button=>button.class==='qs-retrybutton');expect(retry).toBeDefined();retry.onClick();expect(retries).toBe(1);
  }
  for(const score of [0,1])finish(params,score);
  const broken=structuredClone(params);delete broken.questions[0].metadata;
  expect(()=>finish(broken,1)).toThrow("title");
 }finally{await engine.close();await fs.rm(root,{recursive:true,force:true});}
},120000);
