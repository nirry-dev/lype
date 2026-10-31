// Syntax-checks every script in the project (the tests import most of the server, but not the pages or entry points).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'data', 'examples', '.git'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.js')) files.push(path);
  }
})(root);

let failed = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed++;
    console.error(`✗ ${relative(root, file)}\n${res.stderr}`);
  }
}
console.log(`${files.length - failed}/${files.length} files parse`);
process.exit(failed ? 1 : 0);
