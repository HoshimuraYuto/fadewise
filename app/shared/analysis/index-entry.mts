import type { BeatInfo, IndexEntry, OrderKey, OrderKeyEdge, TrackRecord } from '../types.mts';
import { FRAME_FLOOR_LUFS } from './cells.mts';
import { tailAtEnd, classifyEnding } from './ending.mts';
import { quietHeadSec } from './head-trim.mts';
import { mixOf } from './mix.mts';
import { isNum, obj } from './util.mts';

export const TEMPO_LOGIC_VERSION = 1;

export type RecordInput = Partial<Omit<TrackRecord, 'tempoKey' | 'mix'>> & { tempoKey?: unknown; mix?: unknown };

export function indexEntryOf(r: RecordInput | null | undefined): IndexEntry | null {
  if (!r) return null;
  const head = Array.isArray(r.headProfile) ? r.headProfile[0] : null;
  const en =
    r.tail && tailAtEnd(r.tail.endPos, r.durationSec)
      ? classifyEnding(r.tail, r.integratedLufs, r.lastSoundSec, r.durationSec)
      : null;
  const out: IndexEntry = {
    l: r.integratedLufs,
    c: r.coverage,
    p: r.peakDb,
    y: r.ytPerceptualLoudnessDb,
    fs: r.firstSoundSec,
    fx: !!r.firstSoundExact,
    h0: isNum(head) ? Math.max(FRAME_FLOOR_LUFS, head) : null,
    hq: quietHeadSec(r.headProfile, r.integratedLufs),
    d: r.durationSec,
    en,
    bt: beatInfoOf(r.tempoKey),
    tk: orderKeyOf(r.tempoKey),
  };
  const mx = mixOf(r.mix);
  if (mx) out.mx = mx;

  return out;
}

export function orderKeyOf(x: unknown): OrderKey | null {
  const tk = obj(x);
  if (!tk || tk.logicVersion !== TEMPO_LOGIC_VERSION) return null;
  const t = obj(tk.tempo),
    k0 = obj(tk.key),
    k = k0 && k0.v === 2 ? k0 : null;
  if (!t && !k) return null;
  const rel: unknown = k && k.related;
  const out: OrderKey = {
    bpm: t && isNum(t.bpm) ? t.bpm : null,
    bc: t && isNum(t.confidence) ? t.confidence : 0,
    cam: k && typeof k.camelot === 'string' ? k.camelot : null,
    kc: k && isNum(k.confidence) ? k.confidence : 0,
    fc: k && isNum(k.familyConfidence) ? k.familyConfidence : 0,
    rel: Array.isArray(rel)
      ? (rel as unknown[])
          .map((y) => obj(y)?.camelot)
          .filter((c): c is string => typeof c === 'string')
          .slice(0, 2)
      : [],
  };
  const e = edgesOf(tk);

  if (e) {
    out.head = e.head;
    out.tail = e.tail;
  }

  return out;
}

export function edgesOf(tk: unknown): { head: OrderKeyEdge | null; tail: OrderKeyEdge | null } | null {
  const e = obj(obj(tk)?.edges);
  if (!e) return null;

  const one = (y: unknown): OrderKeyEdge | null => {
    const x = obj(y);
    if (!x) return null;
    const src = obj(x.src),
      chg = obj(x.chg),
      rel: unknown = x.rel;

    return {
      bpm: isNum(x.bpm) ? x.bpm : null,
      bc: isNum(x.bc) ? x.bc : 0,
      cam: typeof x.cam === 'string' ? x.cam : null,
      kc: isNum(x.kc) ? x.kc : 0,
      fc: isNum(x.fc) ? x.fc : 0,
      rel: Array.isArray(rel) ? (rel as unknown[]).filter((c): c is string => typeof c === 'string').slice(0, 2) : [],
      src: src
        ? {
            key: (src.key || null) as OrderKeyEdge['src']['key'],
            tempo: (src.tempo || null) as OrderKeyEdge['src']['tempo'],
          }
        : { key: null, tempo: null },
      chg: { key: !!(chg && chg.key), tempo: !!(chg && chg.tempo) },
    };
  };

  const head = one(e.head),
    tail = one(e.tail);

  return head || tail ? { head, tail } : null;
}

// Stored votes are [bpm, sec, phase, anchorSec, periodSec, rmsMs, endSec].
export function beatInfoOf(x: unknown): BeatInfo | null {
  const tk = obj(x);
  const t = tk && obj(tk.tempo);
  if (!tk || tk.logicVersion !== TEMPO_LOGIC_VERSION || !t || !isNum(t.bpm)) return null;
  const grids: number[][] = [];

  for (const y of Array.isArray(tk.votes) ? (tk.votes as unknown[]) : []) {
    if (!Array.isArray(y)) continue;
    const v = y as unknown[];

    if (
      v.length >= 7 &&
      isNum(v[0]) &&
      isNum(v[1]) &&
      isNum(v[3]) &&
      isNum(v[4]) &&
      v[4] > 0 &&
      isNum(v[5]) &&
      isNum(v[6])
    ) {
      grids.push([v[0], v[1], v[3], v[4], v[5], v[6]]);
    }
  }

  const alt: unknown = t.alt;

  return {
    bpm: t.bpm,
    conf: isNum(t.confidence) ? t.confidence : 0,
    alt: Array.isArray(alt) ? (alt.slice() as string[]) : [],
    ph: isNum(t.phaseSec) ? t.phaseSec : null,
    grids,
  };
}
