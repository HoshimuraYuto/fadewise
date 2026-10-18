import type { Cell, MixRecord, MixRow, Tail, TrackRecord } from '../types.mts';
import { LOGIC_VERSION, CELL_COUNT_CAP, FRAME_FLOOR_LUFS, floorCells } from './cells.mts';
import { TAIL_FRAMES, TAIL_MIN_COVERED_SEC, tailAtEnd, classifyEnding } from './ending.mts';
import { DURATION_MISMATCH_SEC } from './head-frames.mts';
import { emptyRecord, deriveSummary } from './record.mts';
import { isNum, round, obj } from './util.mts';

export const IMPORT_LIMITS = Object.freeze({
  maxCells: 4000,
  maxSec: 6 * 3600,
  minLevel: FRAME_FLOOR_LUFS,
  maxLevel: 20,
});
const VIDEO_ID_RE = /^[\w-]{6,20}$/;

const inRange = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi;

const isIntIn = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

const importLevel = (v: unknown) =>
  inRange(v, -1000, IMPORT_LIMITS.maxLevel) ? Math.max(IMPORT_LIMITS.minLevel, v) : null;

function importedCells(raw: unknown): Cell[] {
  const cells: Cell[] = [];
  const seen = new Set<number>();

  for (const row of Array.isArray(raw) ? (raw as unknown[]).slice(0, IMPORT_LIMITS.maxCells) : []) {
    if (!Array.isArray(row)) continue;
    const [index, frames, lufs, peak] = row as unknown[];
    if (!isIntIn(index, 0, IMPORT_LIMITS.maxSec) || seen.has(index)) continue;
    if (!isIntIn(frames, 1, CELL_COUNT_CAP)) continue;
    const level = importLevel(lufs);
    if (level === null) continue;
    seen.add(index);
    cells.push([index, frames, round(level, 2), peak === null || peak === undefined ? null : importLevel(peak)]);
  }

  return cells.sort((a, b) => a[0] - b[0]);
}

function importedTail(raw: unknown, maxPos: number): Tail | null {
  const tail = obj(raw);
  const lufs: unknown = tail && tail.lufs;
  if (!tail || !inRange(tail.endPos, 0, maxPos) || !Array.isArray(lufs)) return null;
  const frames = lufs as unknown[];
  if (frames.length > TAIL_FRAMES || frames.length * 0.1 < TAIL_MIN_COVERED_SEC) return null;
  if (!frames.every((v) => importLevel(v) !== null)) return null;

  return { endPos: round(tail.endPos, 2), lufs: frames.map(importLevel) as number[] };
}

export function sanitizeImportTrack(x: unknown): TrackRecord | null {
  const input = obj(x);
  if (!input || typeof input.videoId !== 'string' || !VIDEO_ID_RE.test(input.videoId)) return null;
  if (input.logicVersion !== LOGIC_VERSION) return null;
  const r = emptyRecord(input.videoId);
  if (inRange(input.durationSec, 1, IMPORT_LIMITS.maxSec)) r.durationSec = round(input.durationSec, 2);
  r.cells = importedCells(input.cells);
  const maxPos = isNum(r.durationSec) ? r.durationSec : IMPORT_LIMITS.maxSec;

  if (inRange(input.firstSoundSec, 0, maxPos)) {
    r.firstSoundSec = round(input.firstSoundSec, 2);
    r.firstSoundExact = input.firstSoundExact === true;
  }

  if (inRange(input.lastSoundSec, 0, maxPos)) r.lastSoundSec = round(input.lastSoundSec, 2);
  const tail = importedTail(input.tail, maxPos);
  if (tail) r.tail = tail;
  if (inRange(input.ytPerceptualLoudnessDb, -60, 40)) r.ytPerceptualLoudnessDb = input.ytPerceptualLoudnessDb;
  if (inRange(input.ytLoudnessTargetLkfs, -60, 0)) r.ytLoudnessTargetLkfs = input.ytLoudnessTargetLkfs;
  if (isIntIn(input.analysisCount, 0, 1e6)) r.analysisCount = input.analysisCount;
  if (inRange(input.updatedAt, 0, 1e14)) r.updatedAt = Math.round(input.updatedAt);
  if (!r.cells.length && !r.tail) return null;
  const mix = sanitizeImportMix(input.mix, maxPos);
  if (mix) r.mix = mix;
  Object.assign(r, deriveSummary(r));
  r.ending =
    r.tail && tailAtEnd(r.tail.endPos, r.durationSec)
      ? classifyEnding(r.tail, r.integratedLufs, r.lastSoundSec, r.durationSec)
      : null;

  return r;
}

