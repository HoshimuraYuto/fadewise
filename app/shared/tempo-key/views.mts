import type { KeySummary, OrderKeyEdge, PageTempoKey, Segment, TempoKey, TempoSummary } from '../types.mts';
import {
  RELIABLE,
  SEG_KEY_FULL_FRAMES,
  SEG_LOGIC_VERSION,
  SEG_TEMPO_FULL_SEC,
  TEMPO_LOGIC_VERSION,
} from './constants.mts';
import { currentKey, summarizeKey } from './key.mts';
import { isNum, round } from './numbers.mts';
import type { SideName } from './segments.mts';
import { sameClass, sameTempo, summarizeTempo, tempoClass } from './tempo.mts';

export function edgeOf(tk: unknown, side: SideName): OrderKeyEdge {
  const out: OrderKeyEdge = {
    bpm: null,
    bc: 0,
    cam: null,
    kc: 0,
    fc: 0,
    rel: [],
    src: { key: null, tempo: null },
    chg: { key: false, tempo: false },
  };
  if (!tk || typeof tk !== 'object') return out;
  const t = tk as Partial<TempoKey>;
  const seg = t.seg && t.seg.v === SEG_LOGIC_VERSION ? t.seg[side] : null;
  edgeKey(out, seg, currentKey(t));
  const trackTempo = t.tempo && isNum(t.tempo.bpm) && t.logicVersion === TEMPO_LOGIC_VERSION ? t.tempo : null;
  edgeTempo(out, seg ? summarizeTempo(seg.votes, SEG_TEMPO_FULL_SEC) : null, trackTempo);

  return out;
}

const relatedCamelots = (k: KeySummary | null) =>
  k && Array.isArray(k.related)
    ? k.related
        .map((r) => r.camelot)
        .filter((c): c is string => !!c)
        .slice(0, 2)
    : [];

function edgeKey(out: OrderKeyEdge, seg: Segment | null | undefined, trackKey: KeySummary | null) {
  if (seg && (seg.cf ?? 0) > 0 && Array.isArray(seg.cs)) {
    const k = summarizeKey(seg.cs, seg.cf, SEG_KEY_FULL_FRAMES);
    if (!k) return;
    Object.assign(out, { cam: k.camelot, kc: k.confidence, fc: k.familyConfidence, rel: relatedCamelots(k) });
    out.src.key = 'segment';
    const bothReliable = !!trackKey && k.confidence >= RELIABLE && trackKey.confidence >= RELIABLE;
    if (bothReliable && k.camelot !== trackKey.camelot) out.chg.key = true;
  } else if (trackKey) {
    Object.assign(out, {
      cam: trackKey.camelot,
      kc: round(trackKey.confidence * 0.5, 2),
      fc: round(trackKey.familyConfidence * 0.5, 2),
      rel: relatedCamelots(trackKey),
    });
    out.src.key = 'track';
  }
}

function edgeTempo(out: OrderKeyEdge, segTempo: TempoSummary | null, trackTempo: TempoSummary | null) {
  const samePulse = (a: TempoSummary, b: TempoSummary) => sameClass(tempoClass(a.bpm), tempoClass(b.bpm));
  const trackReliable = !!trackTempo && trackTempo.confidence >= RELIABLE;

  if (segTempo && segTempo.confidence >= RELIABLE) {
    out.bpm = segTempo.bpm;
    out.bc = segTempo.confidence;
    out.src.tempo = 'segment';
    if (trackReliable && !samePulse(segTempo, trackTempo)) out.chg.tempo = true;
    else if (trackReliable && !sameTempo(segTempo.bpm, trackTempo.bpm)) out.bpm = trackTempo.bpm;
  } else if (trackTempo && (!segTempo || samePulse(segTempo, trackTempo))) {
    const agreeing = segTempo ? Math.min(segTempo.confidence, trackTempo.confidence) : 0;
    out.bpm = trackTempo.bpm;
    out.bc = round(Math.max(trackTempo.confidence * 0.5, agreeing), 2);
    out.src.tempo = segTempo ? 'track+segment' : 'track';
  } else if (segTempo) {
    out.bpm = segTempo.bpm;
    out.bc = segTempo.confidence;
    out.src.tempo = 'segment';
  }
}

export function pageTempoKey(tk: unknown): PageTempoKey | undefined {
  if (!tk || typeof tk !== 'object') return undefined;
  const t = tk as Partial<TempoKey>;
  let edges: PageTempoKey['edges'];

  try {
    edges = { head: edgeOf(t, 'head'), tail: edgeOf(t, 'tail') };
  } catch {
    edges = null;
  }

  return { logicVersion: t.logicVersion, tempo: t.tempo, votes: t.votes, key: currentKey(t), edges };
}

export interface TempoKeySummaryView {
  bpm: number | null;
  bpmConfidence: number | null;
  bpmReliable: boolean;
  key: string | null;
  camelot: string | null;
  keyConfidence: number | null;
  keyReliable: boolean;
  keyFamilyConfidence: number | null;
  keyFamilyReliable: boolean;
  relatedKeys: { name: string | null; camelot: string | null }[];
}

export function tempoKeySummary(
  tk: { tempo?: TempoSummary | null; key?: unknown; chromaSum?: unknown; chromaFrames?: unknown } | null | undefined,
): TempoKeySummaryView | null {
  if (!tk) return null;
  const t = tk.tempo,
    k = currentKey(tk);

  return {
    bpm: t ? t.bpm : null,
    bpmConfidence: t ? t.confidence : null,
    bpmReliable: !!(t && t.confidence >= RELIABLE),
    key: k ? k.name : null,
    camelot: k ? k.camelot : null,
    keyConfidence: k ? k.confidence : null,
    keyReliable: !!(k && k.confidence >= RELIABLE),
    keyFamilyConfidence: k ? k.familyConfidence : null,
    keyFamilyReliable: !!(k && k.familyConfidence >= RELIABLE),
    relatedKeys: k ? k.related.map((r) => ({ name: r.name, camelot: r.camelot })) : [],
  };
}
