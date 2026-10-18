import OnsetDetection from '../vendor/music-tempo/OnsetDetection.mjs';
import TempoInduction from '../vendor/music-tempo/TempoInduction.mjs';
import BeatTracking from '../vendor/music-tempo/BeatTracking.mjs';
import type { TempoSummary, TempoVote } from '../types.mts';
import { FLUX_RATE, MIN_WINDOW_SEC, OCTAVE_TOL, TEMPO_FULL_SEC, WINDOW_SEC } from './constants.mts';
import { isNum, round } from './numbers.mts';

export interface FluxSegment {
  start: number;
  flux: number[];
}
export interface ListenVote {
  bpm: number;
  sec: number;
  beats: number[];
  endSec: number;
}

export function beatRoot(flux: unknown): { bpm: number; beats: number[] } | null {
  if (!Array.isArray(flux) || flux.length < MIN_WINDOW_SEC * FLUX_RATE) return null;

  try {
    const params = {};
    const sf = (flux as unknown[]).map((v) => (isNum(v) ? v : 0));
    OnsetDetection.normalize(sf);
    const peaks = OnsetDetection.findPeaks(sf, params);
    const events = peaks.map((i) => i / FLUX_RATE);
    let cl = TempoInduction.processRhythmicEvents(events, params);
    cl = TempoInduction.mergeClusters(cl, params);
    const sc = TempoInduction.calculateScore(cl, params);
    const tempoList = TempoInduction.createTempoList(
      { clIntervals: cl.clIntervals, clSizes: cl.clSizes, clScores: sc.clScores, clScoresIdxs: sc.clScoresIdxs },
      params,
    );
    let minSF = Infinity;
    for (const v of sf) if (v < minSF) minSF = v;
    const agents = BeatTracking.trackBeat(
      events,
      peaks.map((i) => sf[i] - minSF),
      tempoList,
      params,
    );
    let best = null;
    for (const a of agents) if (!best || a.score > best.score) best = a;
    if (!best || !(best.beatInterval > 0)) return null;
    best.fillBeats();

    return { bpm: 60 / best.beatInterval, beats: best.events.slice() };
  } catch {
    return null; // music-tempo throws strings on sparse input
  }
}

export function listenTempoVotes(
  segments: readonly (FluxSegment | null | undefined)[] | null | undefined,
): ListenVote[] {
  const votes: ListenVote[] = [];
  const W = WINDOW_SEC * FLUX_RATE,
    MINW = MIN_WINDOW_SEC * FLUX_RATE;

  for (const seg of segments || []) {
    if (!seg || !Array.isArray(seg.flux) || !isNum(seg.start)) continue;
    const n = seg.flux.length;
    let i = 0;

    while (n - i >= MINW) {
      let end = Math.min(n, i + W);
      if (n - end < MINW) end = n;
      const r = beatRoot(seg.flux.slice(i, end));

      if (r && isNum(r.bpm) && r.bpm > 30 && r.bpm < 300) {
        const t0 = seg.start + i / FLUX_RATE;
        votes.push({
          bpm: r.bpm,
          sec: (end - i) / FLUX_RATE,
          beats: r.beats.map((b) => t0 + b),
          endSec: t0 + (end - i) / FLUX_RATE,
        });
      }

      i = end;
    }
  }

  return votes;
}

export function tempoClass(bpm: number): number {
  let b = bpm;
  while (b < 80) b *= 2;
  while (b >= 160) b /= 2;

  return b;
}

export const sameTempo = (a: number, b: number) => Math.abs(a / b - 1) <= OCTAVE_TOL;
export const sameClass = (a: number, b: number) => sameTempo(a, b) || sameTempo(a * 2, b) || sameTempo(a, b * 2);

