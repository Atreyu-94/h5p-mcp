import {FileLibraryRepository} from './libraries.js';
import type {Native} from '../domain/types.js';
import {prepareActivity} from '../application/authoring.js';

import {preparationManifest,sameManifest} from '../infrastructure/manifest.js';

export async function prepare(editor: Native,request: Native,libraries: string) {
    const report = await prepareActivity({libraries:new FileLibraryRepository(libraries),coreApiVersion:editor.config.coreApiVersion}, request.activity);

    if (report.ok) {
      const manifest = await preparationManifest(editor, libraries, report.activity, report.mathematics);
      if (request.action === 'export' && request.activity.preparation && !sameManifest(request.activity.preparation, manifest))
        throw Object.assign(new Error('Preparation dependencies changed; prepare again'), {code:'STALE_PREPARATION'});
      report.activity.preparation = manifest;
    }
 return report;
}
