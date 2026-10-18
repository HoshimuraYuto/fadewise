import type { Bar } from '../mix-features.mts';
import type { MixKind } from '../types.mts';

export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export const median = (a: readonly number[]) => {
  const b = a.filter(isNum).sort((x, y) => x - y);

  return b.length ? b[Math.floor(b.length / 2)] : NaN;
};

export const GENTLE = {
  entryLu: 6,
  entryLow: 0.5,
  entryJump: 6,
  entryRun: 2,
  melMax: 0.25,
  maxSkipSec: 20,
  maxSkipFrac: 0.12,
  minSkipSec: 3,
  exitLu: 8,
  exitMinSec: 4,
  maxCutSec: 30,
};
export type GentleOptions = typeof GENTLE;

export interface Candidate {
  t: number | null;
  k: MixKind;
  conf: number;
  why?: string;
  mel?: number;
  cand?: number;
  skip?: number;
  lu?: number;
  cut?: number;
  rep?: number;
  nov?: number;
  step?: number | null;
  tail?: number;
}

export function gentleEntry(
  bars: Bar[],
  trackLufs: number | null,
  first: number | null,
  o: GentleOptions = GENTLE,
): Candidate {
  const out: Candidate = { t: first, k: 'first', conf: 1, why: 'first' };
  if (!bars.length || !isNum(trackLufs) || !isNum(first)) return out;
  const loud = bars.filter((b) => b.lu > trackLufs - 3 && isNum(b.low));
  const lowRef = median(loud.map((b) => b.low));
  const i0 = bars.findIndex((b) => b.t1 > first + 0.05);
  if (i0 < 0) return out;
  const head = Math.max(
    ...bars
      .slice(i0, i0 + 2)
      .map((b) => b.lu)
      .filter(isNum),
  );
  const loudEnough = (b: Bar) =>
    b.lu >= trackLufs - o.entryLu || (isNum(head) && b.lu >= trackLufs - 10 && b.lu >= head + o.entryJump);
  const full = (b: Bar | undefined) =>
    !!b && b.obs > 0.5 && loudEnough(b) && (!(lowRef > 0) || b.low >= o.entryLow * lowRef);

  for (let i = i0; i < bars.length; i++) {
    if (bars[i].t - first > o.maxSkipSec + 8) break;
    let ok = true;

    for (let k = 0; k < o.entryRun; k++)
      if (!full(bars[i + k])) {
        ok = false;
        break;
      }

    if (!ok) continue;
    if (i === i0 || bars[i].t <= first + 0.5) return out;
    const skipped = bars.slice(i0, i);
    // the bar just before the full bars is often a pickup / fill
    const body = skipped.length > 2 ? skipped.slice(0, -1) : skipped;
    const melodic = body.filter((b) => b.mel > o.melMax && b.lu > trackLufs - 20).length;
    if (melodic >= Math.max(1, Math.ceil(body.length / 3)))
      return Object.assign(out, { why: 'melody', mel: +median(body.map((b) => b.mel)).toFixed(2) });
    const skip = bars[i].t - first;
    const dur = bars[bars.length - 1].t1;
    if (skip < o.minSkipSec) return Object.assign(out, { why: 'short' });
    if (skip > o.maxSkipSec || skip > o.maxSkipFrac * dur)
      return Object.assign(out, { why: 'too_long', cand: bars[i].t });
    const gap = Math.min(...skipped.map((b) => trackLufs - b.lu).filter(isNum));

    return {
      t: bars[i].t,
      k: 'thin',
      conf: +Math.min(1, Math.max(0, (gap - 3) / 6)).toFixed(2),
      why: 'thin',
      skip: +skip.toFixed(2),
      lu: +(bars[i].lu - trackLufs).toFixed(1),
    };
  }

  return out;
}

export function gentleExit(
  bars: Bar[],
  trackLufs: number | null,
  last: number | null,
  o: GentleOptions = GENTLE,
): Candidate {
  const out: Candidate = { t: last, k: 'last', conf: 1, why: 'last' };
  if (!bars.length || !isNum(trackLufs) || !isNum(last)) return out;
  let j = -1;

  for (let i = bars.length - 1; i >= 0; i--)
    if (bars[i].t < last && bars[i].obs > 0.5 && bars[i].lu >= trackLufs - o.exitLu) {
      j = i;
      break;
    }

  if (j < 0) return out;
  const t = bars[j].t1;
  if (last - t < o.exitMinSec) return out;
  const audible = bars
    .filter((b) => b.t >= t && b.t < last && b.lu > trackLufs - 30)
    .reduce((s, b) => s + (b.t1 - b.t), 0);
  if (audible < o.exitMinSec) return Object.assign(out, { why: 'short_tail', cand: t });
  if (last - t > o.maxCutSec) return Object.assign(out, { why: 'too_long', cand: t });

  return { t, k: 'fade', conf: +Math.min(1, (last - t) / 12).toFixed(2), why: 'fade', cut: +(last - t).toFixed(2) };
}
