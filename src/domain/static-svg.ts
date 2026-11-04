import {SaxesParser} from 'saxes';

export const svgMime='image/svg+xml';
export const svgBytes=4*1024*1024;
const svgNS='http://www.w3.org/2000/svg',xlink='http://www.w3.org/1999/xlink';
const numeric=/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
const id=/^[A-Za-z_][A-Za-z0-9_-]{0,95}$/;
const reject=(reason:string):never=>{throw Object.assign(new Error('Unsupported static SVG: '+reason),{code:'MIME_MISMATCH'});};
const attributes:Record<string,string[]>={
 svg:['viewBox','width','height'],defs:[],symbol:['id','overflow'],clipPath:['id'],
 g:['transform','clip-path'],use:['href','x','y','fill','fill-rule','transform'],
 path:['d','transform','fill','fill-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','clip-rule'],
};
function numbers(value:string,remaining:RegExp) {
 const values:number[]=[];
 const rest=value.replace(numeric,token=>{
  const n=Number(token);
  if(token.length>32||!Number.isFinite(n)||Math.abs(n)>1e6)reject('coordinate');
  values.push(n);return '';
 });
 if(!values.length||!remaining.test(rest))reject('number list');
 return values;
}
function dimension(value:string) {
 const match=/^(\d+(?:\.\d+)?)(pt|px)?$/.exec(value);
 if(!match) return reject('dimension');
 const n=Number(match[1]);if(!(n>0&&n<=16384))reject('dimension');
 return {n,unit:match[2]||'px'};
}

/** Accept the static Typst path/glyph subset. Never rewrite unsafe XML into an accepted document. */
export function validateStaticSvg(bytes:Buffer){
 if(!bytes.length||bytes.length>svgBytes)reject('byte budget');
 let xml:string;
 try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return reject('encoding');}
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))reject('declaration');
 const parser=new SaxesParser({xmlns:true}),stack:string[]=[];
 const definitions=new Map<string,{kind:string;cost:number}>(),refs:Array<{id:string;kind:string}>=[];
 let geometry:{width:number;height:number;wUnits:string;hUnits:string}|undefined;
 let definition:string|undefined,root=false,nodes=0,pathSize=0;
 const numberList=(s:string)=>numbers(s,/^[ ,]*$/);
 parser.on('error',()=>reject('malformed XML'));
 parser.on('doctype',()=>reject('doctype'));
 parser.on('processinginstruction',()=>reject('processing instruction'));
 parser.on('cdata',()=>reject('CDATA'));
 parser.on('xmldecl',decl=>{if(decl.encoding&&!/^utf-8$/i.test(decl.encoding))reject('encoding declaration');});
 parser.on('text',s=>{if(s.trim())reject('text content');});
 parser.on('opentag',tag=>{
  const name=tag.local,parent=stack.at(-1);
  if(tag.uri!==svgNS||tag.prefix||!Object.hasOwn(attributes,name))reject('element');
  if(++nodes>16000||stack.length>=48)reject('element budget');
  if(!parent){
   if(root||name!=='svg')reject('root');root=true;
  }else if(name==='svg'||(name==='defs'&&parent!=='svg')||
   (['symbol','clipPath'].includes(name)&&parent!=='defs')||
   (parent==='defs'&&!['symbol','clipPath'].includes(name))||['path','use'].includes(parent))reject('nesting');
  const vals:Record<string,string>=Object.create(null);
  for(const a of Object.values(tag.attributes)){
   if(a.uri==='http://www.w3.org/2000/xmlns/'){
    if(parent||!((a.name==='xmlns'&&a.value===svgNS)||(a.name==='xmlns:xlink'&&a.value===xlink)||
       (a.name==='xmlns:h5'&&a.value==='http://www.w3.org/1999/xhtml')))reject('namespace');
    continue;
   }
   if((a.uri&&!(a.uri===xlink&&a.local==='href'))||!attributes[name].includes(a.local)||Object.hasOwn(vals,a.local))reject('attribute');
   vals[a.local]=a.value;
  }
  if(name==='svg'){
   const w=dimension(vals.width||''),h=dimension(vals.height||'');
   geometry={width:w.n,height:h.n,wUnits:w.unit,hUnits:h.unit};
   const pixels=(d:typeof w)=>Math.ceil(d.n*(d.unit==='pt'?96/72:1));
   if(pixels(w)*pixels(h)>16000000)reject('pixel budget');
   const box=numberList(vals.viewBox||'');if(box.length!==4||box[2]<=0||box[3]<=0)reject('viewBox');
  }
  if(name==='symbol'||name==='clipPath'){
   if(!id.test(vals.id||'')||definitions.has(vals.id))reject('definition id');
   definition=vals.id;definitions.set(definition,{kind:name,cost:1});
  }
  if(name==='use'&&!vals.href)reject('missing reference');
  if(name==='path'&&!vals.d)reject('missing path');
  for(const [key,value] of Object.entries(vals)){
   if(['id','width','height','viewBox'].includes(key))continue;
   if(key==='href'||key==='clip-path'){
    const ref=(key==='href'?/^#([A-Za-z_][\w-]{0,95})$/:/^url\(#([A-Za-z_][\w-]{0,95})\)$/).exec(value);
    if(!ref||definition||refs.length>=8192)return reject('external, nested or excessive reference');
    refs.push({id:ref[1],kind:key==='href'?'symbol':'clipPath'});continue;
   }
   if(key==='d'){
    if(value.length>262144||(pathSize+=value.length)>2*1024*1024)reject('path budget');
    numbers(value,/^[MmZzLlHhVvCcSsQqTtAa ,\s]*$/);
   }else if(key==='transform'){
    if(value.length>256||!/^((translate|scale|rotate|matrix)\([^()]+\)\s*)+$/.test(value))reject('transform');
    for(const match of value.matchAll(/(\w+)\(([^()]*)\)/g)){
     const n=numberList(match[2]).length;
     if(!(match[1]==='matrix'?n===6:match[1]==='rotate'?n===1||n===3:n===1||n===2))reject('transform arguments');
    }
   }else if(key==='fill'||key==='stroke'){
    if(!/^(?:none|#[\da-fA-F]{6}(?:[\da-fA-F]{2})?)$/.test(value))reject('paint');
   }else if(key==='overflow'){if(value!=='visible'&&value!=='hidden')reject('overflow');}
   else if(key==='fill-rule'||key==='clip-rule'){if(!['evenodd','nonzero'].includes(value))reject('fill rule');}
   else if(key==='stroke-linecap'){if(!['butt','round','square'].includes(value))reject('line cap');}
   else if(key==='stroke-linejoin'){if(!['miter','round','bevel'].includes(value))reject('line join');}
   else if(key==='stroke-dasharray'&&value==='')continue;
   else if(numberList(value).length>(key==='stroke-dasharray'?32:1))reject('numeric attribute');
  }
  if(definition)definitions.get(definition)!.cost+=1+(vals.d?.length||0);
  stack.push(name);
 });
 parser.on('closetag',tag=>{stack.pop();if(tag.local==='symbol'||tag.local==='clipPath')definition=undefined;});
 parser.write(xml).close();
 if(!geometry)return reject('missing svg');
 let expanded=pathSize;
 for(const ref of refs){
  const target=definitions.get(ref.id);
  if(!target||target.kind!==ref.kind)return reject('unresolved reference');
  if((expanded+=target.cost)>8*1024*1024)reject('expanded paths');
 }
 return geometry;
}
