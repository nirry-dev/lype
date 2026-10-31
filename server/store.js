// JSON files on disk, written atomically (temp file + rename) so a crash never leaves half a memory.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pause = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => Atomics.wait(pause, 0, 0, ms);

export function createStore(dir) {
  for (const sub of ['', 'cycles', 'nights', 'works']) mkdirSync(join(dir, sub), { recursive: true });
  const path = (name) => join(dir, name);

  function writeAtomic(name, text) {
    const target = path(name);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    // Windows can briefly lock a file that is being read (antivirus, indexer); retry the swap.
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, target);
        return;
      } catch (err) {
        if (attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        sleepSync(40 * (attempt + 1));
      }
    }
  }

  return {
    dir,
    path,
    exists: (name) => existsSync(path(name)),
    read(name, fallback) {
      try {
        return JSON.parse(readFileSync(path(name), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw new Error(`could not read ${name}: ${err.message}`);
      }
    },
    write(name, data) {
      writeAtomic(name, JSON.stringify(data, null, 2));
    },
    writeText(name, text) {
      writeAtomic(name, text);
    },
    list(sub) {
      return existsSync(path(sub)) ? readdirSync(path(sub)).filter((f) => f.endsWith('.json')).sort() : [];
    },
  };
}

export const pad = (n, width = 6) => String(n).padStart(width, '0');
