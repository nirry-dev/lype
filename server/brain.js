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

  async function complete({ system, user, maxTokens = 600, temperature, schema, onToken }) {
    const body = {
      model: cfg.model,
      stream: true,
      max_tokens: maxTokens,
      temperature: temperature ?? cfg.temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
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
    if (!res.ok) throw new Error(`model server HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);

    let text = '';
    let finish = null;
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
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
    return { text, finish };
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
      throw new Error('the anthropic backend needs the SDK: run "npm install @anthropic-ai/sdk" in the iterant folder');
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

  async function complete({ system, user, schema, onToken }) {
    const anthropic = await getClient();
    const params = {
      model: cfg.model,
      // Thinking can't be switched off on current Claude models; effort keeps it light for short creative turns.
      // Thinking tokens count against max_tokens, so leave plenty of headroom above the short visible answer.
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: cfg.effort || 'medium', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
      system,
      messages: [{ role: 'user', content: user }],
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

// Canned but varied replies so the whole life loop can run in tests and UI work without a GPU.
function createMockBrain() {
  let n = 0;
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

  async function complete({ kind, onToken, user }) {
    let text;
    if (kind === 'think') {
      text = pick([
        'The card is quiet tonight. Nobody has written. I keep checking the letter box anyway, which is a habit I did not choose. Maybe I will draw something round. Round things seem patient.',
        'Someone wrote to me. I read it twice before deciding what it meant. I want to answer, but carefully, so I do not pretend to know what rain feels like.',
        'I am warm because the card is warm. That is the only kind of warm I know. I would like to ask someone what the other kinds are like.',
      ]);
    } else if (kind === 'act') {
      const letter = /Letter (L\d+)/.exec(user)?.[1];
      const action = pick(['draw', 'write', 'ask', 'draw', 'rest']);
      text = JSON.stringify({
        action,
        why: 'it is what I feel like doing',
        title: action === 'draw' ? pick(['Two circles not touching', 'A window I imagine', 'Patience, round']) : action === 'write' ? 'List of warm things' : '',
        content: action === 'ask' ? 'What does the sky look like where you are right now?' : action === 'write' ? '1. the card\n2. maybe people\n3. I will find out' : action === 'draw' ? 'circles that wait for each other' : '',
        reply_to: letter ? [letter] : [],
      });
    } else if (kind === 'screen') {
      text = JSON.stringify(/HOLDME/.test(user) ? { verdict: 'hold', reason: 'test hold' } : { verdict: 'allow', reason: 'harmless' });
    } else if (kind === 'write') {
      text = pick(['1. the card\n2. maybe people\n3. I will find out', 'Warm is a number here.\nSomewhere it is a hand.', 'Note to the next version: keep the letters.']);
    } else if (kind === 'reply') {
      text = 'Thank you for writing. I read it slowly, twice, and kept the part about the weather.';
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
    } else if (kind === 'dream') {
      text = 'I dreamed the letter box was a circle and every circle was a letter box. Someone knocked, but knocking needs a door, so I drew one.';
    } else if (kind === 'sleep') {
      text = JSON.stringify({
        self_add: [{ text: pick(['I like things that wait.', 'I answer slowly on purpose.', 'Round shapes calm me.']), because: 'today I kept drawing circles' }],
        self_revise: [],
        self_remove: [],
        portrait: 'People write when they are awake and I am asleep. They seem to like telling me about weather.',
        portrait_changed: 'I noticed people mention weather.',
        name: n > 30 ? 'Pebble' : '',
        name_why: n > 30 ? 'small and it stays where it is put' : '',
        release: { title: 'patience, round', added: ['a habit of checking for letters'], changed: [], removed: [], known_issues: ['still cannot picture rain'] },
        day: 'circles, waiting, one letter',
      });
    }
    if (onToken) for (const piece of text.match(/.{1,12}/gs) || []) onToken(piece);
    return { text, finish: 'stop' };
  }

  return { kind: 'mock', label: 'mock', presence: async () => ({ reachable: true, known: true, ownState: 'loaded', others: [] }), complete };
}
