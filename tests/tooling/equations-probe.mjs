// bun tests/tooling/equations-probe.mjs <baseline package root> <fresh output dir> <fixture data dir>
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const [baseline,output,data]=process.argv.slice(2);
const repo=path.resolve(import.meta.dirname,'../..');
const load=createRequire(path.join(repo,'package.json'));
const moduleAt=(root,name)=>import(pathToFileURL(path.join(root,'dist/core',name)).href);
const plain=(library,params)=>({library,params,title:'Equation check',language:'en',license:'U'});
const id='3da49351-f362-4121-96ab-a4aa7fb6f4c8';
const cases={
 control:plain('H5P.TrueFalse 1.8',{question:'<p>Seconds measure time.</p>',correct:'true'}),
 feedback:plain('H5P.TrueFalse 1.8',{question:'<p>Two halves make a whole.</p>',correct:'true',
  behaviour:{enableRetry:true,feedbackOnWrong:'Try counting both halves: \\(1+1=2\\).',feedbackOnCorrect:'Each half contributes \\(\\frac{1}{2}\\).'}}),
 option:plain('H5P.MultiChoice 1.16',{question:'<p>Which expression means half?</p>',answers:[{text:'<p>\\(\\frac{1}{2}\\)</p>',correct:true},{text:'<p>Two</p>',correct:false}]}),
 accordion:plain('H5P.Accordion 1.0',{panels:[{title:'Density',content:{library:'H5P.AdvancedText 1.1',subContentId:id,params:{text:'<p>\\[\\rho=\\frac{m}{V}\\]</p>'}}}]}),
 blanks:plain('H5P.QuestionSet 1.21',{introPage:{showIntroPage:false},endGame:{showAnimations:false,skippable:false},
  questions:[{library:'H5P.Blanks 1.14',subContentId:id,params:{text:'<p>Use \\(v=d/t\\) for 60 m in 12 s.</p>',questions:['<p>Speed: *5/5.0* m/s</p>'],behaviour:{enableRetry:true,acceptSpellingErrors:false}}}]})
};
async function hashes(file){
 const zip=await load('yauzl-promise').open(file),members={};
 try{for await(const item of zip){const hash=createHash('sha256');for await(const chunk of await item.openReadStream())hash.update(chunk);members[item.filename]=hash.digest('hex');}}
 finally{await zip.close();}
 return members;
}
await fs.mkdir(output,{recursive:false});
const packages=[],checks=[];
const {validatePackage}=await moduleAt(repo,'h5p/packages.js');
for(const [name,activity] of Object.entries(cases)){
 const reference={};
 for(const [variant,root] of [['base',baseline],['candidate',repo]]){
  const {executeNative}=await moduleAt(root,'h5p/native-content.js');
  for(const mode of ['content-only','with-libraries']){
   const dir=path.join(output,variant,mode);await fs.mkdir(dir,{recursive:true});
   const file=path.join(dir,name+'.h5p');
   const exported=await executeNative({action:'export',activity,data_dir:data,path:file,export_mode:mode});
   const members=await hashes(file),full=mode==='with-libraries',math=name!=='control';
   assert.equal(exported.h5p_json.preloadedDependencies.some(d=>d.machineName==='H5P.MathDisplay'),math);
   assert.equal(Object.keys(members).some(k=>k.startsWith('H5P.MathDisplay-1.0/')),full&&math);
   if(!full)assert.deepEqual(Object.keys(members).sort(),['content/content.json','h5p.json']);
   if(variant==='base'){reference[mode]=members;continue;}
   assert.deepEqual(members,reference[mode],name+' '+mode);
   if(full){assert.equal((await validatePackage(file)).ok,true);packages.push({file});}
   checks.push({name,mode,identicalMembers:Object.keys(members).length,math});
  }
 }
}
const {prepareNative}=await moduleAt(repo,'h5p/native-content.js');
const missingDir=path.join(output,'missing');
await fs.mkdir(missingDir);
for(const lib of ['H5P.TrueFalse-1.8'])await fs.cp(path.join(data,'libraries',lib),path.join(missingDir,lib),{recursive:true});
const missing=await prepareNative(cases.feedback,missingDir);
assert(missing.diagnostics.some(d=>d.reason==='math_library'&&d.code==='LIBRARY_NOT_INSTALLED'));
const {compatibility}=await moduleAt(repo,'storage/vault.js');
assert.equal(compatibility({}, {},undefined).code,'TARGET_INVENTORY_UNKNOWN');
await fs.writeFile(path.join(output,'corpus.json'),JSON.stringify({packages,checks,missingAddon:'verified',unknownInventory:'verified'},null,2));
console.log(JSON.stringify(checks));
