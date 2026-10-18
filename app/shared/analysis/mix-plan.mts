import * as KC from '../key-compat.mts';
import type { IndexEntry, MixCandidate, MixView, OrderKey } from '../types.mts';
import { MIX } from './mix.mts';
import type { MixSkip, MixPick } from './mix.mts';
import { TR_MIN_SKIP_SEC } from './transition.mts';
import { isNum, round } from './util.mts';

const MIX_AGGR = new Set<string>(['lift', 'chorusEnd']);
const MIX_ALLOW = {
  gentle: { x: ['last', 'fade'], n: ['first', 'thin'] },
  aggressive: { x: ['last', 'fade', 'chorusEnd'], n: ['first', 'thin', 'lift'] },
};

function mixKeyOf(c: MixCandidate, tk: OrderKey | null | undefined, side: 'head' | 'tail') {
  const s = KC.keyOfTk(tk, side);
  if (!c.key) return s;
  const p = KC.parseCamelot(c.key),
    q = s && KC.parseCamelot(s.camelot);

  return p && q && p.n === q.n && p.l === q.l ? s : { camelot: c.key, keyConf: 0, famConf: 0, related: [] };
}

const mixKeyCost = (x: MixCandidate, n: MixCandidate, cur: IndexEntry, next: IndexEntry) =>
  round(1 - KC.keyTerm(mixKeyOf(x, cur.tk, 'tail'), mixKeyOf(n, next.tk, 'head')), 4);

function mixTempoCost(x: MixCandidate, n: MixCandidate) {
  if (!isNum(x.bpm) || !isNum(n.bpm)) return 0.5;
  let r = n.bpm / x.bpm;
  while (r > 1.41) r /= 2;
  while (r < 0.71) r *= 2;

  return Math.min(1, Math.abs(r - 1) / 0.08);
}

function mixEnergyCost(x: MixCandidate, n: MixCandidate) {
  const ex = isNum(x.e) ? x.e : 0,
    en = isNum(n.e) ? n.e : 0;

  return Math.min(1, Math.max(0, ex - en - 3) / 9 + (0.5 * Math.max(0, Math.min(ex, en) + 3)) / 6);
}

interface AggrBest {
  cost: number;
  tempo: number;
  noTempo: boolean;
  conf: number;
}

export function planMix(
  cur: IndexEntry | null | undefined,
  next: IndexEntry | null | undefined,
  ctx?: { mode?: unknown; now?: unknown; midExit?: unknown } | null,
): MixPick | { none: string } {
  const o = ctx || {};
  const mode = (MIX.modes as readonly unknown[]).includes(o.mode) ? (o.mode as string) : 'gentle';
  const a = cur && cur.mx,
    b = next ? next.mx || { g: { bpm: null }, x: [], n: [] } : null;
  if (!cur || !next || !a || !b) return { none: !a ? 'no_exit' : 'no_entry' };
  const xs = exitCandidates(cur, a, mode, o.midExit);
  const ns = entryCandidates(next, b, mode);
  for (const c of xs) fillEdge(c, cur.tk, 'tail', a.g);
  for (const c of ns) fillEdge(c, next.tk, 'head', b.g);
  const search = cheapestPair(xs, ns, cur, next, mode, o.now);
  const best = search.best;
  if (!best) return { none: xs.length ? 'window' : 'no_exit' };
  best.nextMx = !!next.mx;
  if (mode !== 'gentle' && !MIX_AGGR.has(best.x.k) && !MIX_AGGR.has(best.n.k))
    best.skip = mixSkipWhy(a, b, o, mode, search.bestAggr, search.aggrLate);

  return best;
}

const BLANK_CANDIDATE = { c: 1, e: null, bpm: null, key: null };
const isMidCandidate = (c: MixCandidate) => c.k !== 'last' && c.k !== 'first';

function candidateFilter(mode: string) {
  const allow = mode === 'gentle' ? MIX_ALLOW.gentle : MIX_ALLOW.aggressive;
  const confident = (c: MixCandidate) => mode !== 'auto' || !MIX_AGGR.has(c.k) || c.c >= MIX.autoMinConf;

  return { allow, confident };
}

function exitCandidates(cur: IndexEntry, mx: MixView, mode: string, midExit: unknown): MixCandidate[] {
  const { allow, confident } = candidateFilter(mode);
  const duration = isNum(cur.d) ? cur.d : Infinity;
  const usable = (c: MixCandidate) =>
    isMidCandidate(c) &&
    allow.x.includes(c.k) &&
    confident(c) &&
    c.t < duration - TR_MIN_SKIP_SEC &&
    c.t > duration / 2 &&
    midExit !== false;
  const xs = mx.x.filter(usable).map((c) => Object.assign({}, c));
  const lastX = mx.x.find((c) => c.k === 'last');
  const lastSound = cur.en && isNum(cur.en.lastSoundSec) ? cur.en.lastSoundSec : lastX ? lastX.t : null;
  if (isNum(lastSound)) xs.push(Object.assign({}, BLANK_CANDIDATE, lastX || {}, { t: lastSound, k: 'last' as const }));

  return xs;
}

