import {createRequire} from 'node:module';
import type {Activity,Native} from './types.js';
const sanitize=createRequire(import.meta.url)('sanitize-html');
/** Conservative HTML policy. Changes are proposed to the author, never applied silently. */
export function inspectText(entry:Native,value:string):string {
 const safe=new Set<string>([...sanitize.defaults.allowedTags,'span','div','p','br']);
 const tags=Array.isArray(entry.tags)?['div','span','p','br',...entry.tags]:[...safe];
 const allowedTags=tags.filter((tag:unknown):tag is string=>typeof tag==='string'&&safe.has(tag));
 for(const [tag,related] of [['strong','b'],['em','i'],['ul','li'],['ol','li'],['table','tbody'],['table','tr'],['table','td'],['table','th']])if(allowedTags.includes(tag)&&!allowedTags.includes(related))allowedTags.push(related);
 return sanitize(value,{allowedTags,allowedAttributes:{a:['href','title','rel'],td:['colspan','rowspan'],th:['colspan','rowspan','scope'],ol:['start']},allowedSchemes:['http','https','mailto'],allowProtocolRelative:false});
}
// These pinned players display the field as text even when authoring supplied HTML.
export function playbackText(value:string):string {
 return sanitize(value.replace(/<br\s*(?:\/\s*)?>|<\/p>\s*(?=<p[ >])|<\/li>\s*(?=<li[ >])/gi,'\n'),
   {allowedTags:[],allowedAttributes:{}});
}
export function metadataErrors(activity:Activity):Array<{field:string;message:string}> {
 const result:Array<{field:string;message:string}>=[];
 if(typeof activity.title!=='string'||!/^.{1,255}$/.test(activity.title))result.push({field:'title',message:'Expected a title of 1–255 characters without line breaks'});
 if(typeof activity.language!=='string'||!/^[-a-zA-Z]{1,10}$/.test(activity.language))result.push({field:'language',message:'Language must fit the supported H5P metadata format'});
 else try{new Intl.Locale(activity.language);}catch{result.push({field:'language',message:'Invalid language tag'});}
 const licenses=['CC BY','CC BY-SA','CC BY-ND','CC BY-NC','CC BY-NC-SA','CC BY-NC-ND','CC0 1.0','GNU GPL','PD','ODC PDDL','CC PDM','U','C'];
 if(!licenses.includes(activity.license))result.push({field:'license',message:'Unsupported H5P license identifier'});
 return result;
}
