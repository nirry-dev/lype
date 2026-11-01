// Finite memory. Three shelves with a fixed number of slots each. A memory's weight halves every
// `halfLifeCycles` unless something brings it back. During the day new things only queue up ("today");
// at night they compete for room, and whatever loses is forgotten - visibly, so visitors can see what it can't.

export const SHELVES = ['people', 'world', 'moments'];

const STOP = new Set(
  ('the a an and or but of to in on at for with is are was were be been it its i im me my you your this that these those as by from not ' +
    'no so do did have has had just very can could would will about into than then there their they them what when where who how which ' +
    'all any some more most one out up still').split(' '),
);

export function words(text) {
  return new Set((String(text).toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)));
}

/** Jaccard overlap of meaningful words, 0..1. */
export function similarity(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

// Numbers (as digits or words) don't make two memories different: "fifty-six degrees makes corners weep" and
// "fifty-nine degrees makes corners weep" are the same memory.
const NUMBER = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|point|\d+(?:\.\d+)?)$/;
const gist = (text) => new Set([...words(String(text).replace(/-/g, ' '))].filter((w) => !NUMBER.test(w) && w !== 'learned'));

/** How alike two memories are, numbers aside, 0..1. */
export function kin(a, b) {
  const A = gist(a);
  const B = gist(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

export const TWIN = 0.6; // this alike, a new memory only strengthens the old one
export const THEME = 0.3; // this alike, two memories are about the same thing
export const THEME_MAX = 3; // memories about one thing a shelf holds; another only strengthens the strongest of them

/**
 * Memories that said the same thing, folded into one in its own words (the groups and words come from its model at
 * night: see mind.foldPrompt). The new memory keeps the strongest weight, the oldest birth and every letter and thing
 * the old ones held on to; the old ones are forgotten, visibly, as folded into it. Mutates `memory`.
 */
export function fold(memory, groups, cycle) {
  const folded = [];
  for (const g of groups) {
    const shelf = memory.shelves[g.shelf];
    const olds = g.ids.map((id) => shelf.find((m) => m.id === id));
    const m = {
      id: `m${memory.nextId++}`,
      text: g.text,
      weight: Math.round(Math.min(1, Math.max(...olds.map((o) => o.weight)) + 0.05) * 100) / 100,
      born: Math.min(...olds.map((o) => o.born ?? cycle)),
      touched: cycle,
      touches: olds.reduce((n, o) => n + (o.touches ?? 0), 0),
      about: olds[0].about || '',
      because: [...new Set(olds.flatMap((o) => o.because || []))],
      ...(g.holds?.length ? { holds: g.holds } : {}),
      folded: g.ids,
    };
    memory.shelves[g.shelf] = [...shelf.filter((o) => !g.ids.includes(o.id)), m];
    const gone = olds.map((o) => ({ ...o, shelf: g.shelf, forgottenAt: cycle, how: 'folded into one', into: m.id }));
    memory.forgotten.push(...gone);
    folded.push({ ...m, shelf: g.shelf, from: gone });
  }
  return folded;
}

/**
 * The world shelf is for what it was told of the world outside: a memory there that no letter is behind (how the card
 * felt, say) is something that happened to it, and moves to that shelf. Returns what moved. Mutates `memory`.
 */
export function refile(memory) {
  const moved = [];
  for (const m of memory.shelves.world.filter((x) => !x.because?.length)) {
    memory.shelves.world.splice(memory.shelves.world.indexOf(m), 1);
    memory.shelves.moments.push(m);
    moved.push({ id: m.id, text: m.text, from: 'world', to: 'moments' });
  }
  return moved;
}

/** Groups of memories on one shelf that look alike (numbers aside), three or more to a group: what may say one thing. */
export function alike(list) {
  const root = list.map((_, i) => i);
  const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (kin(list[i].text, list[j].text) >= THEME) root[find(i)] = find(j);
  const groups = new Map();
  list.forEach((m, i) => groups.set(find(i), [...(groups.get(find(i)) || []), m.id]));
  return [...groups.values()].filter((g) => g.length >= 3);
}

export function strength(m, cycle, halfLife) {
  const age = Math.max(0, cycle - (m.touched ?? m.born ?? cycle));
  return m.weight * 0.5 ** (age / halfLife);
}

export function emptyMemory() {
  return { shelves: { people: [], world: [], moments: [] }, forgotten: [], today: [], nextId: 1 };
}

/** Something this cycle brought an old memory back: it is refreshed and grows a little. */
export function reinforce(memory, ids, cycle) {
  const touched = [];
  for (const shelf of SHELVES) {
    for (const m of memory.shelves[shelf]) {
      if (!ids.includes(m.id)) continue;
      m.touched = cycle;
      m.touches = (m.touches ?? 0) + 1;
      m.weight = Math.min(1, m.weight + 0.15);
      touched.push(m.id);
    }
  }
  return touched;
}

/** Night-time consolidation. Mutates `memory` and returns what happened, for the journal. */
export function consolidate(memory, cycle, { shelfSize, halfLifeCycles }) {
  const result = { kept: [], merged: [], forgotten: [], faded: [], lost: [] };
  const forget = (m, shelf, how, extra = {}) => {
    const gone = { ...m, shelf, forgottenAt: cycle, how, ...extra };
    memory.forgotten.push(gone);
    return gone;
  };

  // Memories that have decayed to almost nothing slip away on their own.
  for (const shelf of SHELVES) {
    memory.shelves[shelf] = memory.shelves[shelf].filter((m) => {
      if (strength(m, cycle, halfLifeCycles) >= 0.05) return true;
      result.faded.push(forget(m, shelf, 'faded'));
      return false;
    });
  }

  // Each memory on the shelf it belongs on (life.foldMemories has usually done this already, before folding), and
  // no shelf holding more than it has room for: the weakest go.
  result.moved = refile(memory);
  for (const shelf of SHELVES) {
    const list = memory.shelves[shelf];
    while (list.length > shelfSize) {
      let weakest = list[0];
      for (const m of list) if (strength(m, cycle, halfLifeCycles) < strength(weakest, cycle, halfLifeCycles)) weakest = m;
      list.splice(list.indexOf(weakest), 1);
      result.forgotten.push(forget(weakest, shelf, 'pushed out'));
    }
  }

  // The day's candidates compete for room, strongest first.
  for (const c of [...memory.today].sort((a, b) => b.weight - a.weight)) {
    const shelfName = SHELVES.includes(c.shelf) ? c.shelf : 'moments';
    const shelf = memory.shelves[shelfName];

    // the same memory again, or one more about something it already holds enough memories of: the old one grows
    const twin = shelf.find((m) => kin(m.text, c.text) >= TWIN);
    const theme = shelf.filter((m) => kin(m.text, c.text) >= THEME);
    const into = twin || (theme.length >= THEME_MAX ? theme.reduce((a, b) => (strength(b, cycle, halfLifeCycles) > strength(a, cycle, halfLifeCycles) ? b : a)) : null);
    if (into) {
      into.weight = Math.min(1, Math.max(into.weight, c.weight) + 0.1);
      into.touched = cycle;
      into.touches = (into.touches ?? 0) + 1;
      result.merged.push({ into: into.id, text: c.text, shelf: shelfName, ...(twin ? {} : { crowded: true }) });
      continue;
    }

    const fresh = () => ({
      id: `m${memory.nextId++}`,
      text: c.text,
      weight: c.weight,
      born: c.cycle ?? cycle,
      touched: c.cycle ?? cycle,
      touches: 0,
      about: c.about || '',
      because: c.because || [],
    });

    if (shelf.length < shelfSize) {
      const m = fresh();
      shelf.push(m);
      result.kept.push({ ...m, shelf: shelfName });
      continue;
    }

    let weakest = shelf[0];
    for (const m of shelf) if (strength(m, cycle, halfLifeCycles) < strength(weakest, cycle, halfLifeCycles)) weakest = m;
    if (c.weight > strength(weakest, cycle, halfLifeCycles)) {
      const m = fresh();
      shelf.splice(shelf.indexOf(weakest), 1, m);
      result.forgotten.push(forget(weakest, shelfName, 'pushed out', { by: m.id }));
      result.kept.push({ ...m, shelf: shelfName });
    } else {
      result.lost.push({ text: c.text, shelf: shelfName, weight: c.weight });
    }
  }

  memory.today = [];
  if (memory.forgotten.length > 400) memory.forgotten.splice(0, memory.forgotten.length - 400);
  return result;
}
