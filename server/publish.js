// Publishes a static copy of its life to a folder after each night, and commits and pushes it if that folder is in a git
// repository, so a static site can follow a running creature without anyone reaching this machine.
//   node server/publish.js     publish now (config.json "publish": { "dir": "../site/iterant", "git": true })
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ROOT, loadConfig } from './config.js';

const run = promisify(execFile);
const git = (dir, ...args) => run('git', ['-C', dir, ...args], { windowsHide: true });

let queue = Promise.resolve();

/** Export, then (if asked) commit just that folder and push. One publish at a time; a failure is logged, never thrown. */
export function publish(cfg, message = 'Its life, published') {
  const { dir, git: useGit } = cfg.publish || {};
  if (!dir) return Promise.resolve(false);
  queue = queue.then(async () => {
    try {
      const relay = cfg.relay?.url ? ['--relay', cfg.relay.url] : [];
      await run(process.execPath, [join(ROOT, 'server', 'export.js'), '--out', dir, '--data', cfg.dataDir, ...relay], { windowsHide: true });
      if (!useGit) return true;
      await git(dir, 'add', '-A', '--', '.');
      const changed = await git(dir, 'diff', '--cached', '--quiet', '--', '.').then(() => false, () => true);
      if (!changed) return true;
      await git(dir, 'commit', '-q', '-m', message, '--', '.');
      await git(dir, 'pull', '-q', '--rebase', '--autostash');
      await git(dir, 'push', '-q');
      console.log(`published to ${dir}: ${message}`);
      return true;
    } catch (err) {
      console.error(`publishing to ${dir} failed: ${(err.stderr || err.message || '').toString().trim()}`);
      return false;
    }
  });
  return queue;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  if (!cfg.publish?.dir) {
    console.error('nothing to publish to: set "publish": { "dir": "<folder>", "git": true } in config.json');
    process.exit(1);
  }
  const chainFile = join(cfg.dataDir, 'chain.json');
  const head = existsSync(chainFile) ? JSON.parse(readFileSync(chainFile, 'utf8')).at(-1)?.hash : null;
  process.exit((await publish(cfg, `Its life, published by hand${head ? `\n\nLatest seal: ${head}` : ''}`)) ? 0 : 1);
}
