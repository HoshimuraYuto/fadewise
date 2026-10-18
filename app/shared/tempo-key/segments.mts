import type { Segment, Segments, SegmentSummary, SegmentVote } from '../types.mts';
import {
  ANCHOR_RESET_SEC,
  BLOCK_SEC,
  FLUX_RATE,
  MAX_SEG_VOTES,
  MIN_WINDOW_SEC,
  SEG_KEY_FULL_FRAMES,
  SEG_LOGIC_VERSION,
  SEG_SEC,
  SEG_TEMPO_FULL_SEC,
} from './constants.mts';
import { summarizeKey } from './key.mts';
import type { ListenNumbers, SegmentAnchors } from './listen.mts';
import { isNum, round } from './numbers.mts';
import { beatGridFit, beatRoot, summarizeTempo } from './tempo.mts';
import type { FluxSegment } from './tempo.mts';

export interface SegmentWindow {
  from: number;
  to: number;
  at: number;
  approx: boolean;
}
export type SideName = 'head' | 'tail';
export type SegmentListen = Omit<Segment, keyof SegmentSummary>;

export function segmentWindows(anchors: SegmentAnchors | null | undefined): Record<SideName, SegmentWindow | null> {
  const a = anchors || {};
  const out: Record<SideName, SegmentWindow | null> = { head: null, tail: null };
  if (isNum(a.firstSoundSec) && a.firstSoundSec >= 0)
    out.head = { from: a.firstSoundSec, to: a.firstSoundSec + SEG_SEC, at: a.firstSoundSec, approx: false };
  let L: number | null = null,
    approx = false;

  if (isNum(a.lastSoundSec) && a.lastSoundSec > 0) L = a.lastSoundSec;
  else if (isNum(a.durationSec) && a.durationSec > 0) {
    L = a.durationSec;
    approx = true;
  }

  if (L !== null) out.tail = { from: Math.max(0, L - SEG_SEC), to: L, at: L, approx };

  return out;
}

// blocks: [[index, frames, c0..c11]]
export function chromaInWindow(
  blocks: readonly unknown[] | null | undefined,
  win: SegmentWindow | null | undefined,
): { sum: number[]; frames: number } {
  const sum = new Array<number>(12).fill(0);
  let frames = 0;
  if (!win) return { sum, frames };

  for (const x of blocks || []) {
    if (!Array.isArray(x) || x.length !== 14) continue;
    const b = x as unknown[];
    const i0 = b[0],
      n = b[1];
    if (!isNum(i0) || !isNum(n) || n <= 0) continue;
    const s = i0 * BLOCK_SEC,
      e = s + BLOCK_SEC;
    const ov = Math.min(e, win.to) - Math.max(s, win.from);
    if (ov <= 0) continue;
    const w = ov / BLOCK_SEC;

    for (let i = 0; i < 12; i++) {
      const v = b[2 + i];
      sum[i] += isNum(v) ? v * w : 0;
    }

    frames += n * w;
  }

  return { sum, frames };
}

export function fluxInWindow(
  segments: readonly (FluxSegment | null | undefined)[] | null | undefined,
  win: SegmentWindow | null | undefined,
): FluxSegment | null {
  let best: FluxSegment | null = null;
  if (!win) return null;

  for (const s of segments || []) {
    if (!s || !isNum(s.start) || !Array.isArray(s.flux)) continue;
    const i0 = Math.max(0, Math.ceil((win.from - s.start) * FLUX_RATE));
    const i1 = Math.min(s.flux.length, Math.floor((win.to - s.start) * FLUX_RATE));
    if (i1 - i0 <= 0) continue;
    if (!best || i1 - i0 > best.flux.length) best = { start: s.start + i0 / FLUX_RATE, flux: s.flux.slice(i0, i1) };
  }

  return best;
}