export function summarizeTempo(
  votes: readonly unknown[] | null | undefined,
  fullSec: number = TEMPO_FULL_SEC,
): TempoSummary | null {
  const v = (votes || []).filter(
    (x): x is [number, number, ...unknown[]] => Array.isArray(x) && isNum(x[0]) && x[0] > 0 && isNum(x[1]) && x[1] > 0,
  );
  if (!v.length) return null;
  const total = v.reduce((s, x) => s + x[1], 0);
  let best = { w: -Infinity, members: v };

  for (const cand of v) {
    const c = tempoClass(cand[0]);
    const members = v.filter((x) => sameClass(tempoClass(x[0]), c));
    const w = members.reduce((s, x) => s + x[1], 0);
    if (w > best.w + 1e-9) best = { w, members };
  }

  let oct = { w: -Infinity, same: best.members };

  for (const cand of best.members) {
    const same = best.members.filter((x) => sameTempo(x[0], cand[0]));
    const w = same.reduce((s, x) => s + x[1], 0);
    if (w > oct.w + 1e-9) oct = { w, same };
  }

  const bpm = oct.same.reduce((s, x) => s + x[0] * x[1], 0) / oct.w;
  const alt: ('double' | 'half')[] = [];

  for (const x of best.members) {
    if (sameTempo(x[0], bpm)) continue;
    const tag = x[0] / bpm > 1 ? 'double' : 'half';
    if (!alt.includes(tag)) alt.push(tag);
  }

  const agreement = best.w / total;
  const amount = Math.min(1, best.w / fullSec);

  return {
    bpm: round(bpm, 1),
    confidence: round(agreement * amount, 2),
    agreement: round(agreement, 2),
    octaveAgreement: round(oct.w / best.w, 2),
    agreeingSec: round(best.w, 0),
    totalSec: round(total, 0),
    alt,
  };
}

export function beatPhase(
  votesWithBeats: readonly { bpm: number; beats?: unknown }[] | null | undefined,
  bpm: unknown,
): { phaseSec: number; concentration: number } | null {
  if (!isNum(bpm) || bpm <= 0) return null;
  const period = 60 / bpm;
  let x = 0,
    y = 0,
    n = 0;

  for (const v of votesWithBeats || []) {
    if (!sameTempo(v.bpm, bpm) || !Array.isArray(v.beats)) continue;

    for (const b of v.beats as unknown[]) {
      if (!isNum(b)) continue;
      const a = (2 * Math.PI * (((b % period) + period) % period)) / period;
      x += Math.cos(a);
      y += Math.sin(a);
      n++;
    }
  }

  if (!n) return null;
  const r = Math.hypot(x, y) / n;
  let a = Math.atan2(y, x);
  if (a < 0) a += 2 * Math.PI;

  return { phaseSec: round((a / (2 * Math.PI)) * period, 3), concentration: round(r, 2) };
}

export function beatGridFit(
  beats: unknown,
  bpm: unknown,
): { periodSec: number; anchorSec: number; rmsMs: number } | null {
  if (!Array.isArray(beats) || !isNum(bpm) || bpm <= 0) return null;
  const b = (beats as unknown[])
    .filter(isNum)
    .slice()
    .sort((x, y) => x - y);
  if (b.length < 8) return null;
  const p0 = 60 / bpm;
  // from the gaps: BeatRoot's interval is ~0.5 % off, a whole beat over ~100 beats
  const k = [0];
  for (let i = 1; i < b.length; i++) k.push(k[i - 1] + Math.max(1, Math.round((b[i] - b[i - 1]) / p0)));
  const n = b.length;
  let mk = 0,
    mt = 0;

  for (let i = 0; i < n; i++) {
    mk += k[i];
    mt += b[i];
  }

  mk /= n;
  mt /= n;
  let sxy = 0,
    sxx = 0;

  for (let i = 0; i < n; i++) {
    sxy += (k[i] - mk) * (b[i] - mt);
    sxx += (k[i] - mk) ** 2;
  }

  if (!(sxx > 0)) return null;
  const period = sxy / sxx,
    a = mt - period * mk;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (b[i] - (a + period * k[i])) ** 2;

  return { periodSec: period, anchorSec: a + period * k[n - 1], rmsMs: Math.sqrt(ss / n) * 1000 };
}

export function phaseFromVotes(votes: readonly TempoVote[], bpm: number): number | null {
  const period = 60 / bpm;
  let x = 0,
    y = 0,
    n = 0;

  for (const v of votes) {
    const b = v[0] as number,
      sec = v[1] as number,
      ph = v[2];
    if (!isNum(ph) || !sameTempo(b, bpm)) continue;
    const a = (2 * Math.PI * (ph % period)) / period;
    x += Math.cos(a) * sec;
    y += Math.sin(a) * sec;
    n += sec;
  }

  if (!n) return null;
  let a = Math.atan2(y, x);
  if (a < 0) a += 2 * Math.PI;

  return round((a / (2 * Math.PI)) * period, 3);
}
