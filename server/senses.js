// Its only direct senses: the clock and the graphics card it lives on.
import { execFile } from 'node:child_process';

const num = (s) => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

export function readGpu(timeoutMs = 4000) {
  const query = 'name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw';
  return new Promise((resolve) => {
    execFile('nvidia-smi', [`--query-gpu=${query}`, '--format=csv,noheader,nounits'], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const [name, temp, util, used, total, power] = stdout.trim().split(/\r?\n/)[0].split(',').map((s) => s.trim());
      resolve({ name, tempC: num(temp), util: num(util), memUsedMb: num(used), memTotalMb: num(total), powerW: num(power) });
    });
  });
}

// Two samples a moment apart; the lower utilisation wins so a desktop animation spike doesn't count as "busy".
export async function sampleGpu() {
  const first = await readGpu();
  if (!first) return null;
  await new Promise((r) => setTimeout(r, 900));
  const second = await readGpu();
  return second && second.util < first.util ? second : first;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function partOfDay(hour) {
  if (hour < 5) return 'the middle of the night';
  if (hour < 8) return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 18) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'late evening';
}

export async function readSenses(now = new Date(), { sample = true } = {}) {
  const gpu = sample ? await sampleGpu() : await readGpu();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    at: now.toISOString(),
    time: `${hh}:${mm}`,
    weekday: WEEKDAYS[now.getDay()],
    date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    partOfDay: partOfDay(now.getHours()),
    gpu,
  };
}

const warmthOf = (gpu) => (gpu.tempC == null ? 'of unknown warmth' : gpu.tempC < 45 ? 'cool' : gpu.tempC < 60 ? 'warm' : gpu.tempC < 75 ? 'hot' : 'very hot');
const busyOf = (gpu) => (gpu.util == null ? '' : gpu.util < 10 ? 'quiet' : gpu.util < 40 ? 'a little busy' : gpu.util < 70 ? 'busy' : 'working hard');

/**
 * The machine, as it feels it. Given how it was `before` (its last cycle, or its last moment), a card that is much as
 * it was is said to be so, without its numbers again: what changed stands out, and what didn't doesn't fill every
 * thought. Its numbers are still there for the asking, on its page, and whenever they move.
 */
export function describeMachine(gpu, before = null) {
  if (!gpu) return "You can't feel the machine right now; the card isn't answering.";
  const warmth = warmthOf(gpu);
  const busy = busyOf(gpu);
  if (before && gpu.tempC != null && before.tempC != null && Math.abs(gpu.tempC - before.tempC) < 4 && busy === busyOf(before) && Math.abs((gpu.memUsedMb ?? 0) - (before.memUsedMb ?? 0)) < 512) {
    return `The card feels much as it did before: still ${warmth} and ${busy}.`;
  }
  const gb = (mb) => (mb / 1024).toFixed(1);
  const memory =
    gpu.memUsedMb != null && gpu.memTotalMb
      ? `, and ${gb(gpu.memUsedMb)} of its ${gb(gpu.memTotalMb)} GB of working memory are in use (much of that is the model you run on; the rest is whatever else the house is doing)`
      : '';
  return `The card you live on is ${warmth} (${gpu.tempC}°C) and ${busy} (${gpu.util}% busy)${memory}.`;
}