function entryCandidates(next: IndexEntry, mx: MixView, mode: string): MixCandidate[] {
  const { allow, confident } = candidateFilter(mode);
  const duration = isNum(next.d) ? next.d : Infinity;
  const usable = (c: MixCandidate) =>
    isMidCandidate(c) && allow.n.includes(c.k) && confident(c) && c.t < duration * 0.4;
  const ns = mx.n.filter(usable).map((c) => Object.assign({}, c));
  const firstN = mx.n.find((c) => c.k === 'first');
  const firstSound = isNum(next.fs) ? next.fs : firstN ? firstN.t : 0;
  ns.push(Object.assign({}, BLANK_CANDIDATE, firstN || {}, { t: firstSound, k: 'first' as const }));

  return ns;
}

function fillEdge(c: MixCandidate, tk: OrderKey | null | undefined, side: 'head' | 'tail', g?: MixView['g'] | null) {
  const s = tk && tk[side];
  if (!isNum(c.bpm))
    c.bpm = s && isNum(s.bpm) ? s.bpm : tk && isNum(tk.bpm) ? tk.bpm : g && isNum(g.bpm) ? g.bpm : null;
  if (!c.key) c.key = s && s.cam ? s.cam : tk && tk.cam ? tk.cam : null;
}

function mixPairCost(x: MixCandidate, n: MixCandidate, cur: IndexEntry, next: IndexEntry) {
  const parts = {
    tempo: mixTempoCost(x, n),
    key: mixKeyCost(x, n, cur, next),
    energy: mixEnergyCost(x, n),
    struct: (x.k === 'last' ? 0.5 : 0) + (n.k === 'first' ? 0.5 : 0),
    aggr: (MIX_AGGR.has(x.k) ? 1 - x.c : 0) + (MIX_AGGR.has(n.k) ? 1 - n.c : 0),
  };
  let cost = 0;
  for (const k of Object.keys(MIX.W) as (keyof typeof MIX.W)[]) cost += MIX.W[k] * parts[k];
  if ((MIX_AGGR.has(x.k) || MIX_AGGR.has(n.k)) && parts.tempo >= 0.5) cost += 2;

  return { cost, tempo: parts.tempo };
}

function cheapestPair(
  xs: MixCandidate[],
  ns: MixCandidate[],
  cur: IndexEntry,
  next: IndexEntry,
  mode: string,
  now: unknown,
): { best: MixPick | null; bestAggr: AggrBest | null; aggrLate: boolean } {
  let best: MixPick | null = null,
    bestAggr: AggrBest | null = null,
    aggrLate = false;

  for (const x of xs) {
    if (isNum(now) && x.t - MIX.windowSec < now) {
      if (MIX_AGGR.has(x.k)) aggrLate = true;
      continue;
    }

    for (const n of ns) {
      const { cost, tempo } = mixPairCost(x, n, cur, next);
      if (!best || cost < best.cost) best = { x, n, cost: round(cost, 3), mode };
      if ((MIX_AGGR.has(x.k) || MIX_AGGR.has(n.k)) && (!bestAggr || cost < bestAggr.cost))
        bestAggr = {
          cost: round(cost, 3),
          tempo,
          noTempo: !isNum(x.bpm) || !isNum(n.bpm),
          conf: Math.min(MIX_AGGR.has(x.k) ? x.c : 1, MIX_AGGR.has(n.k) ? n.c : 1),
        };
    }
  }

  return { best, bestAggr, aggrLate };
}

function mixSkipWhy(
  a: MixView,
  b: MixView,
  o: { midExit?: unknown },
  mode: string,
  bestA: AggrBest | null,
  late: boolean,
): MixSkip | null {
  const raw = a.x.filter((c) => MIX_AGGR.has(c.k)).concat(b.n.filter((c) => MIX_AGGR.has(c.k)));
  if (!raw.length) return null;
  if (bestA)
    return {
      why: bestA.noTempo
        ? 'no_tempo'
        : bestA.tempo >= 0.5
          ? 'tempo'
          : bestA.conf < MIX.autoMinConf
            ? 'low_conf'
            : 'cost',
      aggrCost: bestA.cost,
    };
  if (mode === 'auto' && raw.every((c) => c.c < MIX.autoMinConf)) return { why: 'low_conf', aggrCost: null };
  if (late) return { why: 'window', aggrCost: null };
  if (o.midExit === false && !b.n.some((c) => MIX_AGGR.has(c.k))) return { why: 'mid_off', aggrCost: null };

  return { why: 'position', aggrCost: null };
}
