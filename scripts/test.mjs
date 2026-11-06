import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const tests=(await readdir(resolve(project,'tests'))).filter(name=>name.endsWith('.test.mjs')).sort();
for(const file of tests){
  const result=spawnSync(process.execPath,[resolve(project,'tests',file)],{stdio:'inherit',cwd:project});
  if(result.status!==0)process.exit(result.status||1);
}
