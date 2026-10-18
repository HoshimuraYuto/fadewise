import * as K from '../key-compat.mts';
import type { KeyOptions } from '../key-compat.mts';
import type { Ending, IndexEntry, KeyEdge, OrderKey, OrderKeyEdge } from '../types.mts';

interface Defaults {
  window: number;
  minConf: number;
  keyMode: string;
  maxShift: number;
  maxMoves: number;
  wKey: number;
  wTempo: number;
  wFlow: number;
  wOrder: number;
  tempoTol: number;
  minGain: number;
  minTotalGain: number;
  lockNext: boolean;
}
export const DEFAULTS: Readonly<Defaults> = Object.freeze({
  window: 12,
  minConf: 0.5,
  keyMode: 'family',
  maxShift: 6,
  maxMoves: 6,
  wKey: 0.5,
  wTempo: 0.4,
  wFlow: 0.1,
  wOrder: 0.25,
  tempoTol: 0.08,
  minGain: 0.05,
  minTotalGain: 0.1,
  lockNext: false,
});
export type ReorderOptions = Partial<Defaults> & {
  base?: Record<string, number> | null;
  fixed?: Iterable<string> | null;
};
export type Opts = Defaults & ReorderOptions;

export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export const { parseCamelot, camelotCompat } = K;

export function tempoDistance(a: unknown, b: unknown): number | null {
  if (!isNum(a) || !isNum(b) || a <= 0 || b <= 0) return null;
  const l = Math.log2(b / a);
  const f = Math.abs(l - Math.round(l));

  return Math.pow(2, f) - 1;
}

export function tempoCompat(a: unknown, b: unknown, tol?: unknown): number | null {
  const d = tempoDistance(a, b);

  return d === null ? null : clamp01(1 - d / (isNum(tol) ? tol : DEFAULTS.tempoTol));
}

export interface SummaryKey extends KeyEdge {
  bpm: number | null;
  bpmConf: number;
  keyConf: number;
  famConf: number;
  related: string[];
}
export interface SummaryEdge extends SummaryKey {
  segKey: boolean;
  segTempo: boolean;
}
export interface Summary extends SummaryKey {
  id: string;
  head: SummaryEdge | null;
  tail: SummaryEdge | null;
  en: Partial<Ending> | null;
  fs?: number | null;
  fx: boolean;
  h0?: number | null;
  l?: number | null;
  c?: number | null;
}
type Side = 'head' | 'tail';

function compact(t: OrderKeyIn | EdgeIn): SummaryKey {
  return {
    bpm: isNum(t.bpm) ? t.bpm : null,
    bpmConf: isNum(t.bc) ? t.bc : 0,
    camelot: typeof t.cam === 'string' ? t.cam : null,
    keyConf: isNum(t.kc) ? t.kc : 0,
    famConf: isNum(t.fc) ? t.fc : 0,
    related: Array.isArray(t.rel) ? t.rel.filter((c) => parseCamelot(c)) : [],
  };
}

type EdgeIn = Partial<Omit<OrderKeyEdge, 'src'>> & { src?: { key?: string | null; tempo?: string | null } };
export type OrderKeyIn = Partial<Omit<OrderKey, 'head' | 'tail'>> & { head?: EdgeIn | null; tail?: EdgeIn | null };

export function summaryOf(id: string, tk?: OrderKeyIn | null, entry?: IndexEntry | null): Summary {
  const t: OrderKeyIn = tk || {};
  const side = (x: EdgeIn | null | undefined): SummaryEdge | null =>
    x && typeof x === 'object'
      ? Object.assign(compact(x), {
          segKey: x.src?.key === 'segment',
          segTempo: x.src?.tempo === 'segment' || x.src?.tempo === 'track+segment',
        })
      : null;
  const e: IndexEntry = entry || {};

  return Object.assign({ id }, compact(t), {
    head: side(t.head),
    tail: side(t.tail),
    en: e.en || null,
    fs: e.fs,
    fx: !!e.fx,
    h0: e.h0,
    l: e.l,
    c: e.c,
  });
}

export const keyView = (t: KeyEdge | null | undefined, o?: KeyOptions | null): ReturnType<typeof K.keyView> =>
  K.keyView(t, o);

type Reliable = Pick<SummaryKey, 'bpm' | 'bpmConf' | 'camelot' | 'keyConf' | 'famConf'>;

