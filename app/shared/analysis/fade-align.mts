import type { BeatInfo } from '../types.mts';
import { isNum, round } from './util.mts';

export const ALIGN_MIN_CONFIDENCE = 0.5;
const ALIGN_BPM_MIN = 60,
  ALIGN_BPM_MAX = 200;
export const ALIGN_TEMPO_TOL = 0.04;
export const ALIGN_MAX_RMS_MS = 30;
const ALIGN_MAX_EXTRAPOLATE_SEC = 2;
export const ALIGN_FADE_MIN_SEC = 1.5;
export const ALIGN_FADE_MAX_SEC = 4.5;
export const ALIGN_END_SNAP_MAX_SEC = 0.25;
const ALIGN_END_TOL_SEC = 0.03;
const BEATS_PER_BAR = 4;

export interface FadeOut {
  startPos: number;
  endPos: number;
  restorePos: number;
}
export interface Align {
  on: boolean;
  reason: string;
  mode?: 'bar' | 'beat';
  beats?: number | null;
  endOnBeat?: boolean;
  bpm?: number;
  conf?: number;
  endBpm?: number;
  rmsMs?: number;
  periodSec?: number;
  anchorSec?: number;
  shiftStartSec?: number;
  shiftEndSec?: number;
  globalPhaseDiffMs?: number;
}

export function alignFadeOut(
  fadeOut: FadeOut | null | undefined,
  bt: Partial<BeatInfo> | null | undefined,
): { fadeOut: FadeOut | null | undefined; align: Align } {
  const off = (reason: string, extra?: Partial<Align>) => ({
    fadeOut,
    align: Object.assign({ on: false, reason }, extra || {}),
  });
  if (!fadeOut || !isNum(fadeOut.startPos) || !isNum(fadeOut.endPos)) return off('no_fade');
  if (!bt || !isNum(bt.bpm)) return off('no_tempo');
  const info: Partial<Align> = { bpm: bt.bpm, conf: bt.conf };
  if (!((bt.conf ?? NaN) >= ALIGN_MIN_CONFIDENCE)) return off('low_confidence', info);
  if (bt.alt && bt.alt.length) return off('octave', info);
  if (!isNum(bt.ph)) return off('no_phase', info);
  if (bt.bpm < ALIGN_BPM_MIN || bt.bpm > ALIGN_BPM_MAX) return off('out_of_range', info);
  const lastSound = fadeOut.endPos;
  const found = endGridOf(bt.grids || [], bt.bpm, lastSound, info);
  if (!found.grid) return off(found.sawEnd ? (isNum(info.endBpm) ? 'tempo_change' : 'unstable') : 'no_grid', info);
  const grid = found.grid;
  const period = grid.period;
  const endBeatIndex = Math.floor((lastSound + ALIGN_END_TOL_SEC - grid.anchor) / period);
  const endBeat = grid.anchor + endBeatIndex * period;
  const endOnBeat = lastSound - endBeat <= ALIGN_END_SNAP_MAX_SEC;
  const end = endOnBeat ? Math.min(endBeat, lastSound) : lastSound;
  const start = alignedFadeStart(grid, endBeatIndex, endOnBeat, end, lastSound - fadeOut.startPos);
  if (!start) return off('no_beat_in_range', info);
  const globalPeriod = 60 / bt.bpm;
  let phaseDiff = (((grid.anchor - bt.ph) % globalPeriod) + globalPeriod) % globalPeriod;
  if (phaseDiff > globalPeriod / 2) phaseDiff -= globalPeriod;
  const align: Align = {
    on: true,
    reason: 'aligned',
    mode: start.onBar ? 'bar' : 'beat',
    beats: start.beats,
    endOnBeat,
    bpm: bt.bpm,
    conf: bt.conf,
    periodSec: round(period, 5),
    anchorSec: round(grid.anchor, 3),
    rmsMs: grid.rms,
    shiftStartSec: round(start.pos - fadeOut.startPos, 3),
    shiftEndSec: round(end - lastSound, 3),
    globalPhaseDiffMs: round(phaseDiff * 1000, 0),
  };

  return {
    fadeOut: { startPos: round(start.pos, 3), endPos: round(end, 3), restorePos: fadeOut.restorePos },
    align,
  };
}

interface EndGrid {
  anchor: number;
  period: number;
  rms: number;
}

function endGridOf(
  grids: readonly number[][],
  trackBpm: number,
  lastSound: number,
  info: Partial<Align>,
): { grid: EndGrid | null; sawEnd: boolean } {
  let sawEnd = false;

  for (let i = grids.length - 1; i >= 0; i--) {
    const [bpm, sec, anchor, period, rms, endSec] = grids[i];
    if (!(endSec >= lastSound - ALIGN_MAX_EXTRAPOLATE_SEC && endSec - sec <= lastSound - ALIGN_FADE_MAX_SEC)) continue;
    sawEnd = true;
    const tempoOff = (x: number) => Math.abs(x / trackBpm - 1) > ALIGN_TEMPO_TOL;

    if (tempoOff(bpm) || tempoOff(60 / period)) {
      info.endBpm = round(60 / period, 1);
      continue;
    }

    if (rms > ALIGN_MAX_RMS_MS) {
      info.rmsMs = rms;
      continue;
    }

    return { grid: { anchor, period, rms }, sawEnd };
  }

  return { grid: null, sawEnd };
}

function alignedFadeStart(
  grid: EndGrid,
  endBeatIndex: number,
  endOnBeat: boolean,
  end: number,
  wantedSec: number,
): { pos: number; beats: number | null; onBar: boolean } | null {
  const cands: { pos: number; len: number; beats: number | null }[] = [];

  for (let n = 1; n * grid.period <= ALIGN_FADE_MAX_SEC + grid.period; n++) {
    const pos = grid.anchor + (endBeatIndex - n + (endOnBeat ? 0 : 1)) * grid.period;
    const len = end - pos;
    if (len >= ALIGN_FADE_MIN_SEC && len <= ALIGN_FADE_MAX_SEC) cands.push({ pos, len, beats: endOnBeat ? n : null });
  }

  if (!cands.length) return null;

  const nearest = (list: typeof cands) =>
    list.reduce((a, b) => (Math.abs(b.len - wantedSec) < Math.abs(a.len - wantedSec) ? b : a));

  const bars = cands.filter((c) => c.beats !== null && c.beats % BEATS_PER_BAR === 0);
  const pick = bars.length ? nearest(bars) : nearest(cands);

  return { pos: pick.pos, beats: pick.beats, onBar: bars.length > 0 };
}
