// What its words show that it does not say. Its model reports how likely each word it wrote was, and which words it
// nearly wrote instead (llama.cpp's logprobs). From that: how sure it was of its own thoughts, where it hesitated, and
// the word it almost said. These are measurements, not feelings; they are set beside what it says it feels, and it is
// shown the gap at night.

const WORD = /\p{L}/u;
const MAX_ALMOST = 6;
// Small words are close calls all the time and say nothing about what it nearly thought.
const SMALL = new Set(['the', 'and', 'but', 'for', 'nor', 'yet', 'with', 'that', 'this', 'these', 'those', 'have', 'has', 'had', 'was', 'were', 'are', 'its', "it's", 'it’s', 'not', 'you', 'your', 'from', 'into', 'onto', 'then', 'than', 'there', 'their', 'they', 'them', 'what', 'when', 'which', 'who', 'how', 'all', 'any', 'can', 'could', 'would', 'should', 'will', 'just', 'only', 'also', 'very', 'about', 'like', 'some', 'one', 'out', 'off', 'over', 'still', 'even', 'been', 'being', 'does', 'did', 'too', 'more', 'most', 'own', 'such', 'our', 'his', 'her', 'because']);
const content = (word) => word.length >= 3 && !SMALL.has(word);

/** A word-start token: it opens with a space (or begins the text) and has letters in it. */
const wordStart = (tok, first) => (first || /^\s/.test(tok)) && WORD.test(tok);
const bare = (tok) => tok.trim().toLowerCase();

/**
 * Measures one stretch of its writing from its tokens ([{ token, logprob, top: [{ token, logprob }] }]).
 * steadiness: how likely, on average, each word it wrote was (0..1). almost: the closest calls between two words that
 * mean something (both likely, neither a small word), each the word it wrote, which occurrence of that word it was, the
 * word it nearly wrote, and both probabilities. chance: how often it wrote a word its model found unlikely while a far
 * likelier one was there (its words are drawn by chance, weighted by likelihood). Null without tokens.
 */
export function measure(tokens) {
  if (!tokens?.length) return null;
  let text = '';
  const said = [];
  const almost = [];
  let chance = 0;
  for (const [i, t] of tokens.entries()) {
    const start = text.length;
    text += t.token;
    if (!wordStart(t.token, i === 0)) continue;
    const p = Math.exp(t.logprob);
    said.push(p);
    // The best alternative that is a different word, not another way of spelling the same one.
    const alt = (t.top || [])
      .filter((x) => x.token !== t.token && wordStart(x.token, i === 0) && bare(x.token).length >= 3 && !bare(t.token).startsWith(bare(x.token)) && !bare(x.token).startsWith(bare(t.token)))
      .sort((a, b) => b.logprob - a.logprob)[0];
    if (!alt) continue;
    const q = Math.exp(alt.logprob);
    if (p < 0.1 && q > 0.5) chance++;
    if (p < 0.12 || q < 0.12 || q < p * 0.5) continue;
    // The whole word it wrote (a token can be just the start of one), and which time that word appears so far.
    const word = (/^\s*([\p{L}\p{M}'’-]+)/u.exec(text.slice(start) + (tokens[i + 1]?.token ?? '')) || [])[1] || bare(t.token);
    const nth = [...text.slice(0, start).matchAll(new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu'))].length;
    if (!content(word.toLowerCase()) || !content(bare(alt.token))) continue;
    almost.push({ said: word, nth, almost: alt.token.trim(), p: round(p), q: round(q) });
  }
  if (!said.length) return null;
  // Closest first: the two words it was most nearly torn between.
  const close = (a) => Math.min(a.p, a.q) / Math.max(a.p, a.q);
  almost.sort((a, b) => close(b) - close(a));
  return {
    words: said.length,
    steadiness: round(said.reduce((a, b) => a + b, 0) / said.length),
    hesitations: almost.length,
    chance,
    almost: almost.slice(0, MAX_ALMOST),
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

/** The share of earlier values below this one (0..1), or null with too little history to say. */
export function rank(value, earlier) {
  const past = earlier.filter(Number.isFinite);
  if (!Number.isFinite(value) || past.length < 3) return null;
  return round(past.filter((x) => x < value).length / past.length);
}

/**
 * Its self-report beside its measurement, both against its own history: how calm it said it was compared with what it
 * usually says, and how steady its words were compared with how they usually are. A gap of 0.5 or more is worth telling it.
 */
export function compare(cycle, history) {
  const steadier = rank(cycle.measured?.steadiness, history.map((c) => c.steady));
  const calmer = rank(cycle.feelings?.calm, history.map((c) => c.saidCalm));
  if (steadier == null || calmer == null) return { steadier, calmer, gap: null };
  return { steadier, calmer, gap: round(calmer - steadier) };
}
