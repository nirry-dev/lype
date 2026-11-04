// Its own place as a picture it can look at: the page's walkable world (#/place?still: from above, in daylight, the
// names on what it built and nothing of the page round it), drawn by a browser with no window and taken over the
// DevTools protocol. No packages: Edge or Chrome, as installed, drawing on the CPU so the graphics card is left to it.
// It never sees the world outside this way; only what it made, the way the people who visit see it.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where a browser that can take the picture is installed (the one its keeper named first), or null. */
export function findBrowser(named = '') {
  const env = process.env;
  const places = [
    named,
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return places.find((p) => p && existsSync(p)) || null;
}

/** The browser's own folder for one life (by where its data lives), beside the code, never in the user's profile. */
export function profileFor(dataDir) {
  const id = createHash('sha256').update(String(dataDir)).digest('hex').slice(0, 12);
  return join(ROOT, '.cache', 'sight', id);
}

/**
 * A picture of the page at `url`, as a JPEG, once the page says it is drawn (data-still="ready" on its root).
 * Throws when there is no browser, the page never gets there, or anything else goes wrong: then it simply doesn't look.
 * @param {{ url: string, browser?: string, profile: string, width?: number, height?: number, timeoutMs?: number }} o
 */
export async function capture({ url, browser = '', profile, width = 1280, height = 860, timeoutMs = 120000 }) {
  const exe = findBrowser(browser);
  if (!exe) throw new Error('there is no browser to draw its place with');
  mkdirSync(profile, { recursive: true });
  const portFile = join(profile, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  const proc = spawn(
    exe,
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--mute-audio',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  const until = Date.now() + timeoutMs;
  let ws = null;
  try {
    // the browser says which port it listens on in a file in its folder
    let port = null;
    while (!port) {
      if (Date.now() > until || proc.exitCode != null) throw new Error('the browser did not start');
      await sleep(200);
      if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || null;
    }
    let target = null;
    while (!target) {
      if (Date.now() > until) throw new Error('the browser had no page');
      target = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((r) => r.json())
        .then((list) => list.find((t) => t.type === 'page'))
        .catch(() => null);
      if (!target) await sleep(200);
    }
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => fail(new Error('could not talk to the browser')), { once: true });
    });
    let n = 0;
    const waiting = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      }
    });
    const call = (method, params = {}) =>
      new Promise((ok, fail) => {
        const id = ++n;
        const timer = setTimeout(() => fail(new Error(`the browser did not answer ${method}`)), Math.max(1000, until - Date.now()));
        waiting.set(id, (m) => {
          clearTimeout(timer);
          if (m.error) fail(new Error(`${method}: ${m.error.message}`));
          else ok(m.result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url });
    for (;;) {
      if (Date.now() > until) throw new Error('its place was not drawn in time');
      await sleep(500);
      const got = await call('Runtime.evaluate', { expression: 'document.documentElement.dataset.still || ""', returnByValue: true }).catch(() => null);
      const state = got?.result?.value;
      if (state === 'failed') throw new Error('the browser could not draw its place');
      if (state === 'ready') break;
    }
    await sleep(600); // the names settle over what they name
    const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    return Buffer.from(shot.data, 'base64');
  } finally {
    try {
      ws?.close();
    } catch {}
    proc.kill();
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5000)]);
  }
}
