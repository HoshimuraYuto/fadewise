import { isNum, obj } from './util.mts';

const HEAD_START_MAX_CT = 0.5;
export const JUMP_TOLERANCE_SEC = 0.35;
export const DURATION_MISMATCH_SEC = 1.5;

export function headFrameDecision(p: unknown): 'accept' | 'wait' | 'reject' {
  const o = obj(p) || {};
  if (o.killed || o.ad || o.adRecent) return 'reject';
  const prevCt = o.prevCt;
  const started = prevCt !== null && prevCt !== undefined;
  const durOk =
    isNum(o.videoDuration) &&
    isNum(o.playerDuration) &&
    o.playerDuration > 0 &&
    Math.abs(o.videoDuration - o.playerDuration) <= DURATION_MISMATCH_SEC;
  // before the first accepted frame the element may still hold the previous source
  if (!durOk) return started ? 'reject' : 'wait';
  if (o.paused || !isNum(o.ct)) return 'wait';
  if (!started) return o.ct <= HEAD_START_MAX_CT ? 'accept' : 'wait';
  const prev = prevCt as number;
  if (o.ct <= prev + 0.01) return 'wait';
  const expect = prev + (isNum(o.dt) ? o.dt : 0.1) * (isNum(o.rate) && o.rate > 0 ? o.rate : 1);

  return Math.abs(o.ct - expect) <= JUMP_TOLERANCE_SEC ? 'accept' : 'reject';
}
