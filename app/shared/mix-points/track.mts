import { listenTempoVotes, summarizeTempo, beatPhase } from '../tempo-key.mts';
import type { FluxSegment } from '../tempo-key.mts';
import { FPS, integrated, firstLastSound, barGrid, barFeatures, refinePhase } from '../mix-features.mts';
import type { Bar, BarGrid, Series } from '../mix-features.mts';
import { aggressive } from './aggressive.mts';
import type { AggressiveResult } from './aggressive.mts';
import { gentleEntry, gentleExit, isNum } from './gentle.mts';
import type { Candidate } from './gentle.mts';

// snap.mx rows: [ct, lu, low share, high share, ...12 chroma 0..99 or none]
export const MX_MAX_FRAMES = 12000;

export function seriesFromPage(mx: unknown, tkSegments: unknown, dur: unknown): Series & { obs: number[] } {
  const f = mx && typeof mx === 'object' ? (mx as { f?: unknown }).f : null;
  const rows = Array.isArray(f) ? (f as unknown[]).slice(0, MX_MAX_FRAMES) : [];
  const n = Math.ceil((isNum(dur) && dur > 0 ? dur : 0) * FPS) + 1;
  const S = {
    n,
    lu: new Float64Array(n).fill(NaN),
    low: new Float64Array(n).fill(NaN),
    high: new Float64Array(n).fill(NaN),
    on: new Float64Array(n).fill(NaN),
    cr: Array.from({ length: n }, (): number[] | null => null),
    fluxRuns: [] as Series['fluxRuns'],
    obs: [] as number[],
  };

  for (const x of rows) {
    if (!Array.isArray(x)) continue;
    const r = x as unknown[];
    const ct = r[0],
      lu = r[1];
    if (!isNum(ct) || !isNum(lu)) continue;
    const i = Math.round(ct * FPS - 0.5);
    if (i < 0 || i >= n) continue;
    S.lu[i] = Math.max(-120, lu);

    if (isNum(r[2]) && isNum(r[3])) {
      S.low[i] = r[2];
      S.high[i] = r[3];
    }

    if (r.length >= 16 && r.slice(4, 16).every(isNum)) S.cr[i] = r.slice(4, 16) as number[];
    S.obs.push(ct);
  }

  for (const x of Array.isArray(tkSegments) ? (tkSegments as unknown[]) : []) {
    const g = x as Partial<FluxSegment> | null;
    if (!g || !isNum(g.start) || !Array.isArray(g.flux) || !g.flux.length) continue;
    S.fluxRuns.push({
      start: g.start,
      flux: (g.flux as unknown[]).map((v) => (isNum(v) ? v : 0)),
      end: g.start + g.flux.length / 100,
    });
  }

  return S;
}

function tempoOf(S: Series): { bpm: number; phase: number | null } | null {
  const votes = listenTempoVotes(S.fluxRuns.map((r) => ({ start: r.start, flux: r.flux })));
  const sum = summarizeTempo(votes.map((v) => [v.bpm, v.sec, 0]));
  if (!sum) return null;
  const ph = beatPhase(votes, sum.bpm);

  return { bpm: sum.bpm, phase: ph ? ph.phaseSec : null };
}

export interface TrackAnalysis {
  ref: number | null;
  first: number | null;
  last: number | null;
  grid: BarGrid | null;
  bars: Bar[];
  gentle: { entry: Candidate | null; exit: Candidate | null } | null;
  aggr: AggressiveResult | null;
  heard: { head: boolean; tail: boolean; full: boolean };
}

export function analyseTrack(
  S: Series,
  dur: number,
  opts: { tempo?: { bpm: number; phase?: number | null } | null } = {},
): TrackAnalysis {
  const ref = integrated(S.lu);
  const { first, last } = firstLastSound(S);
  const obs = S.obs || [];
  const headHeard = obs.length > 0 && Math.min(...obs) <= 1.0,
    tailHeard = obs.length > 0 && Math.max(...obs) >= dur - 3;
  const full = headHeard && tailHeard && obs.length >= 0.9 * dur * FPS;
  const base: TrackAnalysis = {
    ref,
    first,
    last,
    grid: null,
    bars: [],
    gentle: null,
    aggr: null,
    heard: { head: headHeard, tail: tailHeard, full },
  };
  let tempo = opts.tempo && isNum(opts.tempo.bpm) ? Object.assign({}, opts.tempo) : null;
  if (!tempo) tempo = tempoOf(S);
  if (!tempo || !isNum(tempo.bpm) || !isNum(ref)) return base;
  const rp = refinePhase(S, tempo.bpm, isNum(tempo.phase) ? tempo.phase : 0);
  const grid = barGrid(S, rp.bpm, rp.phase, dur);
  const bars = barFeatures(S, grid, dur);
  const entry = headHeard ? gentleEntry(bars, ref, first) : null;
  const exit = tailHeard ? gentleExit(bars, ref, last) : null;
  const aggr = full ? aggressive(bars, ref, first, last) : null;

  return Object.assign(base, { grid, bars, gentle: { entry, exit }, aggr });
}
