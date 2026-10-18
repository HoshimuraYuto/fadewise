import type { MixCandidate, MixKind, MixView } from '../types.mts';
import type { FadeOut } from './fade-align.mts';
import { RESTORE_AFTER_SEC } from './fades.mts';
import { OVERLAP, overlapWindowSec } from './overlap-clock.mts';
import { isNum, round, obj } from './util.mts';

export const MIX = Object.freeze({
  kinds: Object.freeze(['first', 'thin', 'lift', 'last', 'fade', 'chorusEnd'] as const), // = mix-points.mts MIX_KINDS
  modes: Object.freeze(['gentle', 'auto', 'aggressive'] as const),
  autoMinConf: 0.6,
  windowSec: overlapWindowSec(OVERLAP.maxLeadSec, Math.min(...OVERLAP.rates)),
  entrySeekMinSec: 3,
  // a segue here measured +2.4 LU over the louder track
  fullEntryShape: 'equal',
  fadeSec: Object.freeze({ fade: 2, chorusEnd: 3 } as Record<string, number | undefined>),
  W: Object.freeze({ tempo: 1, key: 0.3, energy: 1, struct: 0.6, aggr: 0.4 }),
});

export function mixOf(x: unknown): MixView | null {
  const m = obj(x);
  if (!m || m.v !== 1 || !Array.isArray(m.x) || !Array.isArray(m.n)) return null;
  const kinds: readonly MixKind[] = MIX.kinds;

  const c = (y: unknown): MixCandidate | null => {
    if (!Array.isArray(y)) return null;
    const row = y as unknown[];
    const k = kinds[row[1] as number] as MixKind | undefined;

    return isNum(row[0]) && row[0] >= 0 && k
      ? {
          t: row[0],
          k,
          c: isNum(row[2]) ? row[2] : 0,
          e: isNum(row[3]) ? row[3] : null,
          bpm: isNum(row[4]) ? row[4] : null,
          key: typeof row[5] === 'string' ? row[5] : null,
        }
      : null;
  };

  const xs = (m.x as unknown[]).map(c).filter((v): v is MixCandidate => !!v),
    ns = (m.n as unknown[]).map(c).filter((v): v is MixCandidate => !!v);
  if (!xs.length && !ns.length) return null;
  const g: unknown = m.g,
    h: unknown = m.h;

  return {
    g: { bpm: Array.isArray(g) && isNum(g[0]) ? g[0] : null },
    x: xs,
    n: ns,
    heard: Array.isArray(h)
      ? { head: !!h[0], tail: !!h[1], full: (h[2] as number | undefined) || 0 }
      : { head: false, tail: false, full: 0 },
  };
}

export interface MixSkip {
  why: string;
  aggrCost: number | null;
}
export interface MixPick {
  x: MixCandidate;
  n: MixCandidate;
  cost: number;
  mode: string;
  nextMx?: boolean;
  skip?: MixSkip | null;
  nextVid?: string | null;
  none?: undefined;
}

type PairLike = { x?: MixCandidate | null; n?: MixCandidate | null } | null | undefined;
export const mixExitOf = (pair: PairLike): MixCandidate | null =>
  pair && pair.x && (pair.x.k === 'fade' || pair.x.k === 'chorusEnd') ? pair.x : null;
export const mixEntryOf = (pair: PairLike): MixCandidate | null =>
  pair && pair.n && pair.n.k !== 'first' && pair.n.t > MIX.entrySeekMinSec ? pair.n : null;

export function mixFadeOut(x: Pick<MixCandidate, 'k' | 't'>): FadeOut {
  const len = MIX.fadeSec[x.k] || 2;

  return { startPos: round(x.t - len, 2), endPos: round(x.t, 2), restorePos: round(x.t + RESTORE_AFTER_SEC, 2) };
}
