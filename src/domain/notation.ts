/** Only delimiters are interpreted. The content between them belongs to MathDisplay. */
export type MathWarning = {kind:'dollar'|'answer'; pointer:string};
export const warningLimit = 21; // One extra entry lets the public 20-warning envelope report truncation.
const closing = {inline:'\\)',display:'\\]',double:'$$'};
export type MathMode = keyof typeof closing;
type Format = 'plain'|'markdown'|'html';
type Token = (start:number,end:number,code:boolean)=>void;

export function scanNotation(text:string,format:Format='plain',token?:Token) {
 let detected=false, dollar=false, invalid:MathMode|undefined;
 let open:MathMode|undefined, start=0, single=-1, literalDepth=0;
 if(!/[\\$]/.test(text)&&(format!=='markdown'||!text.includes('`')))return {detected,dollar,invalid};
 function boundary(){
  invalid??=open;
  open=undefined;
  single=-1;
 }
 // Tags are read only in accepted HTML. Code spans use the author's bounded Markdown grammar.
 const htmlTag=/<(\/?)([a-z][\w:-]*)(?:\s[^<>]*)?\/?>/iy;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(format==='html'&&ch==='<'){
   htmlTag.lastIndex=i;
   const tag=htmlTag.exec(text);
   if(tag){
    // The pinned MathJax HTML handler joins br/wbr into the surrounding text.
    if(!/^(br|wbr)$/i.test(tag[2]))boundary();
    if(/^(code|pre)$/i.test(tag[2]))literalDepth=Math.max(0,literalDepth+(tag[1]?-1:1));
    i=htmlTag.lastIndex-1;
    continue;
   }
  }
  if(literalDepth)continue;
  if(format==='markdown'&&ch==='`'&&!open){
   let end=i+1;
   while(end<text.length&&text[end]!=='`'&&text[end]!=='\n')end++;
   if(text[end]==='`'&&end>i+1){
    token?.(i,end+1,true);
    single=-1;
    i=end;
   }
   continue;
  }
  if(format==='markdown'&&ch==='\n'){
   let following=i+1;
   while(text[following]===' '||text[following]==='\t'||text[following]==='\r')following++;
   if(text[following]==='\n')boundary();
  }
  if(ch!=='\\'&&ch!=='$')continue;
  const next=text[i+1];
  if(ch==='\\'&&(next==='\\'||next==='$')){i++;continue;}
  const mark=text.slice(i,i+2);
  if(open&&mark===closing[open]){
   detected=true;
   token?.(start,i+2,false);
   open=undefined;
   i++;
   continue;
  }
  const mode=mark==='\\('?'inline':mark==='\\['?'display':mark==='$$'?'double':undefined;
  if(mode){
   boundary();
   open=mode;
   start=i;
   i++;
   continue;
  }
  if(open){
   if(mark==='\\)'||mark==='\\]'){boundary();i++;}
   continue;
  }
  if(ch==='$'){
   if(single>=0){
    const body=text.slice(single+1,i);
    if(/^[A-Za-z0-9\\]/.test(body)&&!/\s/.test(body)&&/[\^_=]|\\[A-Za-z]/.test(body)){
     dollar=true;
     token?.(single,i+1,false);
     single=-1;
     continue;
    }
   }
   single=i;
  }
 }
 boundary();
 return {detected,dollar,invalid};
}

export function notationWarning({kind,pointer}:MathWarning):string {
 const message=kind==='answer'
  ? 'Blanks matches literal answers. Put the formula in the prompt and use a plain answer or offer expression choices.'
  : 'Use \\(...\\) for inline math instead of single dollars.';
 return 'Math notation: '+message+' '+pointer;
}
