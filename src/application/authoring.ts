import {escapeHtml} from '../domain/authoring-source.js';
import {inspectText,metadataErrors} from '../domain/content-policy.js';
import type {LibraryRepository} from '../h5p/libraries.js';
import type {Native, Activity, Pointer} from '../domain/types.js';
// Generic native-semantics checks. This is not a replacement for browser tests
// or every content type's editor widget/business rules.
import {createMediaResolver,type SaveMedia} from '../infrastructure/media.js';
import {randomUUID} from 'node:crypto';
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
        schemas.set(library, { metadata, fields: semantics });
      }
      const result = schemas.get(library);
      if (top && Number(result.metadata.runnable) !== 1) { fail(at, 'library is not runnable', 'TARGET_INCOMPATIBLE'); return; }
      return result.fields;
    } catch (error: Native) { fail(at, `library ${library} unavailable: ${error.message}`, error.code === 'TARGET_INCOMPATIBLE' ? error.code : 'LIBRARY_NOT_INSTALLED'); }
  }
  async function fields(entries: Native[], value: Native, at: Pointer, depth: number): Promise<Native> {
    if (!object(value)) { fail(at, 'expected object'); return value; }
    const result: Record<string,Native> = {};
    const names = new Set(entries.map(e => e.name));
    for (const key of Object.keys(value)) if (!names.has(key)) fail([...at,key], 'unknown field');
    for (const entry of entries) {
      const item = await field(entry, value[entry.name], [...at,entry.name], depth + 1);
      if (item !== undefined) result[entry.name] = item;
    }
    return result;
  }
  const media = createMediaResolver({saveMedia:context.saveMedia, assets, usedAssets, warnings, fail});
  async function field(entry: Native, value: Native, at: Pointer, depth: number): Promise<Native> {
    if (exhausted) return undefined;
    if (++visitedFields > limit('NODES',100000)) { exhausted = true; fail(at,'Expanded field budget exceeded','INPUT_TOO_LARGE'); return undefined; }
    if (depth > limit('DEPTH',64)) { fail(at, 'maximum nesting depth exceeded'); return value; }
    // H5P flattens a group with one field (e.g. overallFeedback) into
    // that field's value; this must agree with Lumi's ContentScanner.
    if (entry.type === 'group' && entry.fields?.length === 1) {
      if (value === undefined && entry.optional) return undefined;
      return field(entry.fields[0], value, at, depth + 1);
    }
    if (value === undefined) {
      if (entry.default !== undefined) value = structuredClone(entry.default);
      else if (entry.optional) return undefined;
      else if (entry.type === 'group') value = {};
      else { fail(at, 'required field missing'); return undefined; }
    }
    switch (entry.type) {
      case 'group': return fields(entry.fields || [], value, at, depth);
      case 'list':
        if (!Array.isArray(value)) { fail(at, 'expected list'); return value; }
        if (entry.min != null && value.length < entry.min) fail(at, `minimum ${entry.min} items`);
        if (entry.max != null && value.length > entry.max) fail(at, `maximum ${entry.max} items`);
        { const items = []; for (let i = 0; i < value.length; i++) items.push(await field(entry.field, value[i], [...at,i], depth + 1)); return items; }
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
            const proposed=inspectText({tags:[]},metadata.title);
            if(proposed!==metadata.title){
              transformations.push({pointer:pointer([...at,'metadata','title']),path:displayPath([...at,'metadata','title']),before:metadata.title,after:proposed});
              fail([...at,'metadata','title'],'Title violates the supported HTML policy; review the proposed value and resubmit','CONTENT_TRANSFORMATION_REQUIRED');
            }
          }
        }
        return { ...value, metadata, subContentId: id,
          params: entries ? await fields(entries, value.params, [...at,'params'], depth + 1) : value.params };
      }
      case 'text':
        if(typeof value==='string') {
          const proposed=inspectText(entry,value);
          if(proposed!==value) {
            transformations.push({pointer:pointer(at),path:displayPath(at),before:value,after:proposed});
            fail(at,'Text violates the supported HTML policy; review the proposed value and resubmit','CONTENT_TRANSFORMATION_REQUIRED');
          }
          if(entry.widget==='html'&&entry.maxLength!=null&&value.length>entry.maxLength)fail(at,`maximum HTML length ${entry.maxLength}`);
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
  const params = entries ? await fields(entries, activity.params, ['params'], 0) : activity.params;
  const mathematics = errors.length ? {detected:false} : await inspectMath(context.libraries, params);
  if (mathematics.error) fail(['params'], mathematics.error, 'LIBRARY_NOT_INSTALLED');
  if (mathematics.detected) warnings.add('LaTeX requires MathDisplay at playback. Check TeX syntax and rendering in the destination; this is not a symbolic answer checker.');
  for (const id of Object.keys(assets)) if (!usedAssets.has(id)) fail(['assets',id], 'asset is not referenced in a native media field');
  return { ok: errors.length === 0, errors, diagnostics, warnings: [...warnings], mathematics, transformations, activity: { ...activity, params } };
}
