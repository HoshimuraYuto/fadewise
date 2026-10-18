import type { IndexEntry } from '../types.mts';
import { FADE_OUT_MIN_SEC, FADE_OUT_MAX_SEC } from './ending.mts';
import { alignFadeOut } from './fade-align.mts';
import type { FadeOut, Align } from './fade-align.mts';
import { MIN_COVERAGE_FOR_GAIN } from './gain.mts';
import { isNum, round } from './util.mts';

export const LONG_SILENCE_SEC = 5; // autocue's blank-skip length

const CUT_IN_MAX_FIRST_SOUND_SEC = 0.1;
export const CUT_IN_MIN_REL_LU = -3;

export const FADE_IN_SEC = 0.15;
const FADE_IN_FLOOR_DB = -6;
export const RESTORE_AFTER_SEC = 0.3;
const SKIP_MARGIN_SEC = 0.5;

export interface FadePlan {
  fadeIn: { fromDb: number; durSec: number } | null;
  fadeOut: FadeOut | null | undefined;
  skipAtPos: number | null;
  reason: 'no_analysis' | 'analysed';
  align: Align;
}

export function planFades(
  entry: IndexEntry | null | undefined,
  opts?: { fadeOutSec?: unknown; beatAlign?: unknown; skipSilence?: unknown } | null,
): FadePlan {
  const o = opts || {};
  const plan: FadePlan = {
    fadeIn: null,
    fadeOut: null,
    skipAtPos: null,
    reason: 'no_analysis',
    align: { on: false, reason: 'no_fade' },
  };
  if (!entry) return plan;
  plan.reason = 'analysed';

  // a short partial listen's loudness depends on what was heard, so the head level needs the gain's coverage
  if (
    entry.fx &&
    isNum(entry.fs) &&
    entry.fs <= CUT_IN_MAX_FIRST_SOUND_SEC &&
    isNum(entry.h0) &&
    isNum(entry.l) &&
    isNum(entry.c) &&
    entry.c >= MIN_COVERAGE_FOR_GAIN &&
    entry.h0 - entry.l >= CUT_IN_MIN_REL_LU
  ) {
    plan.fadeIn = { fromDb: FADE_IN_FLOOR_DB, durSec: FADE_IN_SEC };
  }

  const en = entry.en;
  if (en && en.kind === 'abrupt' && isNum(en.fadeSec) && isNum(en.lastSoundSec)) {
    const len = isNum(o.fadeOutSec) ? Math.min(FADE_OUT_MAX_SEC, Math.max(FADE_OUT_MIN_SEC, o.fadeOutSec)) : en.fadeSec;
    plan.fadeOut = {
      startPos: round(en.lastSoundSec - len, 2),
      endPos: en.lastSoundSec,
      restorePos: round(en.lastSoundSec + RESTORE_AFTER_SEC, 2),
    };

    if (o.beatAlign === false) plan.align = { on: false, reason: 'off' };
    else {
      let a;

      try {
        a = alignFadeOut(plan.fadeOut, entry.bt);
      } catch {
        a = { fadeOut: plan.fadeOut, align: { on: false, reason: 'error' } };
      }

      plan.fadeOut = a.fadeOut;
      plan.align = a.align;
    }
  } else plan.align = { on: false, reason: 'no_fade' };

  if (o.skipSilence && en && isNum(en.silenceSec) && en.silenceSec >= LONG_SILENCE_SEC && isNum(en.lastSoundSec)) {
    plan.skipAtPos = round(en.lastSoundSec + SKIP_MARGIN_SEC, 2);
  }

  return plan;
}

export function fadeOutEndingAt(fadeOut: FadeOut | null | undefined, at: unknown): FadeOut | null | undefined {
  if (!fadeOut || !isNum(at) || !(fadeOut.endPos > at)) return fadeOut;
  const len = fadeOut.endPos - fadeOut.startPos;

  return { startPos: round(at - len, 2), endPos: round(at, 2), restorePos: round(at + RESTORE_AFTER_SEC, 2) };
}
