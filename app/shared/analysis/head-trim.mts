import type { IndexEntry } from '../types.mts';
import { CELL_SEC } from './cells.mts';
import { DURATION_MISMATCH_SEC } from './head-frames.mts';
import { ABS_GATE_LUFS, SILENCE_REL_LU } from './loudness.mts';
import { isNum, round } from './util.mts';

export const HEAD_TRIM_MIN_SEC = 0.25;
export const HEAD_TRIM_MAX_SEC = 2;
const HEAD_TRIM_BEFORE_SEC = 0.05;
export const HEAD_TRIM_LONG_MAX_SEC = 6;
const HEAD_TRIM_LONG_BEFORE_SEC = 0.25;
export const HEAD_QUIET_LUFS = ABS_GATE_LUFS;

export function quietHeadSec(
  headProfile: readonly (number | null)[] | null | undefined,
  integratedLufs: unknown,
): number {
  if (!isNum(integratedLufs)) return 0;
  const quiet = Math.min(HEAD_QUIET_LUFS, integratedLufs + SILENCE_REL_LU);
  let n = 0;

  for (const x of headProfile || []) {
    if (!isNum(x) || x > quiet) break;
    n++;
  }

  return n * CELL_SEC;
}

export function planHeadTrim(
  entry: IndexEntry | null | undefined,
  videoDurationSec: unknown,
): { seekTo: number | null; why: string } {
  const no = (why: string) => ({ seekTo: null, why });
  if (!entry) return no('no_analysis');
  if (!entry.fx || !isNum(entry.fs)) return no('not_exact');
  if (entry.fs < HEAD_TRIM_MIN_SEC) return no('short');
  const long = entry.fs > HEAD_TRIM_MAX_SEC;
  if (long && (entry.fs > HEAD_TRIM_LONG_MAX_SEC || !((entry.hq ?? 0) >= Math.floor(entry.fs)))) return no('long');
  if (!isNum(entry.d) || !isNum(videoDurationSec) || Math.abs(entry.d - videoDurationSec) > DURATION_MISMATCH_SEC)
    return no('duration');
  if (long) return { seekTo: round(entry.fs - HEAD_TRIM_LONG_BEFORE_SEC, 2), why: 'exact_quiet' };

  return { seekTo: round(entry.fs - HEAD_TRIM_BEFORE_SEC, 2), why: 'exact' };
}

// a wrong gapless guess only does less, so this loose bound is safe
export const GAPLESS_FIRST_SOUND_MAX_SEC = HEAD_TRIM_MIN_SEC;

export function gaplessPair(
  prev: IndexEntry | null | undefined,
  next: IndexEntry | null | undefined,
  q?: { album?: unknown; albumNext?: unknown } | null,
): { on: boolean; why: string } {
  const o = q || {};
  if (!o.album) return { on: false, why: 'not_album' };
  if (o.albumNext !== true) return { on: false, why: 'not_album_next' };
  const en = prev && prev.en;
  if (!en || en.kind !== 'abrupt') return { on: false, why: 'ending' };
  if (!next || !next.fx || !isNum(next.fs) || next.fs > GAPLESS_FIRST_SOUND_MAX_SEC) return { on: false, why: 'head' };

  return { on: true, why: 'gapless' };
}
