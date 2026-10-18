import type { Cell, TrackRecord } from '../types.mts';
import {
  LOGIC_VERSION,
  CELL_SEC,
  MIN_FRAMES_PER_CELL,
  COVERED_FRAMES_PER_CELL,
  CELL_COUNT_CAP,
  PROFILE_CELLS,
  FRAME_FLOOR_LUFS,
  floorCell,
  floorCells,
  cellsToMap,
} from './cells.mts';
import { TAIL_FRAMES, TAIL_MIN_COVERED_SEC, tailAtEnd, classifyEnding } from './ending.mts';
import { energyToLufs, lufsToEnergy, gatedLoudness } from './loudness.mts';
import type { Snapshot } from './session.mts';
import { isNum, round, obj } from './util.mts';

export function emptyRecord(videoId: string): TrackRecord {
  return {
    videoId,
    title: null,
    artist: null,
    durationSec: null,
    cells: [],
    integratedLufs: null,
    peakDb: null,
    coverage: 0,
    firstSoundSec: null,
    firstSoundExact: false,
    lastSoundSec: null,
    headProfile: [],
    tailProfile: [],
    tail: null,
    ending: null,
    ytPerceptualLoudnessDb: null,
    ytLoudnessTargetLkfs: null,
    analysisCount: 0,
    updatedAt: null,
    logicVersion: LOGIC_VERSION,
  };
}

function mergeCell(prev: Cell, frames: number, lufs: number, peak: number | null): Cell {
  const prevFrames = Math.min(prev[1], CELL_COUNT_CAP);
  const energy = (lufsToEnergy(prev[2]) * prevFrames + lufsToEnergy(lufs) * frames) / (prevFrames + frames);
  const maxPeak = Math.max(isNum(prev[3]) ? prev[3] : -Infinity, isNum(peak) ? peak : -Infinity);

  return [
    prev[0],
    Math.min(prevFrames + frames, CELL_COUNT_CAP),
    round(energyToLufs(energy), 2),
    isNum(maxPeak) ? maxPeak : null,
  ];
}

function mergeCells(stored: readonly unknown[], heard: readonly unknown[] | undefined): Cell[] {
  const byIndex = cellsToMap(floorCells(stored));

  for (const raw of heard || []) {
    const floored = floorCell(raw);
    if (!Array.isArray(floored)) continue;
    const [index, frames, lufs, peak] = floored as [unknown, unknown, unknown, number | null];
    if (!isNum(index) || !isNum(frames) || frames <= 0 || !isNum(lufs)) continue;
    const prev = byIndex.get(index);
    const merged: Cell =
      prev && isNum(prev[2])
        ? mergeCell(prev, frames, lufs, peak)
        : [index, Math.min(frames, CELL_COUNT_CAP), lufs, peak];
    byIndex.set(index, merged);
  }

  return [...byIndex.values()].sort((a, b) => a[0] - b[0]);
}

export function mergeRecord(
  base: TrackRecord | null | undefined,
  snap: Partial<Snapshot> & { videoId: string },
  nowMs?: unknown,
): TrackRecord {
  const old = base && base.logicVersion === LOGIC_VERSION ? base : emptyRecord(snap.videoId);
  const r: TrackRecord = Object.assign(emptyRecord(snap.videoId), old);
  r.cells = mergeCells(old.cells, snap.cells);
  if (isNum(snap.durationSec) && snap.durationSec > 0) r.durationSec = round(snap.durationSec, 2);
  if (snap.title) r.title = snap.title;
  if (snap.artist) r.artist = snap.artist;
  if (isNum(snap.ytPerceptualLoudnessDb)) r.ytPerceptualLoudnessDb = snap.ytPerceptualLoudnessDb;
  if (isNum(snap.ytLoudnessTargetLkfs)) r.ytLoudnessTargetLkfs = snap.ytLoudnessTargetLkfs;

  const fs = snap.firstSound;

  if (fs && isNum(fs.pos)) {
    if (fs.exact) {
      r.firstSoundSec = fs.pos;
      r.firstSoundExact = true;
    } else if (!r.firstSoundExact)
      r.firstSoundSec = isNum(r.firstSoundSec) ? Math.min(r.firstSoundSec, fs.pos) : fs.pos;
  }

  if (r.tail && !tailAtEnd(r.tail.endPos, r.durationSec)) {
    r.tail = null;
    r.lastSoundSec = null;
  }

  const endOk = !snap.tailFrames || tailAtEnd(snap.tailFrames.endPos, r.durationSec);
  if (endOk && snap.lastSound && isNum(snap.lastSound.pos)) r.lastSoundSec = snap.lastSound.pos;
  const tf = snap.tailFrames;

  if (endOk && tf && isNum(tf.endPos) && Array.isArray(tf.lufs) && tf.lufs.length * 0.1 >= TAIL_MIN_COVERED_SEC) {
    r.tail = { endPos: tf.endPos, lufs: tf.lufs.slice(-TAIL_FRAMES).map((x) => (isNum(x) ? x : FRAME_FLOOR_LUFS)) };
  }

  Object.assign(r, deriveSummary(r));
  r.ending = r.tail ? classifyEnding(r.tail, r.integratedLufs, r.lastSoundSec, r.durationSec) : null;
  if (isNum(snap.acceptedSec) && snap.acceptedSec >= 3 && !snap.continuation)
    r.analysisCount = (old.analysisCount || 0) + 1;
  r.updatedAt = isNum(nowMs) ? nowMs : Date.now();
  r.logicVersion = LOGIC_VERSION;

  return r;
}

export function deriveSummary(
  r: Pick<TrackRecord, 'cells' | 'durationSec'>,
): Pick<TrackRecord, 'integratedLufs' | 'peakDb' | 'coverage' | 'headProfile' | 'tailProfile'> {
  const cells: Cell[] = Array.isArray(r.cells) ? r.cells : [];
  const usable = cells.filter((c) => c[1] >= MIN_FRAMES_PER_CELL && isNum(c[2]));
  const integrated = gatedLoudness(usable.map((c) => lufsToEnergy(c[2])));
  const peaks = usable.map((c) => c[3]).filter(isNum);
  const total = isNum(r.durationSec) && r.durationSec > 0 ? Math.ceil(r.durationSec / CELL_SEC) : null;
  const covered = cells.filter((c) => c[1] >= COVERED_FRAMES_PER_CELL).length;
  const byIdx = cellsToMap(r.cells);

  const profile = (from: number, to: number) => {
    const out: (number | null)[] = [];

    for (let i = from; i < to; i++) {
      const c = byIdx.get(i);
      out.push(c && c[1] >= MIN_FRAMES_PER_CELL && isNum(c[2]) ? Math.max(FRAME_FLOOR_LUFS, c[2]) : null);
    }

    return out;
  };

  return {
    integratedLufs: round(integrated, 2),
    peakDb: peaks.length ? Math.max(...peaks) : null,
    coverage: total ? round(Math.min(1, covered / total), 3) : 0,
    headProfile: profile(0, PROFILE_CELLS),
    tailProfile: total ? profile(Math.max(0, total - PROFILE_CELLS), total) : [],
  };
}

// player.getVideoData() can still describe the previous track
export function pickTrackMeta(videoData: unknown, videoId: unknown): { title: string; artist: string | null } | null {
  const d = obj(videoData) || {};
  if (!videoId || d.video_id !== videoId || typeof d.title !== 'string' || !d.title.trim()) return null;

  return { title: d.title.trim(), artist: typeof d.author === 'string' && d.author.trim() ? d.author.trim() : null };
}
