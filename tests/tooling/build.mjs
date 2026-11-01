// Remove stale compiler output before compiling the current source tree.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const repo=fileURLToPath(new URL('../../',import.meta.url));
await fs.rm(path.join(repo,'dist/core'),{recursive:true,force:true});
const result=spawnSync(process.execPath,['run','tsc'],{cwd:repo,stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