export function sanitizeImportMix(x: unknown, maxPos: number): MixRecord | null {
  const m = obj(x);
  if (!m || m.v !== 1 || !Array.isArray(m.x) || !Array.isArray(m.n) || !Array.isArray(m.h)) return null;
  const inR = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi;
  const opt = (v: unknown, lo: number, hi: number, d: number) => (inR(v, lo, hi) ? round(v, d) : null);

  const rows = (a: unknown[], kinds: number[]) => {
    const out: MixRow[] = [];

    for (const y of a.slice(0, 8)) {
      if (!Array.isArray(y)) continue;
      const r = y as unknown[];
      if (!inR(r[0], 0, maxPos) || !kinds.includes(r[1] as number)) continue;
      const row: MixRow = [round(r[0], 2), r[1] as number, opt(r[2], 0, 1, 2) ?? 0, opt(r[3], -60, 20, 1)];
      if (r.length > 4)
        row.push(opt(r[4], 20, 400, 1), typeof r[5] === 'string' && /^(?:[1-9]|1[0-2])[AB]$/.test(r[5]) ? r[5] : null);
      if (!out.some((o) => Math.abs(o[0] - row[0]) < 0.5)) out.push(row);
    }

    return out.sort((p, q) => p[0] - q[0]);
  };

  const xs = rows(m.x as unknown[], [3, 4, 5]),
    ns = rows(m.n as unknown[], [0, 1, 2]);
  if (!xs.length && !ns.length) return null;
  const g0: unknown = m.g;
  const g: MixRecord['g'] = Array.isArray(g0)
    ? [opt(g0[0], 20, 400, 2), opt(g0[1], 0, 10, 3), opt(g0[2], 0, 1, 2)]
    : [null, null, null];
  const h0 = m.h as unknown[];
  const h: MixRecord['h'] = [
    h0[0] ? 1 : 0,
    h0[1] ? 1 : 0,
    Number.isInteger(h0[2]) ? Math.min(99, Math.max(0, h0[2] as number)) : 0,
  ];

  return { v: 1, g, x: xs, n: ns, h };
}

function addImportedCells(r: TrackRecord, imp: TrackRecord): boolean {
  const curCells: Cell[] = Array.isArray(r.cells) ? r.cells : [];
  const have = new Set(curCells.map((c) => c[0]));
  const add = (Array.isArray(imp.cells) ? imp.cells : []).filter((c) => !have.has(c[0]));
  if (!add.length) return false;
  r.cells = floorCells(curCells)
    .concat(add)
    .sort((a, b) => a[0] - b[0]);

  return true;
}

function fillFromImport(r: TrackRecord, imp: TrackRecord, tempoKey: TrackRecord['tempoKey']): boolean {
  let changed = addImportedCells(r, imp);

  if (!isNum(r.durationSec) && isNum(imp.durationSec)) {
    r.durationSec = imp.durationSec;
    changed = true;
  }

  if (!isNum(r.firstSoundSec) && isNum(imp.firstSoundSec)) {
    r.firstSoundSec = imp.firstSoundSec;
    r.firstSoundExact = imp.firstSoundExact;
    changed = true;
  }

  const durationsClose =
    !isNum(r.durationSec) ||
    !isNum(imp.durationSec) ||
    Math.abs(r.durationSec - imp.durationSec) <= DURATION_MISMATCH_SEC;

  if (!r.tail && imp.tail && durationsClose) {
    r.tail = imp.tail;
    r.lastSoundSec = imp.lastSoundSec;
    changed = true;
  }

  if (!isNum(r.ytPerceptualLoudnessDb) && isNum(imp.ytPerceptualLoudnessDb)) {
    r.ytPerceptualLoudnessDb = imp.ytPerceptualLoudnessDb;
    changed = true;
  }

  if (!r.tempoKey && tempoKey) {
    r.tempoKey = tempoKey;
    changed = true;
  }

  if (!r.mix && imp.mix && durationsClose) {
    r.mix = imp.mix;
    changed = true;
  }

  return changed;
}

export function mergeImportedRecord(
  cur: TrackRecord | null | undefined,
  imp: TrackRecord | null | undefined,
  tempoKey: TrackRecord['tempoKey'],
  nowMs?: number,
): { rec: TrackRecord | null; changed: boolean } {
  if (!imp) return { rec: cur || null, changed: false };

  if (!cur || cur.logicVersion !== LOGIC_VERSION) {
    const rec = Object.assign({}, imp, {
      tempoKey: tempoKey || null,
      applied: [],
      updatedAt: imp.updatedAt || nowMs,
    });

    return { rec, changed: true };
  }

  const r = Object.assign({}, cur);
  if (!fillFromImport(r, imp, tempoKey)) return { rec: cur, changed: false };
  Object.assign(r, deriveSummary(r));
  r.ending =
    r.tail && tailAtEnd(r.tail.endPos, r.durationSec)
      ? classifyEnding(r.tail, r.integratedLufs, r.lastSoundSec, r.durationSec)
      : null;
  r.updatedAt = isNum(nowMs) ? nowMs : Date.now();

  return { rec: r, changed: true };
}
