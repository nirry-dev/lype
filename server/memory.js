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

  // The day's candidates compete for room, strongest first.
  for (const c of [...memory.today].sort((a, b) => b.weight - a.weight)) {
    const shelfName = SHELVES.includes(c.shelf) ? c.shelf : 'moments';
    const shelf = memory.shelves[shelfName];

    const twin = shelf.find((m) => similarity(m.text, c.text) >= 0.6);
    if (twin) {
      twin.weight = Math.min(1, Math.max(twin.weight, c.weight) + 0.1);
      twin.touched = cycle;
      twin.touches = (twin.touches ?? 0) + 1;
      result.merged.push({ into: twin.id, text: c.text, shelf: shelfName });
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
