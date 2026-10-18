import type { Cell, Tail } from '../types.mts';
import { LOGIC_VERSION, CELL_SEC, FRAME_FLOOR_LUFS, floorCell } from './cells.mts';
import { TAIL_FRAMES } from './ending.mts';
import { energyToLufs, ampToDb, gatedLoudness, blocksFromSubBlocks } from './loudness.mts';
import { isNum, round } from './util.mts';
import type { Loose } from './util.mts';

export const SILENCE_DBFS = -60;
const SILENCE_AMP = Math.pow(10, SILENCE_DBFS / 20);

// one 100 ms frame plus scheduling jitter
const HEAD_RUN_START_MAX_SEC = 0.3;

export interface Session {
  videoId: string;
  durationSec: number | null;
  sumE: number[];
  n: number[];
  pk: number[];
  run: number[];
  runBlocks: number[];
  lastPos: number | null;
  accepted: number;
  firstAcceptedPos: number | null;
  soundSeenInRun: boolean;
  runStartPos: number | null;
  firstSound: { pos: number | null; exact: boolean } | null;
  lastSoundPos: number | null;
  lastAcceptedPos: number | null;
  reachedEnd: boolean;
  recent: [number, number][];
}

export function createSession(videoId: string, durationSec?: unknown): Session {
  const cells = Math.max(1, Math.ceil((isNum(durationSec) ? durationSec : 0) / CELL_SEC));

  return {
    videoId,
    durationSec: isNum(durationSec) ? durationSec : null,
    sumE: new Array<number>(cells).fill(0),
    n: new Array<number>(cells).fill(0),
    pk: new Array<number>(cells).fill(0),
    run: [],
    runBlocks: [],
    lastPos: null,
    accepted: 0,
    firstAcceptedPos: null,
    soundSeenInRun: false,
    runStartPos: null,
    firstSound: null,
    lastSoundPos: null,
    lastAcceptedPos: null,
    reachedEnd: false,
    recent: [],
  };
}

export function addFrame(s: Session, pos: unknown, e: unknown, peak: unknown, contiguousHint?: unknown): boolean {
  if (!isNum(pos) || !isNum(e) || !isNum(peak) || pos < 0) return false;
  // a loop or seek back the caller did not split off
  if (s.reachedEnd && s.lastAcceptedPos !== null && pos < s.lastAcceptedPos - 1) s.reachedEnd = false;
  const idx = Math.floor(pos / CELL_SEC);

  if (idx >= s.n.length) {
    const grow = idx + 1 - s.n.length;
    s.sumE.push(...new Array<number>(grow).fill(0));
    s.n.push(...new Array<number>(grow).fill(0));
    s.pk.push(...new Array<number>(grow).fill(0));
  }

  const contiguous =
    typeof contiguousHint === 'boolean'
      ? contiguousHint && s.lastPos !== null
      : s.lastPos !== null && Math.abs(pos - s.lastPos - 0.1) < 0.15;

  if (!contiguous) {
    s.runBlocks.push(...blocksFromSubBlocks(s.run));
    s.run = [];
    s.runStartPos = pos;
    s.soundSeenInRun = false;
    s.recent = [];
  }

  s.run.push(e);
  s.recent.push([pos, e]);
  if (s.recent.length > TAIL_FRAMES) s.recent.shift();
  s.sumE[idx] += e;
  s.n[idx] += 1;
  if (peak > s.pk[idx]) s.pk[idx] = peak;
  s.accepted += 1;
  if (s.firstAcceptedPos === null || pos < s.firstAcceptedPos) s.firstAcceptedPos = pos;

  if (peak > SILENCE_AMP) {
    if (!s.soundSeenInRun && s.firstSound === null) {
      const exact = s.runStartPos !== null && (pos - s.runStartPos > 0.05 || s.runStartPos <= HEAD_RUN_START_MAX_SEC);
      s.firstSound = { pos: round(Math.max(0, pos - 0.1), 2), exact };
    }

    s.soundSeenInRun = true;
    s.lastSoundPos = pos;
  }

  s.lastPos = pos;
  s.lastAcceptedPos = pos;

  return true;
}

export function markEnded(s: Session, durationSec: unknown): void {
  if (isNum(durationSec) && s.lastAcceptedPos !== null && durationSec - s.lastAcceptedPos < 0.6) s.reachedEnd = true;
}

export function sessionIntegratedLufs(s: Session): number | null {
  return gatedLoudness(s.runBlocks.concat(blocksFromSubBlocks(s.run)));
}

function tailFramesOf(recent: [number, number][]): Tail {
  return {
    endPos: round(recent[recent.length - 1][0], 2),
    lufs: recent.map((r) => {
      const lu = energyToLufs(r[1]);

      return Math.max(FRAME_FLOOR_LUFS, isNum(lu) ? round(lu, 1) : FRAME_FLOOR_LUFS);
    }),
  };
}

export interface Snapshot {
  videoId: string;
  durationSec: number | null;
  cells: Cell[];
  acceptedSec: number | null;
  firstSound: { pos: number | null; exact: boolean } | null;
  lastSound: { pos: number | null; exact: boolean } | null;
  tailFrames: Tail | null;
  sessionLufs: number | null;
  logicVersion: number;
  title?: string | null;
  artist?: string | null;
  ytPerceptualLoudnessDb?: number | null;
  ytLoudnessTargetLkfs?: number | null;
  continuation?: boolean;
  [key: string]: unknown;
}

export function sessionSnapshot(s: Session, meta?: Loose | null): Snapshot {
  const cells: Cell[] = [];

  for (let i = 0; i < s.n.length; i++) {
    if (s.n[i] > 0)
      cells.push(
        floorCell([i, s.n[i], round(energyToLufs(s.sumE[i] / s.n[i]), 2), round(ampToDb(s.pk[i]), 1)]) as Cell,
      );
  }

  return Object.assign(
    {
      videoId: s.videoId,
      durationSec: s.durationSec,
      cells,
      acceptedSec: round(s.accepted * 0.1, 1),
      firstSound: s.firstSound,
      lastSound: s.reachedEnd && s.lastSoundPos !== null ? { pos: round(s.lastSoundPos, 2), exact: true } : null,
      tailFrames: s.reachedEnd && s.recent.length ? tailFramesOf(s.recent) : null,
      sessionLufs: round(sessionIntegratedLufs(s), 2),
      logicVersion: LOGIC_VERSION,
    },
    meta || {},
  );
}
