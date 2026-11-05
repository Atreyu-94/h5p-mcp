import type {Native} from '../domain/types.js';

/** Called only for a successfully prepared, version-pinned authoring source. */
export function sourceScoring(source:Native) {
 if(source.type==='accordion')return {status:'unscored',maximum:0,items:[]};
 const series=source.type==='question_set';
 const items=(series?source.questions:[source]).map((item:Native)=>{
  let maximum=1;
  let rule='correct_answer';
  if(item.type==='blanks'){
   maximum=item.blocks.reduce((sum:number,block:Native)=>sum+block.segments.filter((segment:Native)=>segment.answers).length,0);
   rule='one_per_correct_gap';
  }else if(item.type==='multi_choice'){
   rule=item.scoring;
   if(rule==='partial_minus_incorrect')maximum=item.correct_ids.length;
  }
  return {id:item.id,maximum,rule,omitted_score:0,retry:item.retry??true,show_solution:item.show_solution??true};
 });
 const maximum=items.reduce((sum:number,item:Native)=>sum+item.maximum,0);
 return {status:'scored',maximum,items:items.map((item:Native)=>({...item,share:item.maximum/maximum})),
  ...(series?{pass_percentage:source.pass_percentage,retry:source.retry??true,show_solution:source.show_solution??true}:{})};
}
