// Differential oracle retained for at least two stable Bun releases after F4-R.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const load=createRequire(import.meta.url),repo=path.resolve(import.meta.dirname,'../..');
const [bun,output='retirement-parity.json']=process.argv.slice(2);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'h5p-retirement-')),data=path.join(root,'data');
const archive=await fs.readFile(path.join(repo,'tests/fixtures/libraries.zip'));
const expected=JSON.parse(await fs.readFile(path.join(repo,'tests/fixtures/libraries.lock.json'),'utf8'));
assert.equal(createHash('sha256').update(archive).digest('hex'),expected.sha256);
const zip=await load('yauzl-promise').open(path.join(repo,'tests/fixtures/libraries.zip'));
try {
 for await(const entry of zip) {
  const target=path.join(data,'libraries',entry.filename);
  if(entry.filename.endsWith('/')) {await fs.mkdir(target,{recursive:true});continue;}
  await fs.mkdir(path.dirname(target),{recursive:true});
  const chunks=[];for await(const chunk of await entry.openReadStream()) chunks.push(chunk);
  await fs.writeFile(target,Buffer.concat(chunks));
 }
} finally {await zip.close();}
function core(command) {
 const child=spawn(command,[path.join(repo,'dist/core/adapters/ipc.js')],{stdio:['pipe','pipe','inherit'],windowsHide:true});
 const jobs=new Map();let id=0;
 createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line);jobs.get(value.id)?.(value);jobs.delete(value.id);});
 const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('core exit '+code)));});
 return {request:request=>new Promise(resolve=>{const key=String(++id);jobs.set(key,resolve);child.stdin.write(JSON.stringify({id:key,request:{data_dir:data,...request}})+'\n');}),close:async()=>{child.stdin.end();await closed;}};
}
function normalize(value) {
 if(Array.isArray(value)) return value.map(normalize);
 if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='subContentId'?'<validated UUID>':k==='checked_at'?'<observation time>':normalize(v)]));
 return value;
}
const clients=[core(process.execPath),core(bun)];
let comparisons=0;const packages=[];
async function compare(request) {
 const values=await Promise.all(clients.map(client=>client.request(request)));
 const payloads=values.map(({id,...payload})=>normalize(payload));
 assert.deepEqual(payloads[0],payloads[1]);comparisons++;
 return values[1];
}
try {
 await compare({action:'catalog'});
 await compare({action:'discover',offset:0,limit:100,installed_only:true});
 const examples=[];
 for(const name of ['true-false','multiple-choice','accordion','question-set']) examples.push(JSON.parse(await fs.readFile(path.join(repo,'.agents/skills/h5p-authoring/examples',name+'.json'),'utf8')));
 examples.push({title:'Blanks',library:'H5P.Blanks 1.14',params:{text:'<p>Complete</p>',questions:['A *metre*.']}});
 examples.push({title:'Math',library:'H5P.TrueFalse 1.8',params:{question:'<p>\\(1+1=2\\)</p>',correct:'true'}});
 const image=path.join(root,'source.png'),audio=path.join(root,'source.wav'),video=path.join(root,'source.webm');
 await fs.writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64'));
 const wav=Buffer.alloc(3244);wav.write('RIFF');wav.writeUInt32LE(3236,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(3200,40);
 await fs.writeFile(audio,wav);await fs.copyFile(path.join(repo,'tests/fixtures/video.webm'),video);
 examples.push({title:'Image',library:'H5P.TrueFalse 1.8',assets:{image},params:{question:'<p>Image?</p>',correct:'true',media:{type:{library:'H5P.Image 1.1',params:{file:{path:'asset:image',mime:'image/png'},alt:'Image'}}}}});
 examples.push({title:'Audio',library:'H5P.Audio 1.5',assets:{sound:audio},params:{files:[{path:'asset:sound',mime:'audio/wav'}],autoplay:false}});
 examples.push({title:'Video',library:'H5P.TrueFalse 1.8',assets:{clip:video,poster:image},params:{question:'<p>Video?</p>',correct:'true',media:{type:{library:'H5P.Video 1.6',params:{sources:[{path:'asset:clip',mime:'video/webm'}],visuals:{poster:{path:'asset:poster',mime:'image/png'}}}}}}});
 for(const example of examples) {
  const result=await compare({action:'prepare',activity:{language:'en',license:'U',assets:{},...example}});
  assert(result.ok&&result.result.ok,JSON.stringify(result));
  const filename=path.join(root,'activity-'+String(packages.length+1).padStart(2,'0')+'.h5p');
  const exported=await clients[1].request({action:'export',activity:result.result.activity,path:filename});
  assert(exported.ok,JSON.stringify(exported));
  const validated=await compare({action:'validate',path:filename});assert(validated.ok&&validated.result.ok);
  packages.push({file:filename,title:example.title,library:example.library,sha256:createHash('sha256').update(await fs.readFile(filename)).digest('hex'),content:exported.result.content_json});
  console.log('parity and native full export: '+example.library);
 }
 for(const params of [{question:42,correct:'true'},{question:'x',correct:'invalid'},{}]) {
  const result=await compare({action:'prepare',activity:{title:'Invalid',library:'H5P.TrueFalse 1.8',params,language:'en',license:'U',assets:{}}});
  assert(result.ok&&!result.result.ok,JSON.stringify(result));
 }
 const report={status:'passed',comparisons,artifacts:root,packages,oracle:'Node versus Bun; Python baseline frozen at 4d721ae',retain_until:'two stable Bun releases'};
 await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await Promise.all(clients.map(client=>client.close()));}