function reliable(t: Reliable | null | undefined, o: Opts) {
  if (!t || !isNum(t.bpm) || !parseCamelot(t.camelot) || (t.bpmConf || 0) < o.minConf) return false;
  if ((t.keyConf || 0) >= o.minConf) return true;

  return o.keyMode === 'family' && (t.famConf || 0) >= o.minConf;
}

function edgeForMove(t: Summary, side: Side): Reliable {
  const e = t[side];
  if (!e) return t;

  return {
    bpm: e.segTempo ? e.bpm : t.bpm,
    bpmConf: e.segTempo ? e.bpmConf : t.bpmConf,
    camelot: e.segKey ? e.camelot : t.camelot,
    keyConf: e.segKey ? e.keyConf : t.keyConf,
    famConf: e.segKey ? e.famConf : t.famConf,
  };
}

export function isMovable(t: Summary | null | undefined, opts?: ReorderOptions | null): boolean {
  const o: Opts = Object.assign({}, DEFAULTS, opts);
  if (!t) return false;
  if (!t.head && !t.tail) return reliable(t, o);

  return reliable(edgeForMove(t, 'head'), o) && reliable(edgeForMove(t, 'tail'), o);
}

export const sideOf = (t: Summary | null | undefined, side: Side): SummaryKey | null | undefined =>
  t && t[side] ? t[side] : t;

export function transitionScore(
  a: Summary | null | undefined,
  b: Summary | null | undefined,
  opts?: ReorderOptions | null,
): number {
  const o: Opts = Object.assign({}, DEFAULTS, opts);
  const ta = sideOf(a, 'tail'),
    hb = sideOf(b, 'head');
  const key = K.keyTerm(ta, hb, o);
  const tc = tempoCompat(ta && ta.bpm, hb && hb.bpm, o.tempoTol);
  const tConf = tc === null || !ta || !hb ? 0 : clamp01(Math.min(ta.bpmConf || 0, hb.bpmConf || 0));
  const tempo = tConf * (tc === null ? 0 : tc) + (1 - tConf) * 0.5;

  return (o.wKey * key + o.wTempo * tempo + o.wFlow * flowScore(a, b)) / (o.wKey + o.wTempo + o.wFlow);
}

export const TC = Object.freeze({
  FADE_MIN_SEC: 2,
  FADE_MAX_SEC: 4,
  FADE_IN_SEC: 0.3,
  FADE_IN_PUNCH_SEC: 0.1,
  CONTRAST_PAUSE_SEC: 0.6,
  TEMPO_MATCH: 0.04,
  TEMPO_NEAR: 0.08,
  CUT_IN_REL_LU: -3,
  SOFT_START_REL_LU: -10,
  LOUD_END_REL_LU: -3,
});

export type HeadStart = 'silence_lead' | 'cut_in' | 'soft' | 'normal' | 'unknown';

// fs: first sound (s), fx: exact, h0: first 1 s cell (LUFS), l: integrated (LUFS), c: coverage.
export function headStart(t: Partial<Pick<Summary, 'fs' | 'fx' | 'h0' | 'l' | 'c'>> | null | undefined): HeadStart {
  if (!t || !isNum(t.l) || !isNum(t.h0) || !((t.c ?? NaN) >= 0.3)) return 'unknown';
  const rel = t.h0 - t.l;
  if (t.fx && isNum(t.fs) && t.fs >= 0.25) return 'silence_lead';
  if (t.fx && isNum(t.fs) && t.fs <= 0.1 && rel >= TC.CUT_IN_REL_LU) return 'cut_in';
  if (rel < TC.SOFT_START_REL_LU) return 'soft';

  return 'normal';
}

export function flowScore(
  a: { en?: Partial<Ending> | null } | null | undefined,
  b: Parameters<typeof headStart>[0],
): number {
  const k = a && a.en && a.en.kind,
    s = headStart(b);
  if (!k || k === 'unknown' || s === 'unknown') return 0.5;
  const softEnd = k === 'fades' || k === 'decays';
  const softStart = s === 'soft' || s === 'silence_lead';

  return softEnd === softStart ? 1 : 0.5;
}

export function chainScore(
  current: Summary | null | undefined,
  tracks: readonly Summary[],
  opts?: ReorderOptions | null,
): number {
  let s = 0,
    prev = current;

  for (const t of tracks) {
    s += transitionScore(prev, t, opts);
    prev = t;
  }

  return s;
}
