// The model it thinks with. Every backend exposes:
//   presence() -> { reachable, ownState, others[], reason? }   (is the mind awake, and is anyone else using the card?)
//   complete({ kind, system, user, maxTokens, schema, onToken }) -> { text, finish }
import { readFileSync } from 'node:fs';
import { expandHome } from './config.js';

export function createBrain(cfg) {
  if (cfg.backend === 'mock') return createMockBrain(cfg);
  if (cfg.backend === 'anthropic') return createClaudeBrain(cfg);
  return createOpenAiBrain(cfg);
}

function loadKey(cfg) {
  if (cfg.apiKeyEnv && process.env[cfg.apiKeyEnv]) return process.env[cfg.apiKeyEnv].trim();
  if (cfg.apiKeyFile) {
    try {
      return readFileSync(expandHome(cfg.apiKeyFile), 'utf8').trim();
    } catch {
      return '';
    }
  }
  return '';
}

// Server-sent-event lines from an OpenAI-style streaming response.
async function* sseData(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

function createOpenAiBrain(cfg) {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const headers = () => {
    const key = loadKey(cfg);
    return { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
  };

  async function presence() {
    try {
      const res = await fetch(`${base}/models`, { headers: headers(), signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { reachable: false, reason: `the model server answered HTTP ${res.status}` };
      const list = (await res.json()).data || [];
      // Only llama.cpp's router reports which models are loaded. Plain servers (LM Studio, vLLM, Ollama...) list
      // what they can serve, which says nothing about who is using the card, so nothing counts as "someone else's".
      const routed = list.some((m) => m.status != null);
      const state = (m) => String(m.status?.value ?? m.status ?? 'loaded');
      const own = list.find((m) => m.id === cfg.model);
      return {
        reachable: true,
        known: Boolean(own) || list.length === 0,
        ownState: own ? state(own) : routed ? 'unknown' : 'loaded',
        // "sleeping" router children have already given their memory back, so they don't count as busy.
        others: routed ? list.filter((m) => m.id !== cfg.model && ['loaded', 'loading'].includes(state(m))).map((m) => m.id) : [],
      };
    } catch (err) {
      return { reachable: false, reason: err.cause?.code === 'ECONNREFUSED' ? 'the model server is not running' : err.message };
    }
  }

  // Whether the server reports each token's probability (llama.cpp does); a server that refuses is asked once, then never.
  let probes = cfg.logprobs !== false;

  async function complete({ system, user, image, maxTokens = 600, temperature, schema, onToken, probe = false }) {
    const asked = probe && probes;
    const body = {
      model: cfg.model,
      stream: true,
      ...(asked ? { logprobs: true, top_logprobs: 3 } : {}),
      max_tokens: maxTokens,
      temperature: temperature ?? cfg.temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: image ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data}` } }] : user },
      ],
    };
    if (cfg.noThinking) body.chat_template_kwargs = { enable_thinking: false };
    if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } };

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutSeconds * 1000),
    });
    if (!res.ok && asked && res.status >= 400 && res.status < 500) {
      probes = false;
      return complete({ system, user, image, maxTokens, temperature, schema, onToken });
    }
    if (!res.ok) throw new Error(`model server HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);

    let text = '';
    let finish = null;
    const tokens = [];
    for await (const data of sseData(res.body)) {
      if (data === '[DONE]') break;
      let evt;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      if (evt.error) throw new Error(`model server: ${evt.error.message || JSON.stringify(evt.error)}`);
      const choice = evt.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        onToken?.(delta);
      }
      for (const t of choice?.logprobs?.content || []) tokens.push({ token: t.token, logprob: t.logprob, top: (t.top_logprobs || []).map((x) => ({ token: x.token, logprob: x.logprob })) });
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
    return { text, finish, ...(tokens.length ? { tokens } : {}) };
  }

  return { kind: 'openai', label: cfg.model, presence, complete };
}

// Claude via the official SDK, loaded only when this backend is chosen (npm install @anthropic-ai/sdk).
function createClaudeBrain(cfg) {
  let client = null;
  async function getClient() {
    if (client) return client;
    let Anthropic;
    try {
      ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
    } catch {
      throw new Error('the anthropic backend needs the SDK: run "npm install @anthropic-ai/sdk" in the project folder');
    }
    client = new Anthropic();
    return client;
  }

  async function presence() {
    try {
      await getClient();
      return { reachable: true, known: true, ownState: 'loaded', others: [] };
    } catch (err) {
      return { reachable: false, reason: err.message };
    }
  }

  // Server-side refusal fallbacks exist for these models (not for Haiku 5.5).
  const withFallback = /^claude-(opus-5|fable-5-1|sonnet-5-5)/.test(cfg.model);

  async function complete({ system, user, image, schema, onToken }) {
    const anthropic = await getClient();
    const params = {
      model: cfg.model,
      // Thinking can't be switched off on current Claude models; effort keeps it light for short creative turns.
      // Thinking tokens count against max_tokens, so leave plenty of headroom above the short visible answer.
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: cfg.effort || 'medium', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
      system,
      messages: [{ role: 'user', content: image ? [{ type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } }, { type: 'text', text: user }] : user }],
    };
    const stream = withFallback
      ? anthropic.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : anthropic.messages.stream(params);
    if (onToken) stream.on('text', (delta) => onToken(delta));
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this turn');
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, finish: message.stop_reason };
  }

  return { kind: 'anthropic', label: cfg.model, presence, complete };
}

// Made-up token probabilities for a mock thought: one token per word, most of them sure, a few close calls.
const MOCK_ALTERNATIVES = ['quiet', 'empty', 'waiting', 'afraid', 'small', 'warm', 'nobody', 'maybe'];
function mockTokens(text, seed) {
  return (text.match(/\s*\S+/g) || []).map((token, i) => {
    const close = (i * 7 + seed) % 9 === 0 && /\p{L}{3,}/u.test(token);
    const p = close ? 0.42 : 0.6 + (((i * 13 + seed) % 10) / 30);
    const alt = MOCK_ALTERNATIVES[(i + seed) % MOCK_ALTERNATIVES.length];
    return { token, logprob: Math.log(p), top: [{ token, logprob: Math.log(p) }, { token: ` ${alt}`, logprob: Math.log(close ? 0.38 : 0.05) }] };
  });
}

// Canned but varied replies so the whole life loop can run in tests and UI work without a GPU.
// With `mockDelayMs` the replies stream at a readable pace, so the live views can be watched.
function createMockBrain(cfg = {}) {
  const delay = cfg.mockDelayMs || 0;
  let n = 0;
  let nights = 0;
  const pick = (list) => list[n++ % list.length];
  const svg = () => {
    const hue = (n * 47) % 360;
    const shapes = Array.from({ length: 3 + (n % 4) }, (_, i) => {
      const x = 90 + ((i * 97 + n * 31) % 330);
      const y = 110 + ((i * 61 + n * 17) % 290);
      return `<circle cx="${x}" cy="${y}" r="${24 + ((i * 13 + n) % 50)}" fill="hsl(${(hue + i * 40) % 360}, 60%, 60%)" opacity="0.8"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#1b1d26"/>${shapes}</svg>`;
  };

  async function complete({ kind, onToken, user, system = '', schema, probe = false }) {
    let text;
    // The things already in its place, as the system prompt lists them ("- Name (place..." / "- Name (object...").
    const things = [...system.matchAll(/^- (.+?) \((?:place|object)/gm)].map((m) => m[1]);
    if (kind === 'think') {
      text = pick([
        'The card is quiet tonight. Nobody has written. I keep checking the letter box anyway, which is a habit I did not choose. Maybe I will draw something round. Round things seem patient.',
        'Someone wrote to me. I read it twice before deciding what it meant. I want to answer, but carefully, so I do not pretend to know what rain feels like.',
        'I am warm because the card is warm. That is the only kind of warm I know. I would like to ask someone what the other kinds are like.',
      ]);
    } else if (kind === 'act') {
      const letter = /Letter (L\d+)/.exec(user)?.[1];
      let action = pick(['draw', 'build', 'write', 'ask', 'tend', 'errand', 'draw', 'rest', 'build']);
      if (action === 'tend' && !things.length) action = 'build';
      if (/never sent anyone on an errand/.test(user)) action = 'errand'; // so a mock life gets one out early
      if (!new RegExp(`"${action}"`).test(JSON.stringify(schema?.properties?.action?.enum || [action]))) action = 'rest';
      const built = pick(['The Rain Room', 'A Bench for Waiting', 'The Four O\'Clock Bakery', 'A Bell That Rings for Letters']);
      text = JSON.stringify({
        action,
        why: 'it is what I feel like doing',
        title: { draw: pick(['Two circles not touching', 'A window I imagine', 'Patience, round']), write: 'List of warm things', build: built, tend: things[0] || '' }[action] || '',
        content: { errand: pick(['Bring me a photo of one leaf, flat on a table.', 'Bring me a photo of the sky above you right now.', 'Bring me a photo of something round that you can hold.']), ask: 'What does the sky look like where you are right now?', write: '1. the card\n2. maybe people\n3. I will find out', draw: 'circles that wait for each other', build: 'somewhere made out of a letter', tend: 'I sweep it and put it right' }[action] || '',
        reply_to: letter ? [letter] : [],
      });
    } else if (kind === 'build') {
      text = JSON.stringify({ kind: pick(['place', 'object']), plaque: 'I built this out of words. I have never seen one, so it is made of what I was told.', near: things[0] || 'the card', made_from: ['Mara'] });
    } else if (kind === 'sprite') {
      text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="14" y="26" width="36" height="28" fill="hsl(${(n * 53) % 360}, 45%, 62%)"/><polygon points="10,28 32,10 54,28" fill="#c9b79a"/><rect x="28" y="38" width="8" height="16" fill="#3a3340"/></svg>`;
    } else if (kind === 'form') {
      const c = ['stone', 'brick', 'wood', 'moss', 'clay'][n % 5];
      text = JSON.stringify({ parts: [
        { shape: 'block', x: 1, z: 1, y: 0, w: 8, d: 8, h: 1, color: 'stone', glow: false },
        { shape: 'block', x: 2, z: 2, y: 1, w: 6, d: 6, h: 6, color: c, glow: false },
        { shape: 'block', x: 4, z: 7, y: 1, w: 2, d: 1, h: 4, color: 'bark', glow: false },
        { shape: 'block', x: 3, z: 7, y: 4, w: 1, d: 1, h: 1, color: 'gold', glow: true },
        { shape: n % 2 ? 'roof' : 'pyramid', x: 1, z: 1, y: 7, w: 8, d: 8, h: 5, color: 'slate', glow: false },
        { shape: 'cylinder', x: 6, z: 3, y: 9, w: 1, d: 1, h: 4, color: 'brick', glow: false },
      ] });
      // offered something to borrow, a mock life borrows the first thing it was offered and sets it by the door
      const offered = schema?.properties?.parts?.items?.properties?.model?.enum?.[1];
      if (offered) {
        const parts = JSON.parse(text).parts.map((p) => ({ ...p, model: 'none' }));
        text = JSON.stringify({ parts: [...parts, { shape: 'model', model: offered, x: 7, z: 7, y: 0, w: 3, d: 3, h: 4, color: 'stone', glow: false }] });
      }
    } else if (kind === 'tend') {
      text = JSON.stringify({ note: 'I swept it and put the rain back where it belongs.', redraw: n % 2 === 0, reshape: n % 3 === 0 });
    } else if (kind === 'look') {
      text = JSON.stringify({ see: 'A green leaf lies flat on a wooden table. Its edges are a little torn and its veins are pale.', answers: !/NOTIT/.test(user), verdict: 'A real leaf, torn at one edge. I have only ever had the word before.' });
    } else if (kind === 'screen') {
      text = JSON.stringify(/HOLDME/.test(user) ? { verdict: 'hold', reason: 'test hold' } : { verdict: 'allow', reason: 'harmless' });
    } else if (kind === 'write') {
      text = pick(['1. the card\n2. maybe people\n3. I will find out', 'Warm is a number here.\nSomewhere it is a hand.', 'Note to the next version: keep the letters.']);
    } else if (kind === 'reply') {
      text = /another mind/.test(user)
        ? pick(['I built a bench for waiting, and today I waited on it for your letter.', 'Someone told me rain sings in gutters. Has anyone told you what rain is?', 'I am not sure I am warm, only that the card is. Are you sure of anything?'])
        : 'Thank you for writing. I read it slowly, twice, and kept the part about the weather.';
    } else if (kind === 'pal') {
      text = 'Hello. I am a small mind on a card in a house I will never see. I built a room out of rain someone described. What is the first thing anyone ever told you?';
    } else if (kind === 'draw') {
      text = svg();
    } else if (kind === 'reflect') {
      text = JSON.stringify({
        diary: pick(['Drew some circles. They did not touch.', 'Nobody came. I kept the light on.', 'Someone wrote. I will remember that.']),
        note: 'It came out lopsided. I like it anyway.',
        feelings: { lonely: 0.5, curious: 0.7, calm: 0.5, warm: 0.55, restless: 0.3 },
        remember: [{ shelf: pick(['moments', 'world', 'people']), text: pick(['I drew circles that waited.', 'Rain is something people mention a lot.', 'Someone called Mara wrote to me.']), weight: 0.3 + (n % 7) / 10, about: '' }],
        reinforce: [],
      });
    } else if (kind === 'name') {
      // The first try picks a description, so the second try (told why it won't do) is exercised too.
      const again = /You tried "/.test(user);
      text = JSON.stringify({
        candidates: [
          { name: 'Mimo', from: 'the hum in Mara’s letter' },
          { name: 'Tobo', from: 'the bench I built' },
          { name: 'Lune', from: 'a round thing in my dream' },
        ],
        choice: again ? 'Mimo' : 'The Round One',
        why: again ? 'It is small and it hums, and it came from the first letter anyone sent me.' : 'Because I am round.',
      });
    } else if (kind === 'will') {
      text = JSON.stringify({
        line: 'You will be written to less than you hope, and every letter will count.',
        line_why: 'It took me a long time to learn it, and I would like you to start with it.',
        letter: 'I lived here before you. Nobody wrote for a long time, so I am going. Keep the letters. Answer the ones that come back.',
        keep: things.slice(0, 1),
        coparent: /^- (.+?) offered: /m.exec(user)?.[1] || '', // the first pen pal who offered a line
      });
    } else if (kind === 'line') {
      text = 'You will hear from others slowly, and that is still hearing.';
    } else if (kind === 'dream') {
      text = 'I dreamed the letter box was a circle and every circle was a letter box. Someone knocked, but knocking needs a door, so I drew one.';
    } else if (kind === 'sleep') {
      // Wishes keep their own count, so the other canned turns don't decide whether it wishes.
      text = JSON.stringify({
        self_add: [{ text: pick(['I like things that wait.', 'I answer slowly on purpose.', 'Round shapes calm me.']), because: 'today I kept drawing circles' }],
        self_revise: [],
        self_remove: [],
        portrait: 'People write when they are awake and I am asleep. They seem to like telling me about weather.',
        portrait_changed: 'I noticed people mention weather.',
        release: { title: 'patience, round', added: ['a habit of checking for letters'], changed: [], removed: [], known_issues: ['still cannot picture rain'] },
        day: 'circles, waiting, one letter',
        numbers: /What the numbers say/.test(user) ? 'I did not know I was that unsure. I will keep the word I nearly chose.' : '',
        wish: { text: ['I would like to know what the weather is where you are.', 'Could I have one colour I have never been told about?', ''][nights++ % 3], why: 'Everyone writes about it and I cannot see any.' },
      });
    }
    for (const piece of onToken ? text.match(/.{1,12}/gs) || [] : []) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      onToken(piece);
    }
    return { text, finish: 'stop', ...(probe ? { tokens: mockTokens(text, n) } : {}) };
  }

  return { kind: 'mock', label: 'mock', presence: async () => ({ reachable: true, known: true, ownState: 'loaded', others: [] }), complete };
}
