import {auditLumiSemantics} from './compatibility.js';
import {load} from '../infrastructure/runtime.js';
import {FileLibraryRepository} from './libraries.js';
import type {Native} from '../domain/types.js';
import fs from 'node:fs';
import {finished} from 'node:stream/promises';
import {prepareActivity} from '../application/authoring.js';
import {preparationManifest,sameManifest} from '../infrastructure/manifest.js';
import {attachMathDependency} from './math.js';
import {user} from './editor.js';
export async function exportActivity(editor: Native,request: Native,libraries: string,report: Native) {
    // Transitional save-specific check; media storage may legitimately add dimensions/paths.
    if (report.ok) await auditLumiSemantics(editor, report, load);
    if (!report.ok) throw Object.assign(new Error(report.errors.join('\n')), {code:'INVALID_PARAMETER', details:report.diagnostics});
    const uploaded = await prepareActivity({libraries:new FileLibraryRepository(libraries),coreApiVersion:editor.config.coreApiVersion,saveMedia:(entry,file)=>editor.saveContentFile(undefined,entry,file,user)}, report.activity);
    if (!uploaded.ok) throw Object.assign(new Error(uploaded.errors.join('\n')), {code:'INVALID_PARAMETER', details:uploaded.diagnostics});
    const activity = uploaded.activity;
    const mainLibrary = activity.library;
    const params = activity.params;
    const [machineName, version] = mainLibrary.split(' ');
    const [majorVersion, minorVersion] = version.split('.').map(Number);
    const libraryMetadata = await editor.libraryManager.getLibrary({machineName, majorVersion, minorVersion});
    const metadata = { title: activity.title, language: activity.language, license: activity.license,
      embedTypes: libraryMetadata.embedTypes || ['div'], mainLibrary: machineName };
    const id = await editor.saveOrUpdateContent(undefined, params, metadata, mainLibrary, user);
    await attachMathDependency(editor, id, user);
    const output = fs.createWriteStream(request.path, { flags: 'wx' });
    const done = finished(output);
    // Attach immediately to avoid unhandled rejection if export fails first.
    done.catch(() => {});
    try {
      await editor.exportContent(id, output, user);
      await done;
    } catch (error) {
      output.destroy();
      await done.catch(() => {});
      throw error;
    }
    const finalManifest = await preparationManifest(editor, libraries, report.activity, report.mathematics);
    if (!sameManifest(report.activity.preparation, finalManifest)) throw Object.assign(new Error('Dependencies changed during export'), {code:'STALE_PREPARATION'});
    const exported = await editor.getContent(id, user);
    return { h5p_json: exported.h5p, content_json: exported.params.params, preparation_manifest:report.activity.preparation };
}
