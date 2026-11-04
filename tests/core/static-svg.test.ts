import {test,expect} from 'bun:test';
import {validateStaticSvg} from '../../src/domain/static-svg.js';

const root='xmlns="http://www.w3.org/2000/svg" width="120pt" height="60pt" viewBox="0 0 120 60"';
const wrap=(inner:string)=>Buffer.from('<svg '+root+'>'+inner+'</svg>');
test('static policy accepts bounded internal glyph and clip references',()=>{
 const xml=wrap('<g clip-path="url(#clip)"><use href="#glyph"/></g><defs><symbol id="glyph"><path d="M1 2L3 4Z"/></symbol><clipPath id="clip"><path d="M0 0H5V5Z"/></clipPath></defs>');
 expect(()=>validateStaticSvg(xml)).not.toThrow();
});
test('static policy rejects active, ambiguous, external and expensive SVG',()=>{
 for(const inner of [
  '<script/>','<foreignObject/>','<image href="data:image/png;base64,AA=="/>','<style/>',
  '<path d="M0 0" onclick="alert(1)"/>','<path d="M0 0" style="fill:url(https://example.org)"/>',
  '<path d="M0 0" fill="url(https://example.org)"/>','<g xmlns="urn:other"/>',
  '<use href="https://example.org/a.svg#foo"/>','<use href="#missing"/>',
  '<defs><symbol id="x"><use href="#x"/></symbol></defs>',
  '<defs><symbol id="x"/><clipPath id="x"/></defs>','<path d="M0 0" d="M1 1"/>',
  '<path d="M1e999 2"/>','<g>'.repeat(50)+'</g>'.repeat(50),
  '<g/>'.repeat(16000),'<path d="M0 0'+'L1 1'.repeat(70000)+'"/>',
  '<defs><symbol id="g"><path d="M0 0'+'L1 1'.repeat(3000)+'"/></symbol></defs>'+'<use href="#g"/>'.repeat(1000)
 ])expect(()=>validateStaticSvg(wrap(inner))).toThrow();
 for(const xml of [
  '<?xml-stylesheet href="https://example.org/s.css"?>'+wrap(''),
  '<!DOCTYPE svg [<!ENTITY a "xx">]>'+wrap(''),
  String(wrap('')).replace('120pt','Infinity'),String(wrap('')).replace('0 0 120 60','0 0 -1 60'),
  String(wrap('')).replace('120pt','16000pt').replace('60pt','16000pt')
 ])expect(()=>validateStaticSvg(Buffer.from(xml))).toThrow();
});

test('reject an unsafe master before requesting any raster',async()=>{
 const {renderSinglePage}=await import('../../src/infrastructure/typst-page.js');
 const formats:string[]=[];
 await expect(renderSinglePage(async format=>{formats.push(format);return wrap('<script/>');})).rejects.toMatchObject({code:'MIME_MISMATCH'});
 expect(formats).toEqual(['svg']);
});

test('the raster budget uses the XML root dimensions even with a decoy svg in a comment',async()=>{
 const {renderSinglePage}=await import('../../src/infrastructure/typst-page.js');
 const bytes=Buffer.from('<!-- <svg width="1pt" height="1pt"> -->'+wrap('<path d="M0 0L1 1"/>')
  .toString().replace('120pt','2000pt').replace('60pt','2000pt'));
 const calls:string[]=[];
 await expect(renderSinglePage(async format=>{calls.push(format);return bytes;})).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
 expect(calls).toEqual(['svg']);
});

test('unreferenced content SVG is checked even when the package declares no image',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {createWriteStream}=await import('node:fs'),{pipeline}=await import('node:stream/promises');
 const {load}=await import('../../src/infrastructure/runtime.js'),{preflight}=await import('../../src/infrastructure/archive.js');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'svg-package-')),file=path.join(temp,'unsafe.h5p');
 try{
  const zip=new (load('yazl').ZipFile)(),write=pipeline(zip.outputStream,createWriteStream(file));
  zip.addBuffer(Buffer.from(JSON.stringify({mainLibrary:'H5P.Image',preloadedDependencies:[{}]})),'h5p.json');
  zip.addBuffer(Buffer.from('{}'),'content/content.json');
  zip.addBuffer(wrap('<foreignObject/>'),'content/unused.SVG');
  zip.end();await write;
  await expect(preflight(file,true,true)).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
  await expect(preflight(file,true,false)).rejects.toMatchObject({code:'TARGET_INCOMPATIBLE'});
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
