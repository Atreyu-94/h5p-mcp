import type {Native} from '../domain/types.js';
import {createHash} from 'node:crypto';
import {nativeCatalog,readStore} from './native-catalog.js';
import {checkTree,limit} from '../domain/limits.js';
export async function catalog(editor: Native) {
  const installed = await editor.libraryManager.listInstalledLibraries();
  const result: Record<string,string> = {};
  for (const name of Object.keys(installed)) {
    const versions = installed[name] || [];
    versions.sort((a: Native, b: Native) => b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion);
    if (!versions.length) continue;
    const v = versions[0];
    result[name] = `${name} ${v.majorVersion}.${v.minorVersion}`;
  }
  return result;
}

export async function query(request: Native) {
 const root=request.data_dir,editor=await nativeCatalog(root);
    const manager = editor.libraryManager;
    let installed = await manager.listInstalledLibraries();
    const sortVersions = (versions: Native[]) => [...versions].sort((a: Native, b: Native) =>
      b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion);
    const compatible = (major: Native, minor: Native) => major == null || minor == null ? null :
      Number(major) < editor.config.coreApiVersion.major ||
      (Number(major) === editor.config.coreApiVersion.major && Number(minor) <= editor.config.coreApiVersion.minor);
    if (request.action === 'discover') {
      if (request.refresh && !await editor.contentTypeCache.forceUpdate()) throw Object.assign(new Error('H5P Hub refresh failed; retry with refresh=false to use cached data'), {code:'HUB_UNAVAILABLE'});
      // ContentTypeCache.get() downloads on a cache miss. Discovery without an
      // explicit refresh must read storage directly, including an absent cache.
      const hub = (await readStore(root,'cache.json')).contentTypeCache || [];
      const entries = new Map<string,Native>(hub.map((item: Native) => [item.machineName, {
        machine_name: item.machineName, title: item.title, summary: item.summary,
        hub_version: `${item.majorVersion}.${item.minorVersion}.${item.patchVersion}`,
        required_core: { major: item.h5pMajorVersion, minor: item.h5pMinorVersion },
        core_compatible: compatible(item.h5pMajorVersion, item.h5pMinorVersion),
        installed_versions: [], authoring_supported: compatible(item.h5pMajorVersion, item.h5pMinorVersion) !== false,
      }]));
      for (const [name, versions] of Object.entries(installed as Record<string,Native[]>)) {
        const runnable = versions.filter(v => Number(v.runnable) === 1);
        if (!entries.has(name) && !runnable.length) continue;
        if (!entries.has(name)) entries.set(name, { machine_name: name, title: runnable[0].title,
          hub_version: null, core_compatible: null, authoring_supported: true });
        entries.get(name)!.installed_versions = sortVersions(versions).map(v => `${v.majorVersion}.${v.minorVersion}.${v.patchVersion}`);
      }
      const query = (request.query || '').toLowerCase();
      const all = [...entries.values()].filter(item =>
        (!request.installed_only || item.installed_versions.length) &&
        `${item.machine_name} ${item.title} ${item.summary || ''}`.toLowerCase().includes(query)
      ).sort((a: Native, b: Native) => a.machine_name.localeCompare(b.machine_name));
      const page = all.slice(request.offset, request.offset + request.limit);
      let inspected = 0;
      for (const item of page) {
        item.evidence = [];
        for (const version of sortVersions(installed[item.machine_name] || [])) {
          if (++inspected > limit('LIBRARIES',1000)) throw Object.assign(new Error('Evidence budget exceeded'), {code:'INPUT_TOO_LARGE'});
          const metadata = await manager.getLibrary(version);
          const semantics = await manager.getSemantics(version);
          checkTree(semantics);
          const pending = [...semantics], unsupported = new Set();
          const types = new Set(['group','list','library','text','number','boolean','select','image','file','audio','video']);
          while (pending.length) {
            const field = pending.pop();
            if (!types.has(field.type)) unsupported.add(field.type);
            if (field.type === 'group') pending.push(...(field.fields || []));
            if (field.type === 'list' && field.field) pending.push(field.field);
          }
          const runnable = Number(metadata.runnable) === 1;
          const coreCompatible = compatible(metadata.coreApi?.majorVersion,metadata.coreApi?.minorVersion) !== false;
          item.evidence.push({library:`${item.machine_name} ${version.majorVersion}.${version.minorVersion}`,
            patch_version:metadata.patchVersion, checked_at:new Date().toISOString(),
            schema_sha256:createHash('sha256').update(JSON.stringify({metadata,semantics})).digest('hex'),
            digest_format:'UTF-8 JSON.stringify({metadata,semantics})',
            structurally_authorable:runnable && coreCompatible && !unsupported.size,
            checks:{runnable:runnable?'passed':'failed',core:coreCompatible?'passed':'failed',
              native_types:unsupported.size?'failed':'passed',preparation:'not_run',importation:'not_run',playback:'not_run',grading:'not_run'},
            unsupported_types:[...unsupported], source:'installed library metadata and semantics; nested dependencies and concrete params not verified'});
        }
        item.structurally_authorable = item.evidence.some((e: Native) => e.structurally_authorable);
        item.authoring_supported = item.structurally_authorable;
      }
      return { core: editor.config.h5pVersion, last_updated: await editor.contentTypeCache.getLastUpdate() || null,
        total: all.length, offset: request.offset, activities: page,
        note: 'Hub compatibility is not Moodle verification. Generic authoring uses native schemas; support does not guarantee every editor widget or playback behavior.' };
    }
    const name = request.machine_name;
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new Error('Invalid library machine name');
    const select = () => sortVersions(installed[name] || []).find((v: Native) =>
      request.major_version == null || (Number(v.majorVersion) === request.major_version && Number(v.minorVersion) === request.minor_version));
    let version = select();
    if (!version && request.install_if_missing) {
      if (!await editor.contentTypeCache.forceUpdate()) throw Object.assign(new Error('H5P Hub refresh failed'), {code:'HUB_UNAVAILABLE'});
      const [entry] = await editor.contentTypeCache.get(name);
      if (!entry) throw new Error('Activity is not available in the H5P Hub');
      if (request.major_version != null && (Number(entry.majorVersion) !== request.major_version || Number(entry.minorVersion) !== request.minor_version)) {
        throw Object.assign(new Error('Requested version is not installed and is not the current Hub version'), {code:'LIBRARY_VERSION_MISMATCH'});
      }
      await editor.installLibraryFromHub(name);
      installed = await manager.listInstalledLibraries();
      version = select();
    }
    if (!version) throw Object.assign(new Error('Library version is not installed. Use an authorized installation tool or CLI setup.'), {code:'LIBRARY_NOT_INSTALLED'});
    const metadata = await manager.getLibrary(version);
    return { core: editor.config.h5pVersion, library: `${name} ${version.majorVersion}.${version.minorVersion}`,
      patch_version: metadata.patchVersion, metadata, semantics: await manager.getSemantics(version),
      authoring_supported: Number(metadata.runnable) === 1 && compatible(metadata.coreApi?.majorVersion, metadata.coreApi?.minorVersion) !== false,
      note: 'Native H5P semantics, not JSON Schema. Nested library options refer to separate schemas; query those exact versions. Use the exact library and native params with create_h5p_activity.' };

}
