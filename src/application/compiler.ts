import {sourceScoring} from './source-scoring.js';
import fs from 'node:fs';
import path from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import {repositoryRoot} from '../infrastructure/runtime.js';
import {FileLibraryRepository} from '../h5p/libraries.js';
import {libraryVersion} from '../h5p/dependencies.js';
import {prepareNative} from '../h5p/native-content.js';
import {scanNotation,warningLimit,type MathWarning,type MathMode} from '../domain/notation.js';
import {playbackText} from '../domain/content-policy.js';
import {checkTree} from '../domain/limits.js';
import {semanticHash,stableId,renderText,escapeHtml} from '../domain/authoring-source.js';
import type {Native} from '../domain/types.js';
const read=(name:string)=>JSON.parse(fs.readFileSync(path.join(repositoryRoot,'h5p_mcp/contracts',name),'utf8'));
export const authoringSchema=read('authoring-v1.json'),adapters=read('authoring-adapters-v1.json');
const validate=new Ajv2020({strict:false,allErrors:true}).compile<Native>(authoringSchema);
const escape=(part:string)=>part.replaceAll('~','~0').replaceAll('/','~1');
export async function compileSource(source:Native,libraries:string,prepare=true) {
 checkTree(source);
 const diagnostics:Native[]=[],warnings:string[]=[],sourceMap:Record<string,string>={},identities:Record<string,string>={};
 const mathWarnings:MathWarning[]=[];
 const addWarning=(issue:MathWarning)=>{if(mathWarnings.length<warningLimit)mathWarnings.push(issue);};
 const mathError=(pointer:string,mode:MathMode)=>{if(diagnostics.length<=100)diagnostics.push({pointer,reason:'math_'+mode,stage:'source',code:'MATH_DELIMITER_INVALID'});};
 const error=(pointer:string,reason:string,stage='source')=>diagnostics.push({pointer,reason,stage,code:'SCHEMA_VALIDATION_FAILED'});
 const finish=(extra:Native={})=>({ok:!diagnostics.length,diagnostics,warnings,mathWarnings,transformations:[],mathematics:{detected:false},source_map:sourceMap,identities,...extra});
 if(!validate(source)){
  for(const issue of validate.errors||[]){const key=issue.params.missingProperty??issue.params.additionalProperty;error(issue.instancePath+(key?'/'+escape(String(key)):''),'structure');}
  return finish();
 }
 const normalized=structuredClone(source);normalized.language??='en';normalized.license??='U';normalized.retry??=true;normalized.show_solution??=true;normalized.assets??={};
 normalized.ui={language:'en',missing:'error',overrides:{},...normalized.ui};
 const repo=new FileLibraryRepository(libraries);
 async function pin(value:Native,pointer:string,expected:string){
  if(value.name!==expected){error(pointer,'adapter','adapter');return;}
  try{
   const version=libraryVersion(value.name),metadata=await repo.getLibrary(version),fields=await repo.getSemantics(version),hash=semanticHash(fields),supported=adapters[value.name];
   if(metadata.patchVersion!==value.patch||hash!==value.semantics_sha256||supported.patch!==value.patch||supported.semantics_sha256!==hash){error(pointer,'pin','adapter');return;}
   return fields;
  }catch{error(pointer,'library','adapter');}
 }
 const fields=await pin(source.library,'/library',({true_false:'H5P.TrueFalse 1.8',multi_choice:'H5P.MultiChoice 1.16',question_set:'H5P.QuestionSet 1.21',blanks:'H5P.Blanks 1.14',accordion:'H5P.Accordion 1.0'} as Record<string,string>)[source.type]);
 const seen=new Set<string>([source.id]);identities[source.id]=stableId(source.project_id,source.id);
 const claim=(id:string,at:string)=>{if(seen.has(id))error(at,'duplicate');seen.add(id);identities[id]=stableId(source.project_id,source.id,id);};
 if(source.type==='multi_choice'){
  const ids=new Set(source.choices.map((c:Native)=>c.id));source.choices.forEach((c:Native,i:number)=>claim(c.id,`/choices/${i}/id`));
  source.correct_ids.forEach((id:string,i:number)=>{if(!ids.has(id))error(`/correct_ids/${i}`,'reference');});
  if(source.mode==='single'&&source.correct_ids.length!==1)error('/correct_ids','cardinality');
  if(source.mode==='single'&&source.scoring!=='all_or_nothing')error('/scoring','scoring');
  normalized.shuffle??=false;
 }
 let imageFields:Native;
 if(source.image){claim(source.image.id,'/image/id');imageFields=await pin(source.image.library,'/image/library','H5P.Image 1.1');if(!Object.hasOwn(normalized.assets,source.image.asset))error('/image/asset','reference');}
 if(diagnostics.length)return finish({normalized});
 const params:Native={};
 function text(value:Native,at:string,native:string){sourceMap[native]=at;try{return renderText(value);}catch(cause:Native){if(cause.mathMode)mathError(at+'/value',cause.mathMode);else error(at,'markdown');return '';}}
 if(['true_false','multi_choice','blanks'].includes(source.type)){
  params.question=text(source.question,'/question','/params/question');
  params.behaviour={enableRetry:normalized.retry,enableSolutionsButton:normalized.show_solution,enableCheckButton:true,autoCheck:false};
  sourceMap['/params/behaviour/enableRetry']='/retry';sourceMap['/params/behaviour/enableSolutionsButton']='/show_solution';
 }
 if(source.type==='true_false'){
  params.correct=String(source.correct);sourceMap['/params/correct']='/correct';
  if(source.feedback){
   for(const [key,field] of [['correct','feedbackOnCorrect'],['incorrect','feedbackOnWrong']]){
    params.behaviour[field]=playbackText(text(source.feedback[key],'/feedback/'+key,'/params/behaviour/'+field));
   }
  }
 }else if(source.type==='multi_choice'){
  params.answers=source.choices.map((choice:Native,i:number)=>{
   const prefix=`/params/answers/${i}`,origin=`/choices/${i}`;sourceMap[prefix]=origin;sourceMap[prefix+'/correct']='/correct_ids';
   const answer:Native={text:text(choice.text,origin+'/text',prefix+'/text'),correct:source.correct_ids.includes(choice.id)};
   for(const [key,field] of [['hint','tip'],['selected_feedback','chosenFeedback'],['unselected_feedback','notChosenFeedback']])if(choice[key]){answer.tipsAndFeedback??={};answer.tipsAndFeedback[field]=text(choice[key],origin+'/'+key,prefix+'/tipsAndFeedback/'+field);}
   return answer;
  });
  // Compare canonical renderer output so meaningful markup, units and case survive.
  const labels=new Map<string,{correct:boolean,index:number}>();
  const conflicts=new Set<number>();
  params.answers.forEach((answer:Native,index:number)=>{
   const label=answer.text.replace(/[ \t\r\n]+/g,' ').replace(/<p> +/g,'<p>').replace(/ +<\/p>/g,'</p>');
   if(!label)return;
   const previous=labels.get(label);
   if(!previous)labels.set(label,{correct:answer.correct,index});
   else if(previous.correct!==answer.correct){conflicts.add(previous.index);conflicts.add(index);}
  });
  for(const index of conflicts)error('/choices/'+index+'/text','conflicting_choice');
  Object.assign(params.behaviour,{type:source.mode==='single'?'single':'multi',singlePoint:source.scoring==='all_or_nothing',randomAnswers:normalized.shuffle,passPercentage:100});
  sourceMap['/params/behaviour/type']='/mode';sourceMap['/params/behaviour/singlePoint']='/scoring';sourceMap['/params/behaviour/randomAnswers']='/shuffle';
  // H5P uses floored percentage for feedback selection (Question.determineOverallFeedback).
  if(source.feedback)params.overallFeedback=[{from:0,to:99,feedback:playbackText(text(source.feedback.incorrect,'/feedback/incorrect','/params/overallFeedback/0/feedback'))},{from:100,to:100,feedback:playbackText(text(source.feedback.correct,'/feedback/correct','/params/overallFeedback/1/feedback'))}];
 }else if(source.type==='blanks'){
  params.text=params.question;delete params.question;sourceMap['/params/text']='/question';delete sourceMap['/params/question'];
  params.behaviour.caseSensitive=source.case_sensitive;params.behaviour.acceptSpellingErrors=false;
  sourceMap['/params/behaviour/caseSensitive']='/case_sensitive';
  params.questions=source.blocks.map((block:Native,i:number)=>{
   claim(block.id,`/blocks/${i}/id`);let blanks=0;
   function inspectSegment(value:string,pointer:string,answer=false){
    const math=scanNotation(value,'html');
    if(math.invalid)mathError(pointer,math.invalid);
    if(math.dollar)addWarning({kind:'dollar',pointer});
    if(answer&&math.detected)addWarning({kind:'answer',pointer});
   }
   const rendered=block.segments.map((segment:Native,j:number)=>{
    const at=`/blocks/${i}/segments/${j}`;
    if(segment.answers){
     blanks++;claim(segment.id,at+'/id');
     return '*'+segment.answers.map((answer:string,k:number)=>{
      // Pinned Blanks splits raw *, / and : before decoding entities. The native
      // sanitizer decodes numeric escapes, so these literals cannot round-trip.
      if(/[*/:<>\r\n]/.test(answer)||answer.trim()!==answer){error(at+`/answers/${k}`,'delimiter');return '';}
      const rendered=renderText({format:'plain',value:answer}).slice(3,-4);
      inspectSegment(rendered,at+'/answers/'+k,true);
      return rendered;
     }).join('/')+'*';
    }
    const value=text(segment,at,`/params/questions/${i}`);
    inspectSegment(value,at+'/value');
    if(value.includes('*'))error(at,'delimiter');
    return value.slice(3,-4);
   }).join('');
   if(!blanks)error(`/blocks/${i}`,'cardinality');
   sourceMap[`/params/questions/${i}`]=`/blocks/${i}`;
   return '<p>'+rendered+'</p>';
  });
  if(source.feedback){
   params.overallFeedback=['incorrect','correct'].map((key,i)=>{const at='/feedback/'+key;sourceMap[`/params/overallFeedback/${i}/feedback`]=at;if(source.feedback[key].format!=='plain')error(at,'markdown');return {from:i?100:0,to:i?100:99,feedback:source.feedback[key].value};});
  }
 }else if(source.type==='accordion'){
  params.hTag=source.heading??'h2';sourceMap['/params/hTag']='/heading';params.panels=[];
  for(const [i,panel] of source.panels.entries()){
   claim(panel.id,`/panels/${i}/id`);await pin(panel.library,`/panels/${i}/library`,'H5P.AdvancedText 1.1');
   const prefix=`/params/panels/${i}`;sourceMap[prefix+'/title']=`/panels/${i}/title`;
   params.panels.push({title:panel.title,content:{library:panel.library.name,subContentId:identities[panel.id],params:{text:text(panel.text,`/panels/${i}/text`,prefix+'/content/params/text')}}});
  }
 }else{
  // The pinned dot navigator repeats the active index and omits the current-state label.
  params.progressType='textual';
  params.introPage={showIntroPage:false};params.questions=[];params.passPercentage=source.pass_percentage;params.randomQuestions=source.shuffle??false;
  params.endGame={showResultPage:true,showSolutionButton:normalized.show_solution,showRetryButton:normalized.retry,showAnimations:false,skippable:false};
  sourceMap['/params/passPercentage']='/pass_percentage';sourceMap['/params/randomQuestions']='/shuffle';
  sourceMap['/params/endGame/showSolutionButton']='/show_solution';sourceMap['/params/endGame/showRetryButton']='/retry';
  for(const [i,child] of source.questions.entries()){
   const origin=`/questions/${i}`,prefix=`/params/questions/${i}`;
   claim(child.id,origin+'/id');
   const result=await compileSource({schema_version:'1',project_id:source.project_id,language:normalized.language,license:normalized.license,...child,ui:{language:normalized.ui.language,missing:normalized.ui.missing,...child.ui},assets:normalized.assets},libraries,false);
   for(const item of result.diagnostics)diagnostics.push({...item,pointer:origin+item.pointer});
   warnings.push(...result.warnings);
   for(const item of result.mathWarnings)addWarning({...item,pointer:origin+item.pointer});
   if(!result.ok)continue;
   identities[child.id]=result.identities[child.id];
   for(const [id,value] of Object.entries(result.identities))if(id!==child.id)identities[child.id+'/'+id]=value as string;
   for(const [native,at] of Object.entries(result.source_map))if(native.startsWith('/params/'))sourceMap[prefix+native]=origin+at;
   sourceMap[prefix+'/library']=origin+'/library';sourceMap[prefix+'/subContentId']=origin+'/id';
   sourceMap[prefix+'/metadata/title']=origin+'/title';
   params.questions.push({library:child.library.name,metadata:{title:escapeHtml(child.title)},params:result.activity.params,subContentId:identities[child.id]});
  }
  if(source.feedback){
   // QuestionSet feedback is plain text, selected using the floored score percentage.
   const feedback=(key:string,index:number)=>{const at='/feedback/'+key;sourceMap[`/params/endGame/overallFeedback/${index}/feedback`]=at;if(source.feedback[key].format!=='plain')error(at,'markdown');return source.feedback[key].value;};
   params.endGame.overallFeedback=[{from:0,to:source.pass_percentage-1,feedback:feedback('incorrect',0)},{from:source.pass_percentage,to:100,feedback:feedback('correct',1)}];
  }
 }
 async function translations(schema:Native[],version:string,target:Native,roots:string[],prefix:string){
  let translated:Native[]=[],missingDefault=false;
  if(normalized.ui.language!=='en'){
   try{const value=await repo.getTranslation(libraryVersion(version),normalized.ui.language);if(!Array.isArray(value.semantics))throw new Error();translated=value.semantics;}
   catch{if(normalized.ui.missing==='error')error('/ui/language','translation','adapter');else warnings.push('Translation unavailable for '+version+'; using English defaults.');}
  }
  const spanish:Record<string,string>=version==='H5P.QuestionSet 1.21'?{
   'texts/previous':'Anterior','texts/next':'Siguiente','texts/questionSetInstruction':'Elige una pregunta',
   'endGame/message':'Resultados','endGame/amountCorrect':'@finals de @totals correctas','endGame/scoreHeader':'Puntuación'
  }:version==='H5P.Blanks 1.14'?{a11yCheckingModeHeader:'Modo de comprobación'}:{};
  function fill(entries:Native[],local:Native[],out:Native,at:string){
   const hasText=(entry:Native):boolean=>entry.type==='text'&&typeof entry.default==='string'||entry.type==='group'&&(entry.fields||[]).some(hasText);
   entries.forEach((entry,i)=>{
    if(!hasText(entry))return;
    const here=at+'/'+escape(entry.name);
    if(entry.type==='group'){out[entry.name]??={};fill(entry.fields||[],local?.[i]?.fields||[],out[entry.name],here);}
    else if(entry.type==='text'&&typeof entry.default==='string'){
     const fallback=normalized.ui.language==='es'?spanish[here.slice('/params/'.length)]:undefined;
     out[entry.name]=fallback??local?.[i]?.default??entry.default;sourceMap[here]='/ui/language';
     const key=here.slice('/params/'.length);
     if(!fallback&&translated.length&&typeof local?.[i]?.default!=='string'&&!Object.hasOwn(normalized.ui.overrides,key))missingDefault=true;
     if(Object.hasOwn(normalized.ui.overrides,key)){out[entry.name]=normalized.ui.overrides[key];sourceMap[here]='/ui/overrides/'+escape(key);usedOverrides.add(key);}
    }
   });
  }
  schema.forEach((entry,i)=>{if(roots.includes(entry.name)){if(entry.type==='group'){target[entry.name]??={};fill(entry.fields||[],translated[i]?.fields||[],target[entry.name],prefix+'/'+entry.name);}else fill([entry],[translated[i]],target,prefix);}});
  if(missingDefault){if(normalized.ui.missing==='error')error('/ui/language','translation','adapter');else warnings.push('Translation unavailable for some interface fields in '+version+'; using English defaults.');}
 }
 const usedOverrides=new Set<string>();
 const roots=source.type==='true_false'?['l10n','confirmCheck','confirmRetry']:source.type==='multi_choice'?['UI','confirmCheck','confirmRetry']:source.type==='question_set'?['introPage','texts','endGame']:source.type==='blanks'?fields!.filter((f:Native)=>f.common).map((f:Native)=>f.name):[];
 if(roots.length)await translations(fields!,source.library.name,params,roots,'/params');
 if(source.image){
  const picture:Native={file:{path:'asset:'+source.image.asset,mime:source.image.mime,copyright:{license:source.image.copyright.license,authors:[{name:source.image.copyright.author,role:'Author'}]}},alt:source.image.alt,decorative:false};
  params.media={type:{library:'H5P.Image 1.1',subContentId:identities[source.image.id],params:picture}};
  sourceMap['/params/media/type/params/file']='/image';sourceMap['/params/media/type/params/alt']='/image/alt';
  await translations(imageFields,'H5P.Image 1.1',picture,['contentName','expandImage','minimizeImage'],'/params/media/type/params');
 }
 for(const key of Object.keys(normalized.ui.overrides))if(!usedOverrides.has(key))error('/ui/overrides/'+escape(key),'override');
 if(diagnostics.length)return finish({normalized});
 const activity={title:source.title,language:normalized.language,license:normalized.license,library:source.library.name,params,assets:normalized.assets};
 sourceMap['/title']='/title';sourceMap['/language']='/language';sourceMap['/license']='/license';sourceMap['/library']='/library';
 for(const key of Object.keys(normalized.assets))sourceMap['/assets/'+escape(key)]='/assets/'+escape(key);
 if(!prepare)return finish({activity,normalized});
 let prepared:Native;
 try{prepared=await prepareNative(activity,libraries);}catch(cause:Native){diagnostics.push({pointer:'',stage:'adapter',reason:'adapter',code:cause.code||'LIBRARY_NOT_INSTALLED'});return finish({normalized});}
 const locate=(pointer:string)=>{let at=pointer;while(at){if(Object.hasOwn(sourceMap,at)){const origin=sourceMap[at];let current:Native=source;for(const part of origin.slice(1).split('/')){const key=part.replaceAll('~1','/').replaceAll('~0','~');if(!current||typeof current!=='object'||!Object.hasOwn(current,key))return '';current=current[key];}return origin;}at=at.slice(0,at.lastIndexOf('/'));}return '';};
 function mathLocation(native:string){
  const origin=locate(native);
  let value=source;
  if(origin)for(const key of origin.slice(1).split('/'))value=value[key.replaceAll('~1','/').replaceAll('~0','~')];
  return {pointer:origin+(value?.format&&typeof value.value==='string'?'/value':''),block:Array.isArray(value?.segments)};
 }
 for(const item of prepared.diagnostics){
  const math=item.reason?.startsWith('math_');
  const pointer=math?mathLocation(item.pointer).pointer:locate(item.pointer);
  diagnostics.push({...item,pointer,stage:'native',reason:math?item.reason:pointer?'native':'adapter'});
 }
 for(const issue of prepared.mathWarnings||[]){
  const location=mathLocation(issue.pointer);
  // Blanks segments and keys already carry their exact source pointers.
  if(!location.block)addWarning({...issue,pointer:location.pointer});
 }
 return finish({...prepared,...(!diagnostics.length&&prepared.ok?{scoring_preview:sourceScoring(source)}:{}),ok:!diagnostics.length,diagnostics,mathWarnings,warnings:[...warnings,...prepared.warnings],transformations:prepared.transformations.map((item:Native)=>({...item,pointer:locate(item.pointer)})),normalized,source_map:sourceMap,identities});
}
