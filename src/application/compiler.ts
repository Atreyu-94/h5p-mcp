import fs from 'node:fs';
import path from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import {repositoryRoot} from '../infrastructure/runtime.js';
import {FileLibraryRepository} from '../h5p/libraries.js';
import {libraryVersion} from '../h5p/dependencies.js';
import {prepareNative} from '../h5p/native-content.js';
import {checkTree} from '../domain/limits.js';
import {semanticHash,stableId,renderText} from '../domain/authoring-source.js';
import type {Native} from '../domain/types.js';
const read=(name:string)=>JSON.parse(fs.readFileSync(path.join(repositoryRoot,'h5p_mcp/contracts',name),'utf8'));
export const authoringSchema=read('authoring-v1.json'),adapters=read('authoring-adapters-v1.json');
const validate=new Ajv2020({strict:false,allErrors:true}).compile<Native>(authoringSchema);
const escape=(part:string)=>part.replaceAll('~','~0').replaceAll('/','~1');
export async function compileSource(source:Native,libraries:string) {
 checkTree(source);
 const diagnostics:Native[]=[],warnings:string[]=[],sourceMap:Record<string,string>={},identities:Record<string,string>={};
 const error=(pointer:string,reason:string,stage='source')=>diagnostics.push({pointer,reason,stage,code:'SCHEMA_VALIDATION_FAILED'});
 const finish=(extra:Native={})=>({ok:!diagnostics.length,diagnostics,warnings,transformations:[],mathematics:{detected:false},source_map:sourceMap,identities,...extra});
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
 const fields=await pin(source.library,'/library',source.type==='true_false'?'H5P.TrueFalse 1.8':'H5P.MultiChoice 1.16');
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
 function text(value:Native,at:string,native:string){sourceMap[native]=at;try{return renderText(value);}catch{error(at,'markdown');return '';}}
 params.question=text(source.question,'/question','/params/question');
 params.behaviour={enableRetry:normalized.retry,enableSolutionsButton:normalized.show_solution,enableCheckButton:true,autoCheck:false};
 sourceMap['/params/behaviour/enableRetry']='/retry';sourceMap['/params/behaviour/enableSolutionsButton']='/show_solution';
 if(source.type==='true_false'){
  params.correct=String(source.correct);sourceMap['/params/correct']='/correct';
  if(source.feedback){params.behaviour.feedbackOnCorrect=text(source.feedback.correct,'/feedback/correct','/params/behaviour/feedbackOnCorrect');params.behaviour.feedbackOnWrong=text(source.feedback.incorrect,'/feedback/incorrect','/params/behaviour/feedbackOnWrong');}
 }else{
  params.answers=source.choices.map((choice:Native,i:number)=>{
   const prefix=`/params/answers/${i}`,origin=`/choices/${i}`;sourceMap[prefix]=origin;sourceMap[prefix+'/correct']='/correct_ids';
   const answer:Native={text:text(choice.text,origin+'/text',prefix+'/text'),correct:source.correct_ids.includes(choice.id)};
   for(const [key,field] of [['selected_feedback','chosenFeedback'],['unselected_feedback','notChosenFeedback']])if(choice[key]){answer.tipsAndFeedback??={};answer.tipsAndFeedback[field]=text(choice[key],origin+'/'+key,prefix+'/tipsAndFeedback/'+field);}
   return answer;
  });
  Object.assign(params.behaviour,{type:source.mode==='single'?'single':'multi',singlePoint:source.scoring==='all_or_nothing',randomAnswers:normalized.shuffle,passPercentage:100});
  sourceMap['/params/behaviour/type']='/mode';sourceMap['/params/behaviour/singlePoint']='/scoring';sourceMap['/params/behaviour/randomAnswers']='/shuffle';
  // H5P uses floored percentage for feedback selection (Question.determineOverallFeedback).
  if(source.feedback)params.overallFeedback=[{from:0,to:99,feedback:text(source.feedback.incorrect,'/feedback/incorrect','/params/overallFeedback/0/feedback')},{from:100,to:100,feedback:text(source.feedback.correct,'/feedback/correct','/params/overallFeedback/1/feedback')}];
 }
 async function translations(schema:Native[],version:string,target:Native,roots:string[],prefix:string){
  let translated:Native[]=[],missingDefault=false;
  if(normalized.ui.language!=='en'){
   try{const value=await repo.getTranslation(libraryVersion(version),normalized.ui.language);if(!Array.isArray(value.semantics))throw new Error();translated=value.semantics;}
   catch{if(normalized.ui.missing==='error')error('/ui/language','translation','adapter');else warnings.push('Translation unavailable for '+version+'; using English defaults.');}
  }
  function fill(entries:Native[],local:Native[],out:Native,at:string){
   entries.forEach((entry,i)=>{
    const here=at+'/'+escape(entry.name);
    if(entry.type==='group'){out[entry.name]??={};fill(entry.fields||[],local?.[i]?.fields||[],out[entry.name],here);}
    else if(entry.type==='text'&&typeof entry.default==='string'){
     out[entry.name]=typeof local?.[i]?.default==='string'?local[i].default:entry.default;sourceMap[here]='/ui/language';
     const key=here.slice('/params/'.length);
     if(translated.length&&typeof local?.[i]?.default!=='string'&&!Object.hasOwn(normalized.ui.overrides,key))missingDefault=true;
     if(Object.hasOwn(normalized.ui.overrides,key)){out[entry.name]=normalized.ui.overrides[key];sourceMap[here]='/ui/overrides/'+escape(key);usedOverrides.add(key);}
    }
   });
  }
  schema.forEach((entry,i)=>{if(roots.includes(entry.name)){if(entry.type==='group'){target[entry.name]??={};fill(entry.fields||[],translated[i]?.fields||[],target[entry.name],prefix+'/'+entry.name);}else fill([entry],[translated[i]],target,prefix);}});
  if(missingDefault){if(normalized.ui.missing==='error')error('/ui/language','translation','adapter');else warnings.push('Translation unavailable for some interface fields in '+version+'; using English defaults.');}
 }
 const usedOverrides=new Set<string>();
 await translations(fields!,source.library.name,params,source.type==='true_false'?['l10n','confirmCheck','confirmRetry']:['UI','confirmCheck','confirmRetry'],'/params');
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
 let prepared:Native;
 try{prepared=await prepareNative(activity,libraries);}catch(cause:Native){diagnostics.push({pointer:'',stage:'adapter',reason:'adapter',code:cause.code||'LIBRARY_NOT_INSTALLED'});return finish({normalized});}
 const locate=(pointer:string)=>{let at=pointer;while(at){if(Object.hasOwn(sourceMap,at)){const origin=sourceMap[at];let current:Native=source;for(const part of origin.slice(1).split('/')){const key=part.replaceAll('~1','/').replaceAll('~0','~');if(!current||typeof current!=='object'||!Object.hasOwn(current,key))return '';current=current[key];}return origin;}at=at.slice(0,at.lastIndexOf('/'));}return '';};
 for(const item of prepared.diagnostics)diagnostics.push({...item,pointer:locate(item.pointer),stage:'native',reason:locate(item.pointer)?'native':'adapter'});
 return finish({...prepared,ok:!diagnostics.length,diagnostics,warnings:[...warnings,...prepared.warnings],transformations:prepared.transformations.map((item:Native)=>({...item,pointer:locate(item.pointer)})),normalized,source_map:sourceMap,identities});
}
