import type { Segment, SegmentVote, TempoKey, TempoVote } from '../types.mts';
import { MAX_SEG_VOTES, MAX_VOTES, SEG_LOGIC_VERSION, TEMPO_LOGIC_VERSION } from './constants.mts';
import { summarizeKey } from './key.mts';
import { isNum, round } from './numbers.mts';
import type { Loose } from './numbers.mts';
import { summarizeSegment } from './segments.mts';
import type { SegmentListen } from './segments.mts';
import { phaseFromVotes, summarizeTempo } from './tempo.mts';

const MAX_IMPORT_FRAMES = 1e7;
const okBpm = (x: unknown) => isNum(x) && x > 30 && x < 300;
const okVote = (v: unknown): v is TempoVote =>
  Array.isArray(v) &&
  v.length >= 3 &&
  v.length <= 7 &&
  okBpm(v[0]) &&
  isNum(v[1]) &&
  v[1] > 0 &&
  v[1] <= 600 &&
  (v as unknown[]).slice(2).every((x) => x === null || isNum(x));
const okChroma = (cs: unknown, frames: unknown): cs is number[] =>
  Array.isArray(cs) &&
  cs.length === 12 &&
  (cs as unknown[]).every((x) => isNum(x) && x >= 0 && x <= MAX_IMPORT_FRAMES) &&
  isNum(frames) &&
  frames > 0 &&
  frames <= MAX_IMPORT_FRAMES;
const okSegVote = (v: unknown): v is SegmentVote =>
  Array.isArray(v) &&
  v.length === 3 &&
  okBpm(v[0]) &&
  isNum(v[1]) &&
  v[1] > 0 &&
  v[1] <= 120 &&
  (v[2] === null || isNum(v[2]));
const okListens = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 1e6;

export function sanitizeImportTempoKey(tk: unknown): TempoKey | null {
  if (!tk || typeof tk !== 'object') return null;
  const t = tk as Loose;
  if (t.logicVersion !== TEMPO_LOGIC_VERSION) return null;
  const votes = (Array.isArray(t.votes) ? (t.votes as unknown[]) : [])
    .filter(okVote)
    .slice(-MAX_VOTES)
    .map((v) => v.slice());
  const hasChroma = okChroma(t.chromaSum, t.chromaFrames);
  if (!votes.length && !hasChroma) return null;

  const sum = hasChroma ? (t.chromaSum as number[]).map((x) => round(x, 3)) : new Array<number>(12).fill(0);
  const frames = hasChroma ? Math.round(t.chromaFrames as number) : 0;
  const tempo = summarizeTempo(votes);
  if (tempo) tempo.phaseSec = phaseFromVotes(votes, tempo.bpm);
  const updatedAt = t.updatedAt;
  const out: TempoKey = {
    logicVersion: TEMPO_LOGIC_VERSION,
    votes,
    chromaSum: sum,
    chromaFrames: frames,
    listens: okListens(t.listens) ? t.listens : 1,
    tempo,
    key: frames > 0 ? summarizeKey(sum, frames) : null,
    updatedAt: isNum(updatedAt) && updatedAt > 0 ? Math.round(updatedAt) : Date.now(),
  };
  const seg = t.seg as Loose | null | undefined;

  if (seg && typeof seg === 'object' && seg.v === SEG_LOGIC_VERSION) {
    const head = sanitizeSegment(seg.head);
    const tail = sanitizeSegment(seg.tail);
    if (head || tail) out.seg = { v: SEG_LOGIC_VERSION, head, tail };
  }

  return out;
}

function sanitizeSegment(x: unknown): Segment | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Loose;
  if (!isNum(s.at) || s.at < 0) return null;
  const votes = (Array.isArray(s.votes) ? (s.votes as unknown[]) : [])
    .filter(okSegVote)
    .slice(-MAX_SEG_VOTES)
    .map((v) => v.slice() as SegmentVote);
  const hasChroma = okChroma(s.cs, s.cf);
  if (!votes.length && !hasChroma) return null;
  const segment: SegmentListen = {
    at: round(s.at, 2),
    approx: s.approx === true,
    votes,
    cs: hasChroma ? (s.cs as number[]).map((v) => round(v, 3)) : new Array<number>(12).fill(0),
    cf: hasChroma ? round(s.cf, 1) : 0,
  };

  return Object.assign(segment, summarizeSegment(segment));
}
