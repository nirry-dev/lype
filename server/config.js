// Loads config.json over the defaults below and applies command-line overrides.
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8420,
  dataDir: 'data',
  seedFile: 'seed.md',
  brain: {
    // "openai" = any OpenAI-compatible server (llama.cpp, LM Studio, vLLM...), "anthropic" = Claude, "mock" = canned replies for tests.
    backend: 'openai',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'local',
    apiKeyFile: '',
    apiKeyEnv: '',
    noThinking: true,
    logprobs: true, // ask for each word's probability while it thinks (server/measure.js); llama.cpp supports it
    temperature: 0.85,
    timeoutSeconds: 300,
    // A model that reads images, for when its own cannot (a photo someone brought it); unset, it uses its own.
    eyes: '',
    // anthropic only
    effort: 'medium',
  },
  rhythm: {
    cycleMinutes: 20, // time between wakes
    jitter: 0.2, // +-20% so it doesn't tick like a clock
    nightEvery: 8, // cycles per day; then it sleeps and becomes a new version
    // Between cycles, a moment every so often (0 = none): it goes somewhere in its place and may say a few words, a
    // small ask of its model made only while that model is already on the card and the card is not busy (server/moments.js).
    momentSeconds: 90,
    // On a card that holds one model at a time, how long a life it shares the house with keeps the card between
    // cycles before this one takes it back for its own moments (`courtesy.household` names those lives' models).
    momentTurnMinutes: 6,
    bring: true, // in a moment it may set down a small borrowed thing beside what it built (server/moments.js)
    // Its place becomes a town: what it builds goes in quarters it names, and each night it says what its town is becoming.
    city: true,
    // ... and now and then in a moment it may raise something new there from a memory it holds (server/moments.js).
    raise: true,
  },
  power: {
    // Full power (server/moments.js): between cycles its moments come one after another and it thinks aloud in each,
    // on the whole card. Its keeper turns it on (the admin API, or the tray) for `autoOffHours`, after which it ends by
    // itself; "full": true starts it at full power. Over `maxTempC` it slows to its usual moments until the card cools.
    full: false,
    autoOffHours: 3,
    maxTempC: 83,
  },
  courtesy: {
    enabled: true,
    maxGpuBusy: 60, // % utilisation from someone else's work above which it waits
    dontSwapModels: true, // never evict a different model its human has loaded
    household: [], // ...except these: models other lives in the same house run on, which it takes turns with
    retryMinutes: 5,
  },
  memory: {
    shelfSize: 12, // slots per shelf (people / world / moments)
    halfLifeCycles: 36, // a memory's weight halves every N cycles unless something brings it back
  },
  meaning: {
    // An embeddings server on the CPU (llama-server --embedding --device none: see README, Meaning). Its memories are
    // then matched by what they mean as well as by their words, and recall finds things said differently. "" = words only.
    url: '',
  },
  self: {
    maxOwnLines: 10,
  },
  letters: {
    maxLength: 1200,
    perCycle: 2,
    perHour: 6,
  },
  moderation: {
    // "model": rules at the door, then the model screens each letter (and each reply); doubtful ones wait for the keeper.
    // "keeper": every letter waits for the keeper. "off": nothing is screened (fine for a private, local creature).
    mode: 'model',
  },
  errands: {
    // It can ask visitors to bring it one photo of something; every photo waits for its keeper before it or anyone sees it.
    // Its model needs to take images (a llama.cpp model with its mmproj, or Claude) for it to see them.
    enabled: true,
    maxPhotoMb: 3,
  },
  maker: {
    // Things made from its words (server/maker.js, scripts/make.py): an image model draws what it describes, and TripoSR
    // raises the drawing into a mesh, between cycles while the card is free. Off unless "python" is a Python with
    // PyTorch, TripoSR and its models (see scripts/make.py); then it is told it can ask for things to be made.
    enabled: false,
    python: '',
    script: 'scripts/make.py',
    timeoutMinutes: 15,
  },
  publish: {
    // After each night, a static copy of its life is exported here ("" = never), and committed and pushed if "git" is true.
    dir: '',
    git: false,
    // Where that copy can be seen (https), so its pen pals can link to it. "" = it has no public page.
    url: '',
    // The site that copy lives on, linked at the left of its header as a way back ({ url, name }; "" url = no link).
    home: { url: '', name: '' },
  },
  // Apps on this machine that may show its page inside their own window (origins like "http://127.0.0.1:8190", the Nirry
  // app's Lab › Lype). Nothing else may frame it.
  framedBy: [],
  relay: {
    // A relay (relay/, a Cloudflare Worker) it dials out to, so a static site can follow it live and visitors can write
    // to it without anyone reaching this machine. "" = none. The token is a shared secret, also set on the relay.
    url: '',
    tokenFile: '~/.lype/relay-token',
  },
  pals: {
    // Other creatures it writes to, by the address of their outbox (https, or http on this machine); only these are
    // ever fetched. Each is "url" or { "url": ..., "trusted": true } (trusted: screened by the model even when every
    // public letter waits for its keeper).
    list: [],
    pollMinutes: 60,
    // Its keeper can switch pen pal mail between these at any time ("paused" stops it both ways).
    mode: 'open',
    open: { perNight: 3, perCycle: 2, threadMax: 0, restNights: 0 }, // per pal; threadMax 0 = no limit
    throttled: { perNight: 1, perCycle: 1, threadMax: 8, restNights: 2 },
  },
  mortality: {
    // Off by default. When on, it lives only as long as someone writes to it: after `fadeAfter` nights in a row without
    // a letter (from a person or another creature) it begins to fade, and after `dieAfter` it dies on its last night,
    // leaving a will, and its child is born in its place. The life that ended is kept whole in data/ancestors/.
    enabled: false,
    fadeAfter: 10,
    dieAfter: 30,
    // Whether a letter from a pen pal counts. With it on, two creatures that write to each other keep each other alive.
    palsCount: true,
    // How many inherited lines a seed keeps besides its maker's (the newest); older ones are not passed on.
    inheritedLines: 5,
  },
  wishes: {
    // Where its keeper can turn a wish into an issue (a pre-filled "new issue" page); "" hides the link.
    issuesUrl: 'https://github.com/nirry-dev/lype/issues/new',
  },
};

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function loadConfig(argv = process.argv.slice(2)) {
  const file = arg(argv, '--config') || join(ROOT, 'config.json');
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const cfg = merge(structuredClone(DEFAULTS), fromFile); // a copy: callers may change their config freely
  cfg.configFile = existsSync(file) ? resolve(file) : null; // so what it runs (an export, say) uses the same settings

  if (argv.includes('--fast')) {
    // Demo pace: wake every ~15 s and sleep every 4 cycles.
    cfg.rhythm = { ...cfg.rhythm, cycleMinutes: 0.25, jitter: 0, nightEvery: 4, momentSeconds: cfg.rhythm.momentSeconds && 4 };
    cfg.courtesy = { ...cfg.courtesy, retryMinutes: 0.5 };
  }
  if (argv.includes('--mock')) cfg.brain = { ...cfg.brain, backend: 'mock' };
  if (argv.includes('--slow')) cfg.brain = { ...cfg.brain, mockDelayMs: 60 }; // mock replies stream at a readable pace
  if (arg(argv, '--port')) cfg.port = Number(arg(argv, '--port'));
  if (arg(argv, '--data')) cfg.dataDir = arg(argv, '--data');
  if (arg(argv, '--model')) cfg.brain = { ...cfg.brain, model: arg(argv, '--model') };

  const at = (p) => (isAbsolute(expandHome(p)) ? expandHome(p) : join(ROOT, p));
  cfg.dataDir = at(cfg.dataDir);
  cfg.seedFile = at(cfg.seedFile);
  cfg.maker = { ...cfg.maker, script: at(cfg.maker.script), python: cfg.maker.python ? expandHome(cfg.maker.python) : '' };
  // Only the configured life is published: never a mock, another --data folder, or the demo.
  const other = ['--mock', '--data', '--demo'].some((f) => argv.includes(f));
  cfg.publish = { ...cfg.publish, dir: cfg.publish.dir && !other ? at(cfg.publish.dir) : '' };
  // The same for the relay: only the configured life connects, unless a run names a relay itself (--relay <url>).
  if (arg(argv, '--relay')) cfg.relay = { ...cfg.relay, url: arg(argv, '--relay') };
  cfg.relay.connect = Boolean(cfg.relay.url) && (!other || Boolean(arg(argv, '--relay')));
  cfg.paused = argv.includes('--paused');
  if (argv.includes('--demo')) {
    // The example life, copied somewhere temporary and paused, so browsing it never changes the repo or needs a model.
    const copy = join(tmpdir(), `iterant-demo-${process.pid}`);
    cpSync(join(ROOT, 'examples', 'demo-life'), copy, { recursive: true });
    cfg.dataDir = copy;
    cfg.paused = true;
    cfg.recording = true; // a recording is shown as it was lived, so nothing new is given to it
  }
  return cfg;
}