// Two halves, so an octave flip or tempo change inside shows up as disagreeing votes.
export function windowVotes(run: FluxSegment | null | undefined): SegmentVote[] {
  const MINW = MIN_WINDOW_SEC * FLUX_RATE;
  if (!run || run.flux.length < MINW) return [];
  const n = run.flux.length;
  const parts =
    n < 2 * MINW
      ? [[0, n]]
      : [
          [0, n >> 1],
          [n >> 1, n],
        ];
  const out: SegmentVote[] = [];

  for (const [i0, i1] of parts) {
    const r = beatRoot(run.flux.slice(i0, i1));
    if (!r || !(r.bpm > 30 && r.bpm < 300)) continue;
    const g = beatGridFit(r.beats, r.bpm);
    out.push([round(r.bpm, 2), round((i1 - i0) / FLUX_RATE, 1), g ? round(g.rmsMs, 1) : null]);
  }

  return out;
}

export function analyseSegments(
  listen: Partial<Pick<ListenNumbers, 'segments' | 'chromaBlocks'>> | null | undefined,
  anchors: SegmentAnchors | null | undefined,
): Record<SideName, SegmentListen | null> {
  const wins = segmentWindows(anchors);
  const out: Record<SideName, SegmentListen | null> = { head: null, tail: null };

  for (const name of ['head', 'tail'] as const) {
    const win = wins[name];
    if (!win) continue;
    const c = chromaInWindow(listen && listen.chromaBlocks, win);
    const run = fluxInWindow(listen && listen.segments, win);
    out[name] = {
      at: round(win.at, 2),
      approx: win.approx,
      votes: windowVotes(run),
      cs: c.sum.map((x) => round(x, 3)),
      cf: round(c.frames, 1),
    };
  }

  return out;
}

function mergeSegment(base: Segment | null | undefined, listen: SegmentListen | null | undefined) {
  if (!listen) return base || null;
  const b =
    base &&
    isNum(base.at) &&
    Math.abs(base.at - (listen.at ?? 0)) <= ANCHOR_RESET_SEC &&
    !(base.approx && !listen.approx)
      ? base
      : null;
  const cs = new Array<number>(12).fill(0);

  for (const src of [b, listen])
    if (src && Array.isArray(src.cs))
      for (let i = 0; i < 12; i++) {
        const v = src.cs[i];
        cs[i] += isNum(v) ? v : 0;
      }

  const votes = (b && Array.isArray(b.votes) ? b.votes : [])
    .concat(Array.isArray(listen.votes) ? listen.votes : [])
    .slice(-MAX_SEG_VOTES);

  return {
    at: listen.at,
    approx: listen.approx,
    votes,
    cs: cs.map((x) => round(x, 3)),
    cf: round((b && isNum(b.cf) ? b.cf : 0) + (listen.cf || 0), 1),
  };
}

export function mergeSegments(
  base: Segments | null | undefined,
  listen: Partial<Record<SideName, SegmentListen | null>> | null | undefined,
): Segments {
  const b = base && base.v === SEG_LOGIC_VERSION ? base : null;
  const seg: Segments = { v: SEG_LOGIC_VERSION, head: null, tail: null };

  for (const name of ['head', 'tail'] as const) {
    const m = mergeSegment(b && b[name], listen && listen[name]);
    seg[name] = m ? Object.assign(m, summarizeSegment(m)) : null;
  }

  return seg;
}

export function summarizeSegment(s: SegmentListen | null | undefined): SegmentSummary {
  if (!s) return { tempo: null, key: null };
  const k = (s.cf ?? 0) > 0 ? summarizeKey(s.cs, s.cf, SEG_KEY_FULL_FRAMES) : null;
  const t = summarizeTempo(s.votes, SEG_TEMPO_FULL_SEC);
  const rms = (Array.isArray(s.votes) ? s.votes : []).map((v) => v[2]).filter(isNum);

  return {
    tempo: t
      ? { bpm: t.bpm, confidence: t.confidence, alt: t.alt, rmsMs: rms.length ? round(Math.max(...rms), 1) : null }
      : null,
    key: k
      ? {
          name: k.name,
          camelot: k.camelot,
          tonic: k.tonic,
          mode: k.mode,
          confidence: k.confidence,
          familyConfidence: k.familyConfidence,
        }
      : null,
  };
}
