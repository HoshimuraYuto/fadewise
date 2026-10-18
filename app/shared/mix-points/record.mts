import type { Bar } from '../mix-features.mts';
import type { MixKind, MixRecord, MixRow } from '../types.mts';
import { isNum } from './gentle.mts';
import type { Candidate } from './gentle.mts';
import { analyseTrack, seriesFromPage } from './track.mts';
import type { TrackAnalysis } from './track.mts';

export const MIX_V = 1;
export const MIX_KINDS: MixKind[] = ['first', 'thin', 'lift', 'last', 'fade', 'chorusEnd'];
const AGGR_CODES = [2, 5];
function rnd(x: number, d: number): number;
function rnd(x: unknown, d: number): number | null;

function rnd(x: unknown, d: number): number | null {
  return isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null;
}

function edgeLu(bars: Bar[], ref: number | null, t: number, side: 'x' | 'n') {
  const sel =
    side === 'x' ? bars.filter((b) => b.t1 <= t + 0.01).slice(-4) : bars.filter((b) => b.t >= t - 0.01).slice(0, 4);
  let s = 0,
    n = 0;

  for (const b of sel)
    if (isNum(b.lu)) {
      s += Math.pow(10, b.lu / 10);
      n++;
    }

  return n ? rnd(10 * Math.log10(s / n) - (ref ?? 0), 1) : null;
}

export interface EdgeTempoKey {
  bpm: number | null;
  cam: string | null;
}

export function encodeMix(
  A: TrackAnalysis | null | undefined,
  edges: { head?: EdgeTempoKey | null; tail?: EdgeTempoKey | null } = {},
): MixRecord | null {
  if (!A || !A.grid) return null;
  const x: MixRow[] = [],
    n: MixRow[] = [];

  const add = (arr: MixRow[], c: Pick<Candidate, 't' | 'k' | 'conf'> | null, side: 'x' | 'n') => {
    if (!c || !isNum(c.t)) return;
    const ed = side === 'n' ? edges.head : edges.tail;
    const row: MixRow = [rnd(c.t, 2), MIX_KINDS.indexOf(c.k), rnd(c.conf, 2), edgeLu(A.bars, A.ref, c.t, side)];
    if (ed && (isNum(ed.bpm) || ed.cam)) row.push(rnd(ed.bpm, 1), ed.cam || null);
    if (!arr.some((o) => Math.abs(o[0] - row[0]) < 0.5)) arr.push(row);
  };

  const g = A.gentle || { entry: null, exit: null };

  if (g.entry) {
    add(n, { t: A.first, k: 'first', conf: 1 }, 'n');
    if (g.entry.k === 'thin') add(n, g.entry, 'n');
  }

  if (g.exit) {
    add(x, { t: A.last, k: 'last', conf: 1 }, 'x');
    if (g.exit.k === 'fade') add(x, g.exit, 'x');
  }

  if (A.aggr && A.aggr.entry) add(n, A.aggr.entry, 'n');
  if (A.aggr && A.aggr.exit) add(x, A.aggr.exit, 'x');

  return {
    v: MIX_V,
    g: [rnd(A.grid.bpm, 2), rnd(A.grid.bar0, 3), rnd(A.grid.conf, 2)],
    x,
    n,
    h: [A.heard.head ? 1 : 0, A.heard.tail ? 1 : 0, A.heard.full ? 1 : 0],
  };
}

export function mergeMix(old: unknown, neu: unknown): MixRecord | null {
  const ok = (m: unknown): m is MixRecord => {
    const r = m as Partial<MixRecord> | null | undefined;

    return !!r && r.v === MIX_V && Array.isArray(r.x) && Array.isArray(r.n) && Array.isArray(r.h);
  };

  if (!ok(old)) return ok(neu) ? neu : null;
  if (!ok(neu)) return old;

  const side = (o: MixRow[], nw: MixRow[], heard: boolean) => {
    const gentle = (heard ? nw : o).filter((r) => !AGGR_CODES.includes(r[1]));
    const aggr = (neu.h[2] ? nw : o).filter((r) => AGGR_CODES.includes(r[1]));

    return gentle.concat(aggr).sort((a, b) => a[0] - b[0]);
  };

  return {
    v: MIX_V,
    g: neu.h[2] || !(old.g as MixRecord['g'] | undefined) ? neu.g : old.g,
    x: side(old.x, neu.x, !!neu.h[1]),
    n: side(old.n, neu.n, !!neu.h[0]),
    h: [Math.max(old.h[0], neu.h[0]), Math.max(old.h[1], neu.h[1]), Math.min(99, (old.h[2] || 0) + (neu.h[2] || 0))],
  };
}

export function mixAfterListen(
  old: MixRecord | null | undefined,
  mx: unknown,
  tkSegments: unknown,
  rec:
    | {
        durationSec?: number | null;
        tempoKey?: { tempo?: { bpm?: number; confidence?: number; phaseSec?: number | null } | null } | null;
      }
    | null
    | undefined,
  edges?: { head?: Partial<EdgeTempoKey> | null; tail?: Partial<EdgeTempoKey> | null } | null,
): MixRecord | null {
  try {
    const dur = rec && rec.durationSec;
    if (!mx || !isNum(dur) || dur < 30) return old || null;
    const S = seriesFromPage(mx, tkSegments, dur);
    if (S.obs.length < 100) return old || null;
    const t = rec?.tempoKey?.tempo;
    const tempo = t && isNum(t.bpm) && (t.confidence ?? NaN) >= 0.5 ? { bpm: t.bpm, phase: t.phaseSec } : null;
    const A = analyseTrack(S, dur, { tempo });
    const one = (e: Partial<EdgeTempoKey> | null | undefined): EdgeTempoKey | null =>
      e ? { bpm: isNum(e.bpm) ? e.bpm : null, cam: typeof e.cam === 'string' ? e.cam : null } : null;
    const neu = encodeMix(A, edges ? { head: one(edges.head), tail: one(edges.tail) } : {});

    return mergeMix(old, neu) || old || null;
  } catch {
    return old || null;
  }
}
