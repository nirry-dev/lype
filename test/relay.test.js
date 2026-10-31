// What a relay may ask the creature for, and which configured lives connect to one.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import { relayMayAsk } from '../server/relay.js';

test('a relay may only ask for public things', () => {
  for (const path of ['/api/state', '/api/cycle/12', '/api/cycle/latest', '/api/night/3', '/api/atlas', '/api/world', '/api/letters?visitor=abc-123_DEF', '/works/000012.svg', '/returns/L4.jpg']) {
    assert.ok(relayMayAsk('GET', path), path);
  }
  assert.ok(relayMayAsk('POST', '/api/letters'));
  assert.ok(relayMayAsk('POST', '/api/errands/e3/returns'));
  for (const [method, path] of [
    ['GET', '/api/admin/letters'],
    ['POST', '/api/admin/wake'],
    ['GET', '/api/stream'],
    ['GET', '/returns/L4.jpg?key=secret'],
    ['GET', '/api/letters?visitor=x&key=secret'],
    ['GET', '/admin.json'],
    ['GET', '/works/../admin.json'],
    ['DELETE', '/api/letters'],
    ['POST', '/api/state'],
  ]) {
    assert.ok(!relayMayAsk(method, path), `${method} ${path}`);
  }
});

test('only the configured life connects to the relay, unless a run names one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-test-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify({ relay: { url: 'https://relay.example' } }));
  assert.equal(loadConfig(['--config', file]).relay.connect, true);
  assert.equal(loadConfig(['--config', file, '--mock']).relay.connect, false, 'a mock never takes the real relay');
  assert.equal(loadConfig(['--config', file, '--data', dir]).relay.connect, false, 'nor another life');
  rmSync(dir, { recursive: true, force: true });

  const at = (argv) => loadConfig(['--config', 'none.json', ...argv]);
  assert.equal(at([]).relay.connect, false, 'no relay configured');
  assert.equal(at(['--mock', '--relay', 'http://127.0.0.1:8787']).relay.connect, true);
  assert.equal(at(['--relay', 'https://relay.example']).relay.url, 'https://relay.example');
});
