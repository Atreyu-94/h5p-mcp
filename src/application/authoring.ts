import {escapeHtml} from '../domain/authoring-source.js';
import {inspectText,metadataErrors,playbackText} from '../domain/content-policy.js';
import type {LibraryRepository} from '../h5p/libraries.js';
import type {Native, Activity, Pointer} from '../domain/types.js';
// Generic native-semantics checks. This is not a replacement for browser tests
// or every content type's editor widget/business rules.
import {createMediaResolver,type SaveMedia} from '../infrastructure/media.js';
import {randomUUID} from 'node:crypto';
import {scanNotation,warningLimit,type MathWarning} from '../domain/notation.js';
import {inspectMath} from '../h5p/math.js';
import {checkTree, limit} from '../domain/limits.js';
import {scalarErrors} from '../domain/semantics.js';
import {diagnostic, displayPath, pointer} from '../domain/diagnostics.js';
const object = (value: Native) => value !== null && typeof value === 'object' && !Array.isArray(value);

export interface PreparationContext {
 libraries: LibraryRepository;
 coreApiVersion:{major:number;minor:number};
 saveMedia?: SaveMedia;
}
export async function prepareActivity(context: PreparationContext, activity: Activity): Promise<Native> {
  const errors: string[] = [];
  const diagnostics: Native[] = [];
  const transformations:Native[]=[];
  const identities = new Set();
  try { checkTree(activity.params); } catch (error: Native) {
    return {ok:false, errors:[error.message], diagnostics:[diagnostic(['params'],error.message,error.code)], warnings:[], mathematics:{detected:false}, activity:{...activity, params:{}}};
  }
  const warnings = new Set(['Native field checks do not verify editor-widget rules, HTML safety, playback, accessibility or Moodle grading.']);
  const mathWarnings:MathWarning[]=[];
  let hasMath=false;
  function inspectNotation(value:string,at:Pointer,blanks=false){
    const result=scanNotation(value,'html');
    hasMath ||= result.detected;
    if(result.invalid&&diagnostics.length<=100){
      fail(at,'Invalid mathematical delimiter','MATH_DELIMITER_INVALID');
      diagnostics[diagnostics.length-1].reason='math_'+result.invalid;
    }
    if(result.dollar&&mathWarnings.length<warningLimit)mathWarnings.push({kind:'dollar',pointer:pointer(at)});
    if(blanks&&result.detected&&mathWarnings.length<warningLimit){
      // Blanks 1.14 splits *solution:tip* before splitting solutions on '/'.
      for(const match of value.matchAll(/\*([^*\r\n]*)\*/g)){
        const solutions=match[1].split(':',1)[0].split('/');
        if(solutions.some(answer=>scanNotation(answer,'html').detected)){
          mathWarnings.push({kind:'answer',pointer:pointer(at)});
          break;
        }
      }
    }
  }
  const schemas = new Map();
  let visitedFields = 0;
  let exhausted = false;
  const usedAssets = new Set<string>();
  const assets = activity.assets || {};
  const fail = (at: Pointer, message: string, code = 'INVALID_PARAMETER') => { errors.push(`${displayPath(at)}: ${message}`); diagnostics.push(diagnostic(at,message,code)); };
  for(const error of metadataErrors(activity))fail([error.field],error.message,'INVALID_METADATA');
  async function schema(library: string, at: Pointer, top = false): Promise<Native> {
    const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*) ([0-9]+)\.([0-9]+)$/.exec(library || '');
    if (!match) { fail(at, 'expected exact library "Name major.minor"'); return; }
    if (library === 'H5P.TwitterUserFeed 1.0') {
      fail(at,'Twitter User Feed 1.0 depends on a discontinued API. Choose another content type.','TARGET_INCOMPATIBLE');
      return;
    }
    const version = { machineName: match[1], majorVersion: Number(match[2]), minorVersion: Number(match[3]) };
    try {
      if (!schemas.has(library)) {
        if (schemas.size >= limit('LIBRARIES',1000)) throw new Error('Library node budget exceeded');
        const metadata = await context.libraries.getLibrary(version);
        const core = metadata.coreApi;
        if (core && (core.majorVersion > context.coreApiVersion.major ||
          (core.majorVersion === context.coreApiVersion.major && core.minorVersion > context.coreApiVersion.minor))) {
          throw Object.assign(new Error('requires a newer H5P Core'), {code:'TARGET_INCOMPATIBLE'});
        }
        const semantics = await context.libraries.getSemantics(version);
        checkTree(semantics);
        for(const warning of await context.libraries.getRuntimeWarnings?.(version)??[])warnings.add(warning);
        schemas.set(library, { metadata, fields: semantics });
      }
      const result = schemas.get(library);
      if (top && Number(result.metadata.runnable) !== 1) { fail(at, 'library is not runnable', 'TARGET_INCOMPATIBLE'); return; }
      return result.fields;
    } catch (error: Native) { fail(at, `library ${library} unavailable: ${error.message}`, error.code === 'TARGET_INCOMPATIBLE' ? error.code : 'LIBRARY_NOT_INSTALLED'); }
  }
  async function fields(entries: Native[], value: Native, at: Pointer, depth: number, library:string): Promise<Native> {
    if (!object(value)) { fail(at, 'expected object'); return value; }
    const result: Record<string,Native> = {};
    const names = new Set(entries.map(e => e.name));
    for (const key of Object.keys(value)) if (!names.has(key)) fail([...at,key], 'unknown field');
    for (const entry of entries) {
      const item = await field(entry, value[entry.name], [...at,entry.name], depth + 1, library);
      if (item !== undefined) result[entry.name] = item;
    }
    if (library === 'H5P.AdvancedBlanks 1.2' && at.at(-1) === 'content' &&
        typeof result.blanksText === 'string' && Array.isArray(result.blanksList)) {
      const markers = result.blanksText.match(/_{3,}/g) || [];
      if (!markers.length || markers.length !== result.blanksList.length)
        fail([...at,'blanksText'],'Use one run of three or more underscores per blanksList answer, in order.');
    }
    return result;
  }
  const media = createMediaResolver({saveMedia:context.saveMedia, assets, usedAssets, warnings, fail});
  async function field(entry: Native, value: Native, at: Pointer, depth: number, library:string): Promise<Native> {
    if (exhausted) return undefined;
    if (++visitedFields > limit('NODES',100000)) { exhausted = true; fail(at,'Expanded field budget exceeded','INPUT_TOO_LARGE'); return undefined; }
    if (depth > limit('DEPTH',64)) { fail(at, 'maximum nesting depth exceeded'); return value; }
    // H5P flattens a group with one field (e.g. overallFeedback) into
    // that field's value; this must agree with Lumi's ContentScanner.
    if (entry.type === 'group' && entry.fields?.length === 1) {
      if (value === undefined && entry.optional) return undefined;
      return field(entry.fields[0], value, at, depth + 1, library);
    }
    if (value === undefined) {
      if (entry.default !== undefined) value = structuredClone(entry.default);
      else if (library === 'H5P.AdvancedBlanks 1.2' && entry.type === 'list' && at.at(-1) === 'overallFeedback')
        value = [{from:0,to:100,feedback:''}];
      else if (library === 'H5P.Timeline 1.1' && entry.name === 'asset' && at.at(-3) === 'date' && entry.type === 'group') value = {};
      else if (entry.optional) return undefined;
      else if (entry.type === 'group') value = {};
      else { fail(at, 'required field missing'); return undefined; }
    }
    switch (entry.type) {
      case 'group': return fields(entry.fields || [], value, at, depth, library);
      case 'list':
        if (!Array.isArray(value)) { fail(at, 'expected list'); return value; }
        if (entry.min != null && value.length < entry.min) fail(at, `minimum ${entry.min} items`);
        if (entry.max != null && value.length > entry.max) fail(at, `maximum ${entry.max} items`);
        { const items = []; for (let i = 0; i < value.length; i++) items.push(await field(entry.field, value[i], [...at,i], depth + 1, library)); return items; }
      case 'library': {
        if (!object(value)) { fail(at, 'expected library object'); return value; }
        if (!entry.options?.includes(value.library)) { fail(at, 'library is not an allowed exact version', 'LIBRARY_VERSION_MISMATCH'); return value; }
        const entries = await schema(value.library, at);
        const id = value.subContentId === undefined ? randomUUID() : value.subContentId;
        if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail([...at,'subContentId'], 'expected UUID', 'INVALID_SUBCONTENT_ID');
        else if (identities.has(id.toLowerCase())) fail([...at,'subContentId'], 'duplicate UUID', 'DUPLICATE_SUBCONTENT_ID');
        else identities.add(id.toLowerCase());
        let metadata = value.metadata;
        if (metadata !== undefined && !object(metadata)) {
          fail([...at,'metadata'], 'expected metadata object', 'INVALID_METADATA');
        } else {
          metadata = {...metadata};
          // Native subcontent needs a title for composite result screens.
          if (metadata.title === undefined) metadata.title = escapeHtml(schemas.get(value.library)?.metadata.title || value.library);
          if (typeof metadata.title !== 'string' || !/^.{0,255}$/.test(metadata.title))
            fail([...at,'metadata','title'], 'expected title up to 255 characters without line breaks', 'INVALID_METADATA');
          else {
            inspectNotation(metadata.title,[...at,'metadata','title']);
            const proposed=inspectText({tags:[]},metadata.title);
            if(proposed!==metadata.title){
              transformations.push({pointer:pointer([...at,'metadata','title']),path:displayPath([...at,'metadata','title']),before:metadata.title,after:proposed});
              fail([...at,'metadata','title'],'Title violates the supported HTML policy; review the proposed value and resubmit','CONTENT_TRANSFORMATION_REQUIRED');
            }
          }
        }
        return { ...value, metadata, subContentId: id,
          params: entries ? await fields(entries, value.params, [...at,'params'], depth + 1, value.library) : value.params };
      }
      case 'text':
        if(typeof value==='string') {
          if(entry.maxLength!=null && value.length>entry.maxLength){
            fail(at,`maximum ${entry.widget==='html'?'HTML ':''}length ${entry.maxLength}`);
            break;
          }
          inspectNotation(value,at,library==='H5P.Blanks 1.14'&&at.at(-2)==='questions'&&at.at(-3)==='params');
          if(library==='H5P.DragText 1.10' && entry.name==='distractors' &&
              value.split(/(\*[^*\r\n]*\*)/).some((part,index)=>index%2 ? !part.slice(1,-1).trim() : !!part.trim()))
            fail(at,'Wrap each distractor in asterisks, for example *first term* *second term*.');
          const displaysText = (library === 'H5P.TrueFalse 1.8' && ['feedbackOnCorrect','feedbackOnWrong'].includes(entry.name)) ||
            (library === 'H5P.DragText 1.10' && entry.name === 'textField') ||
            (library === 'H5P.OpenEndedQuestion 1.0' && entry.name === 'question') ||
            (library === 'H5P.DocumentationTool 1.8' && entry.name === 'taskDescription');
          const proposed=displaysText ? playbackText(value) : inspectText(entry,value);
          if(proposed!==value) {
            transformations.push({pointer:pointer(at),path:displayPath(at),before:value,after:proposed});
            fail(at,'Text violates the supported HTML policy; review the proposed value and resubmit','CONTENT_TRANSFORMATION_REQUIRED');
          }
        }
        for (const message of scalarErrors(entry, value)) fail(at, message);
        break;
      case 'number':
        for (const message of scalarErrors(entry, value)) fail(at, message);
        break;
      case 'boolean': if (typeof value !== 'boolean') fail(at, 'expected boolean'); break;
      case 'select': {
        const options = (entry.options || []).map((o: Native) => o.value);
        const values = entry.multiple ? value : [value];
        if (!Array.isArray(values) || values.some(v => !options.includes(v))) fail(at, 'invalid select option');
        break;
      }
      case 'image': case 'file': return media(entry, value, at);
      case 'audio': case 'video':
        if (!Array.isArray(value)) { fail(at, 'expected media list'); return value; }
        { const items = []; for (let i = 0; i < value.length; i++) items.push(await media(entry, value[i], [...at,i])); return items; }
      default: fail(at, `unsupported semantic field type ${entry.type}`, 'UNSUPPORTED_SEMANTIC_TYPE');
    }
    return value;
  }
  const entries = await schema(activity.library, ['library'], true);
  const params = entries ? await fields(entries, activity.params, ['params'], 0, activity.library) : activity.params;
  // Apply the existing budget to defaults and other expanded values as well as the raw input.
  if(!errors.length)checkTree(params);
  const mathematics = errors.length ? {detected:false} : await inspectMath(context.libraries, hasMath);
  if (mathematics.error) {
    fail(['params'], mathematics.error, 'LIBRARY_NOT_INSTALLED');
    diagnostics[diagnostics.length-1].reason='math_library';
  }
  if (mathematics.detected) warnings.add('LaTeX requires MathDisplay at playback. Check TeX syntax and rendering in the destination; this is not a symbolic answer checker.');
  for (const id of Object.keys(assets)) if (!usedAssets.has(id)) fail(['assets',id], 'asset is not referenced in a native media field');
  return { ok: errors.length === 0, errors, diagnostics, warnings: [...warnings], mathWarnings, mathematics, transformations, activity: { ...activity, params } };
}
