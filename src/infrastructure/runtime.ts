import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {configureLimits} from '../domain/limits.js';
configureLimits(process.env);
let root=path.dirname(fileURLToPath(import.meta.url));
while(!existsSync(path.join(root,'h5p_mcp/contracts/v1.json'))) {
 const parent=path.dirname(root);
 if(parent===root) throw new Error('Core package resources unavailable');
 root=parent;
}
export const repositoryRoot=root;
export const load=createRequire(path.join(root,'package.json'));
