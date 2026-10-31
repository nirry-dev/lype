// Its body on screen: a soft light whose colour follows its mood (blue when lonely, amber when warm),
// whose outline trembles with restlessness, and which sparks with every word it thinks.

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Loneliness pulls the light toward cold blue, warmth toward lamplight amber; in between it is pale moonlight.
// (Blending the hue directly would pass through green.)
const COLD = [104, 152, 255];
const NEUTRAL = [214, 214, 238];
const WARM = [255, 172, 84];
const NIGHT = [158, 138, 246];
const GREY = [128, 130, 140];

export function moodRGB(mood) {
  const t = clamp(0.5 + ((mood?.warm ?? 0.5) - (mood?.lonely ?? 0.5)) * 0.9);
  const [a, b, u] = t < 0.5 ? [COLD, NEUTRAL, t * 2] : [NEUTRAL, WARM, (t - 0.5) * 2];
  return a.map((v, i) => lerp(v, b[i], u));
}

export function moodColor(mood, alpha = 1) {
  const [r, g, b] = moodRGB(mood).map(Math.round);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const rgba = ([r, g, b], alpha, lift = 0) => `rgba(${Math.round(lerp(r, 255, lift))}, ${Math.round(lerp(g, 255, lift))}, ${Math.round(lerp(b, 255, lift))}, ${alpha})`;

const LOOK = {
  // breath period (s), brightness, size, tremble, sparks per token, tint
  quiet: { period: 6.5, bright: 0.72, size: 1, tremble: 1, sparks: 0 },
  waking: { period: 3.2, bright: 0.9, size: 1.02, tremble: 1.3, sparks: 1 },
  thinking: { period: 3, bright: 1, size: 1.04, tremble: 1.4, sparks: 1 },
  reading: { period: 3.4, bright: 1, size: 1.04, tremble: 1.2, sparks: 1 },
  deciding: { period: 2.6, bright: 0.95, size: 1.03, tremble: 1.6, sparks: 1 },
  drawing: { period: 2.8, bright: 1, size: 1.06, tremble: 1.3, sparks: 1, orbit: true },
  writing: { period: 2.8, bright: 1, size: 1.05, tremble: 1.2, sparks: 1, orbit: true },
  asking: { period: 3, bright: 1, size: 1.05, tremble: 1.3, sparks: 1 },
  replying: { period: 3, bright: 1, size: 1.06, tremble: 1.1, sparks: 1 },
  building: { period: 2.8, bright: 1, size: 1.06, tremble: 1.3, sparks: 1, orbit: true },
  tending: { period: 3.4, bright: 0.95, size: 1.03, tremble: 1, sparks: 1, orbit: true },
  resting: { period: 5, bright: 0.8, size: 1, tremble: 0.8, sparks: 0 },
  reflecting: { period: 3.6, bright: 0.92, size: 1.02, tremble: 1, sparks: 1 },
  dreaming: { period: 8, bright: 0.62, size: 0.96, tremble: 1.5, sparks: 1, tint: NIGHT },
  rewriting: { period: 7, bright: 0.7, size: 0.98, tremble: 1.8, sparks: 1, tint: NIGHT },
  waiting: { period: 7, bright: 0.5, size: 0.7, tremble: 0.5, sparks: 0, shift: 0.22 },
  unreachable: { period: 10, bright: 0.3, size: 0.85, tremble: 0.2, sparks: 0, grey: true },
  faltered: { period: 10, bright: 0.35, size: 0.9, tremble: 0.3, sparks: 0, grey: true },
  paused: { period: 12, bright: 0.38, size: 0.92, tremble: 0.2, sparks: 0, grey: true },
};

export function createPresence(canvas) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mood = { lonely: 0.5, curious: 0.7, calm: 0.6, warm: 0.5, restless: 0.2 };
  let look = LOOK.quiet;
  let current = { ...LOOK.quiet, rgb: [...NEUTRAL], shift: 0 }; // eased toward `look` every frame
  let energy = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  const sparks = [];
  const waves = Array.from({ length: 6 }, (_, i) => ({ k: i + 2, phase: Math.random() * Math.PI * 2, speed: 0.15 + Math.random() * 0.45, amp: 1 / Math.sqrt(i + 2) }));

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = r.width;
    height = r.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function frame(ms) {
    const t = ms / 1000;
    const ease = 0.04;
    const target = look.grey ? GREY : (look.tint ?? moodRGB(mood));
    current.rgb = current.rgb.map((v, i) => lerp(v, target[i], ease));
    for (const key of ['period', 'bright', 'size', 'tremble']) current[key] = lerp(current[key], look[key], ease);
    current.shift = lerp(current.shift, look.shift ?? 0, ease);
    energy *= 0.94;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cx = width / 2 + current.shift * width;
    const cy = height / 2;
    const R = Math.min(width, height) * 0.27 * current.size * (1 + energy * 0.05);
    const col = current.rgb;
    const breath = reduced ? 0 : Math.sin((t * Math.PI * 2) / current.period) * 0.035 * (0.6 + (1 - mood.calm) * 0.8);
    const tremble = reduced ? 0.004 : (0.008 + mood.restless * 0.05) * current.tremble + energy * 0.025;

    // halo
    const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.6);
    halo.addColorStop(0, rgba(col, 0.2 * current.bright));
    halo.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);

    // body: a closed curve whose radius wanders with a few slow waves
    ctx.beginPath();
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      let wobble = 0;
      for (const w of waves) wobble += Math.sin(w.k * a + w.phase + t * w.speed * (0.5 + mood.restless)) * w.amp;
      const r = R * (1 + breath + wobble * tremble);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    const body = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R * 1.1);
    body.addColorStop(0, rgba(col, current.bright, 0.75));
    body.addColorStop(0.55, rgba(col.map((v) => v * lerp(0.6, 0.95, current.bright)), 0.85 * current.bright));
    body.addColorStop(1, rgba(col.map((v) => v * 0.45), 0.25 * current.bright));
    ctx.shadowColor = rgba(col, 0.6 * current.bright);
    ctx.shadowBlur = 40 + energy * 30;
    ctx.fillStyle = body;
    ctx.fill();
    ctx.shadowBlur = 0;

    // sparks: one per streamed token, drifting outward and fading
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= 0.012;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      if (look.orbit) {
        s.a += 0.02;
        s.r += 0.25;
      } else s.r += s.v;
      const x = cx + Math.cos(s.a) * s.r;
      const y = cy + Math.sin(s.a) * s.r;
      ctx.fillStyle = rgba(col, s.life * 0.9, 0.55);
      ctx.beginPath();
      ctx.arc(x, y, 1.1 + s.life * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setMood(next) {
      if (next) mood = { ...mood, ...next };
    },
    setPhase(phase) {
      look = LOOK[phase] || LOOK.quiet;
    },
    /** A word arrived. */
    pulse() {
      energy = Math.min(1, energy + 0.18);
      if (reduced || !look.sparks || sparks.length > 140) return;
      const R = Math.min(width, height) * 0.27;
      sparks.push({ a: Math.random() * Math.PI * 2, r: R * (0.9 + Math.random() * 0.2), v: 0.4 + Math.random() * 0.9, life: 1 });
    },
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
    },
  };
}
