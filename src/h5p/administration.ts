import type {Native} from '../domain/types.js';
import {nativeCatalog} from './native-catalog.js';
import {installPackage} from './packages.js';
import {catalog} from './catalog.js';
export async function administer(request:Native){
 if(request.packages?.length){for(const filename of request.packages)await installPackage(filename,request.data_dir);}else await (await nativeCatalog(request.data_dir)).contentTypeCache.forceUpdate();
 return {libraries:await catalog(await nativeCatalog(request.data_dir)),core:'1.28.0'};
}
