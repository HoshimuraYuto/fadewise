import type { Ending, Tail } from '../types.mts';
import { SILENCE_REL_LU, energyMeanLufs } from './loudness.mts';
import { isNum, round } from './util.mts';

export const TAIL_FRAMES = 200;

const END_LOUD_LU = -8; // autocue's overlay level
const ABRUPT_DECAY_MAX_SEC = 0.5;
// measured: cuts 0.03-0.09 s, stops 0.48 s or more
const CUT_MAX_SILENCE_SEC = 0.3;
const FADING_DECAY_MIN_SEC = 3;
export const FADE_OUT_MIN_SEC = 2,
  FADE_OUT_MAX_SEC = 4;
export const TAIL_MIN_COVERED_SEC = 8;
// the first-play advance leaves 3 s unheard
const TAIL_END_MAX_GAP_SEC = 3.5;
export const tailAtEnd = (endPos: unknown, durationSec: unknown) =>
  !isNum(durationSec) || (isNum(endPos) && durationSec - endPos <= TAIL_END_MAX_GAP_SEC);

function lastFrameAbove(lufs: readonly number[], from: number, level: number): number {
  for (let i = from; i >= 0; i--) if (isNum(lufs[i]) && lufs[i] > level) return i;

  return -1;
}

export function classifyEnding(
  tail: Partial<Tail> | null | undefined,
  integratedLufs: unknown,
  lastSoundSec: unknown,
  durationSec: unknown,
): Ending {
  const out: Ending = {
    kind: 'unknown',
    fadeSec: null,
    lastSoundSec: null,
    silenceSec: null,
    decaySec: null,
    endRelLu: null,
  };
  if (!tail || !Array.isArray(tail.lufs) || !isNum(tail.endPos) || !isNum(integratedLufs)) return out;
  const frames = tail.lufs;
  const endPos = tail.endPos;
  if (frames.length * 0.1 < TAIL_MIN_COVERED_SEC) return out;
  const pos = (i: number) => endPos - (frames.length - 1 - i) * 0.1;
  const lastSound = lastFrameAbove(frames, frames.length - 1, integratedLufs + SILENCE_REL_LU);
  if (lastSound < 0) return out;
  const lastLoud = lastFrameAbove(frames, lastSound, integratedLufs + END_LOUD_LU);
  const soundEnd = pos(lastSound);
  const lastAudible = isNum(lastSoundSec) ? Math.max(lastSoundSec, soundEnd) : soundEnd;
  out.lastSoundSec = round(lastAudible, 2);
  if (isNum(durationSec)) out.silenceSec = round(Math.max(0, durationSec - lastAudible), 2);
  if (soundEnd - pos(0) < TAIL_MIN_COVERED_SEC - 0.05)
    return Object.assign(out, { lastSoundSec: null, silenceSec: null });

  if (lastLoud < 0) {
    out.kind = 'fades';
    out.decaySec = round(soundEnd - pos(0), 1);

    return out;
  }

  const decay = soundEnd - pos(lastLoud);
  out.decaySec = round(decay, 1);
  const endFrames = frames.slice(Math.max(0, lastSound - 19), lastSound + 1).filter(isNum);
  const endRel = (energyMeanLufs(endFrames) as number) - integratedLufs;
  out.endRelLu = round(endRel, 1);

  if (decay <= ABRUPT_DECAY_MAX_SEC) {
    if (!isNum(durationSec)) return out;

    if (durationSec - soundEnd > CUT_MAX_SILENCE_SEC) {
      out.kind = 'stop';

      return out;
    }

    out.kind = 'abrupt';
    out.fadeSec = round(
      Math.min(FADE_OUT_MAX_SEC, Math.max(FADE_OUT_MIN_SEC, FADE_OUT_MIN_SEC + (endRel - END_LOUD_LU) / 4)),
      1,
    );
  } else out.kind = decay >= FADING_DECAY_MIN_SEC ? 'fades' : 'decays';

  return out;
}
