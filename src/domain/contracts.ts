import type {Native} from './types.js';
import {checkTree} from './limits.js';
const constraints=['min','max','maxLength','regexp','decimals','multiple','options'];
const known=new Set(['name','type','optional','default','fields','field','label','description','importance','common','expanded',...constraints]);
/** Native projection only. MCP resource storage belongs to the F4 adapter. */
export function projectSemantics(semantics:Native[]) {
 checkTree(semantics);
 const libraries=new Set<string>();
 function project(entry:Native):Native {
  const field:Native={name:entry.name??null,type:entry.type,required:!entry.optional};
  for(const key of ['label','description']) if(typeof entry[key]==='string') {field[key]=entry[key].slice(0,1024);if(entry[key].length>1024)field[key+'_truncated']=true;}
  if('default' in entry) field.default=structuredClone(entry.default);
  const rules=Object.fromEntries(constraints.filter(key=>key in entry).map(key=>[key,structuredClone(entry[key])]));
  if(Object.keys(rules).length) field.constraints=rules;
  const extensions=Object.fromEntries(Object.entries(entry).filter(([key])=>!known.has(key)));
  if(Object.keys(extensions).length) field['x-h5p']=structuredClone(extensions);
  if(entry.type==='group') {
   const children=entry.fields||[];
   field.value_shape=children.length===1?'single_field':'object';
   field.fields=children.map(project);
  } else if(entry.type==='list') field.field=project(entry.field);
  else if(entry.type==='library') for(const name of entry.options||[]) libraries.add(name);
  return field;
 }
 const fields=semantics.map(project);
 return {fields,sublibraries:[...libraries].sort()};
}
