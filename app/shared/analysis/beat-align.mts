import type { BeatInfo, IndexEntry } from '../types.mts';
import { ALIGN_TEMPO_TOL } from './fade-align.mts';
import { OVERLAP, HEAD_RUSH, heardPos, heardCtx } from './overlap-clock.mts';
import type { Capture } from './overlap-clock.mts';
import type { PlannedMix } from './transition.mts';
import { isNum, round } from './util.mts';

export const BEAT_ALIGN = Object.freeze({
  minConf: 0.5,
  maxRmsMs: 20,
  maxNeighbourBeat: 0.1,
  maxTempoDev: 0.01,
  reachSec: 2,
  minRushSec: 0.15,
  // the page's timer fires this much before the planned stop
  timerEarlySec: 0.03,
});
export type BeatAlignWhy =
  | 'grids'
  | 'no_tempo'
  | 'old_unsteady'
  | 'new_unsteady'
  | 'starts_at_once'
  | 'mix_point'
  | 'no_room'
  | 'no_rush'
  | 'aligned';
export interface BeatGridAt {
  // anchor: song seconds, not AudioContext time
  anchor: number;
  period: number;
}
export interface BeatAlign {
  on: boolean;
  why: BeatAlignWhy;
  old: BeatGridAt | null;
  new: BeatGridAt | null;
}
const wrapBy = (d: number, P: number) => ((((d + P / 2) % P) + P) % P) - P / 2;
// the next track goes through the same worklet delay as the old one
const delayOf = (cap: Capture) => (isNum(cap.delaySec) ? cap.delaySec : OVERLAP.delaySec);

export function edgeBeatGrid(
  bt: Partial<BeatInfo> | null | undefined,
  side: 'head' | 'tail',
  edgeSec: number,
): BeatGridAt | null {
  const B = BEAT_ALIGN;
  if (!bt || !isNum(bt.bpm) || !isNum(bt.conf) || bt.conf < B.minConf) return null;
  const bpm = bt.bpm;
  const gs = (bt.grids || [])
    .filter((g) => g.length >= 6 && g.every(isNum) && g[3] > 0 && Math.abs(g[0] / bpm - 1) <= ALIGN_TEMPO_TOL)
    .sort((a, b) => a[5] - b[5]);
  if (gs.length < 2) return null;
  const [g, nb] = side === 'head' ? [gs[0], gs[1]] : [gs[gs.length - 1], gs[gs.length - 2]];
  const reach = side === 'head' ? g[5] - g[1] <= edgeSec + B.reachSec : g[5] >= edgeSec - B.reachSec;
  if (!reach || g[4] > B.maxRmsMs || Math.abs(60 / g[3] / bpm - 1) > B.maxTempoDev) return null;
  const at = side === 'head' ? edgeSec + 1 : edgeSec - 3;
  const beat = g[2] + Math.round((at - g[2]) / g[3]) * g[3];
  if (Math.abs(wrapBy(beat - nb[2], nb[3]) / nb[3]) > B.maxNeighbourBeat) return null;

  return { anchor: round(beat, 4), period: g[3] };
}

export function beatAlignOf(
  entry: IndexEntry | null | undefined,
  next: IndexEntry | null | undefined,
  mx: PlannedMix | undefined,
): BeatAlign {
  const out = (why: BeatAlignWhy, o: BeatGridAt | null = null, n: BeatGridAt | null = null): BeatAlign => ({
    on: why === 'grids',
    why,
    old: o,
    new: n,
  });
  if (mx?.entry || mx?.exit) return out('mix_point');
  if (!entry?.bt || !next?.bt) return out('no_tempo');
  const ls = entry.en && isNum(entry.en.lastSoundSec) ? entry.en.lastSoundSec : null;
  const o = ls !== null ? edgeBeatGrid(entry.bt, 'tail', ls) : null;
  if (!o) return out('old_unsteady');
  const fs = isNum(next.fs) ? next.fs : 0;
  const n = edgeBeatGrid(next.bt, 'head', fs);
  if (!n) return out('new_unsteady');
  if (!next.fx || fs - HEAD_RUSH.marginSec < BEAT_ALIGN.minRushSec) return out('starts_at_once');

  return out('grids', o, n);
}

export function alignedRushEnd(
  a: Pick<BeatAlign, 'old' | 'new'>,
  cap: Capture,
  run: { t0: number; ct0: number; until: number; rate: number; latest?: number | null },
): { until: number; shiftSec: number; beatSec: number } | null {
  if (!a.old || !a.new || !(run.rate > 1)) return null;
  const R = run.rate,
    B = BEAT_ALIGN;

  // song = ctx time + c once the run stops at u
  const cAt = (u: number) => {
    const end = run.t0 + Math.max(0, (u - run.ct0) / R - B.timerEarlySec);

    return run.ct0 + R * (end - run.t0) - end;
  };

  const tN = a.new.anchor - cAt(run.until) + delayOf(cap);
  const hp = heardPos(cap, tN);
  const bO = a.old.anchor + Math.round((hp - a.old.anchor) / a.old.period) * a.old.period;
  const tO = heardCtx(cap, bO);
  const Pn = a.new.period,
    Po = a.old.period;
  const ratio = Pn / Po;
  const Pm = ratio > 1.5 ? Po : ratio < 0.67 ? Pn : Math.min(Pn, Po);
  const later = (((tO - tN) % Pm) + Pm) % Pm;
  const stopAt = (s: number) => run.until - (s * R) / (R - 1);
  const ok = (s: number) =>
    stopAt(s) - run.ct0 >= B.minRushSec + B.timerEarlySec * R &&
    (s >= 0 || (isNum(run.latest) && stopAt(s) <= run.latest));
  const cands = [later, later - Pm].filter(ok).sort((x, y) => Math.abs(x) - Math.abs(y));
  if (!cands.length) return null;
  const shift = cands[0];

  return { until: round(stopAt(shift), 3), shiftSec: round(shift, 3), beatSec: round(Pm, 4) };
}

// c: song = ctx time + c
export function beatMissBeats(a: Pick<BeatAlign, 'old' | 'new'>, cap: Capture, c: number): number | null {
  if (!a.old || !a.new) return null;
  const tN = a.new.anchor - c + delayOf(cap);
  const bO = a.old.anchor + Math.round((heardPos(cap, tN) - a.old.anchor) / a.old.period) * a.old.period;
  const ratio = a.new.period / a.old.period;
  const Pm = ratio > 1.5 ? a.old.period : ratio < 0.67 ? a.new.period : Math.min(a.new.period, a.old.period);

  return round(wrapBy(tN - heardCtx(cap, bO), Pm) / Pm, 3);
}
