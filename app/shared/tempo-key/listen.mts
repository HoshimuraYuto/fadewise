import type { TempoKey, TempoVote } from '../types.mts';
import {
  FLUX_RATE,
  MAX_BLOCKS,
  MAX_LISTEN_FLUX_SEC,
  MAX_VOTES,
  SEG_LOGIC_VERSION,
  TEMPO_LOGIC_VERSION,
} from './constants.mts';
import { summarizeKey } from './key.mts';
import { isNum, round } from './numbers.mts';
import { analyseSegments, mergeSegments } from './segments.mts';
import { beatGridFit, beatPhase, listenTempoVotes, phaseFromVotes, summarizeTempo } from './tempo.mts';
import type { FluxSegment, ListenVote } from './tempo.mts';

export interface ListenFeatures {
  segments?: unknown;
  chromaSum?: unknown;
  chromaFrames?: unknown;
  // [index, frames, c0..c11]
  chromaBlocks?: unknown;
  listenedSec?: unknown;
}
export interface ListenNumbers {
  votes: TempoVote[];
  chromaSum: number[] | null;
  chromaFrames: number;
  fluxSec: number;
  segments: FluxSegment[];
  chromaBlocks: number[][];
}
export type ListenInput = Pick<ListenNumbers, 'chromaSum' | 'chromaFrames'> &
  Partial<Pick<ListenNumbers, 'votes' | 'segments' | 'chromaBlocks'>>;
export interface SegmentAnchors {
  firstSoundSec?: number | null;
  lastSoundSec?: number | null;
  durationSec?: number | null;
}

export function analyseListen(tk: unknown): ListenNumbers {
  const out: ListenNumbers = {
    votes: [],
    chromaSum: null,
    chromaFrames: 0,
    fluxSec: 0,
    segments: [],
    chromaBlocks: [],
  };
  if (!tk || typeof tk !== 'object') return out;
  const t = tk as ListenFeatures;
  const segments = fluxWithinBudget(t.segments);
  out.votes = listenTempoVotes(segments).map(voteRow);

  const cs = t.chromaSum;
  const validSum = Array.isArray(cs) && cs.length === 12 && (cs as unknown[]).every((x) => isNum(x) && x >= 0);

  if (validSum && isNum(t.chromaFrames) && t.chromaFrames > 0) {
    out.chromaSum = (cs as number[]).map((x) => round(x, 3));
    out.chromaFrames = Math.round(t.chromaFrames);
  }

  out.fluxSec = round(
    segments.reduce((s, g) => s + g.flux.length / FLUX_RATE, 0),
    1,
  );
  out.segments = segments;
  out.chromaBlocks = validChromaBlocks(t.chromaBlocks);

  return out;
}

function fluxWithinBudget(segments: unknown): FluxSegment[] {
  let budget = MAX_LISTEN_FLUX_SEC * FLUX_RATE;
  const out: FluxSegment[] = [];

  for (const s of Array.isArray(segments) ? (segments as unknown[]) : []) {
    const g = s as Partial<FluxSegment> | null;
    if (!g || !Array.isArray(g.flux) || !isNum(g.start) || budget <= 0) continue;
    const flux = g.flux.slice(0, budget);
    budget -= flux.length;
    out.push({ start: g.start, flux });
  }

  return out;
}

// [bpm, sec, phaseSec, anchorSec, periodSec, rmsMs, endSec]
function voteRow(v: ListenVote): TempoVote {
  const phase = beatPhase([v], v.bpm);
  const grid = beatGridFit(v.beats, v.bpm);

  return [
    round(v.bpm, 2),
    round(v.sec, 1),
    phase ? phase.phaseSec : null,
    grid ? round(grid.anchorSec, 3) : null,
    grid ? round(grid.periodSec, 5) : null,
    grid ? round(grid.rmsMs, 1) : null,
    round(v.endSec, 2),
  ];
}

function validChromaBlocks(blocks: unknown): number[][] {
  const list = Array.isArray(blocks) ? (blocks as unknown[]).slice(0, MAX_BLOCKS) : [];

  return list.filter(
    (b): b is number[] =>
      Array.isArray(b) &&
      b.length === 14 &&
      (b as unknown[]).every((x) => isNum(x) && x >= 0) &&
      Number.isInteger(b[0]) &&
      (b[1] as number) > 0,
  );
}

// Capped so later listens can outvote an early mistake.
export function mergeTempoKey(
  base: Partial<TempoKey> | null | undefined,
  listen: ListenInput | null | undefined,
  nowMs?: number | null,
  anchors?: SegmentAnchors | null,
): TempoKey {
  const b = base && base.logicVersion === TEMPO_LOGIC_VERSION ? base : null;
  const votes = (b && Array.isArray(b.votes) ? b.votes : []).concat((listen && listen.votes) || []).slice(-MAX_VOTES);
  const sum = new Array<number>(12).fill(0);
  let frames = 0;

  for (const src of [b, listen]) {
    if (src && Array.isArray(src.chromaSum) && src.chromaSum.length === 12 && isNum(src.chromaFrames)) {
      for (let i = 0; i < 12; i++) {
        const v = src.chromaSum[i];
        sum[i] += isNum(v) ? v : 0;
      }

      frames += src.chromaFrames;
    }
  }

  const listens =
    (b ? b.listens || 0 : 0) + (listen && ((listen.votes as TempoVote[]).length || listen.chromaFrames > 0) ? 1 : 0);
  const tempo = summarizeTempo(votes);
  if (tempo) tempo.phaseSec = phaseFromVotes(votes, tempo.bpm);
  const out: TempoKey = {
    logicVersion: TEMPO_LOGIC_VERSION,
    votes,
    chromaSum: sum.map((x) => round(x, 3)),
    chromaFrames: frames,
    listens,
    tempo,
    key: frames > 0 ? summarizeKey(sum, frames) : null,
    updatedAt: isNum(nowMs) ? nowMs : Date.now(),
  };
  const oldSeg = b && b.seg && b.seg.v === SEG_LOGIC_VERSION ? b.seg : null;
  let seg = oldSeg;

  if (anchors && listen && (listen.chromaBlocks?.length || listen.segments?.length)) {
    try {
      seg = mergeSegments(oldSeg, analyseSegments(listen, anchors));
    } catch {
      seg = oldSeg;
    }
  }

  if (seg) out.seg = seg;

  return out;
}
