import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
assert.equal(lock.packages['node_modules/typescript'].version,'7.0.2');
assert(!Object.keys(lock.packages).some(p=>/node_modules\/(?:eslint|typescript-eslint|@typescript-eslint\/)/.test(p)));
const run=(cli,args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
for(const config of ['tsconfig.domain.json','tsconfig.adapters.json']) {
  const result=run('node_modules/typescript/bin/tsc',['-p',config]);
  assert.equal(result.status,0,result.stdout+result.stderr);
}
const clean=run('node_modules/oxlint/bin/oxlint',['--type-aware','--deny-warnings','domain-probe.ts','adapter-probe.ts','domain-boundary-probe.ts']);
assert.equal(clean.status,0,clean.stdout+clean.stderr);
const invalid=run('node_modules/oxlint/bin/oxlint',['--type-aware','lint-negative.fixture.ts']);
assert.notEqual(invalid.status,0,'Negative lint fixture unexpectedly passed');
assert.match(invalid.stdout+invalid.stderr,/no-floating-promises/);
console.log(JSON.stringify({typescript:'7.0.2',oxlint:'1.90.0',tsgolint:'7.0.2005',
  domain_types:'passed',adapter_types:'passed',lint:'passed',negative_typed_rule:'passed',eslint_absent:'passed'}));
