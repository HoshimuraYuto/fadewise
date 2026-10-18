import { JUMP_TOLERANCE_SEC } from './head-frames.mts';
import { TR_MIN_SKIP_SEC } from './transition.mts';
import { isNum, obj } from './util.mts';

// measured: end breaks reach 1.3 s at -50; 4 s left cut live applause
export const LIVE_GAP = Object.freeze({
  silenceLufs: -50,
  silenceRelLu: -42,
  minRunSec: 1.0,
  maxRemainSec: 3,
  minSoundSec: 5,
  minDurationSec: 30,
});
export interface LiveGapState {
  run: number;
  sound: number;
  armed: boolean;
  lastCt: number | null;
}

export function liveGapState(): LiveGapState {
  return { run: 0, sound: 0, armed: false, lastCt: null };
}

export function liveGapStep(
  st: LiveGapState,
  p: unknown,
  cfg?: typeof LIVE_GAP | null,
): 'wait' | 'arm' | 'advance' | 'reset' | 'late' {
  const c = cfg || LIVE_GAP;
  const o = obj(p) || {};
  const wasArmed = st.armed;

  const reset = () => {
    st.run = 0;
    st.sound = 0;
    st.armed = false;
    st.lastCt = null;

    return wasArmed ? 'reset' : 'wait';
  };

  if (!isNum(o.ct) || !isNum(o.duration) || o.duration < c.minDurationSec || !o.contiguous) return reset();
  if (st.lastCt !== null && Math.abs(o.ct - st.lastCt - 0.1) > JUMP_TOLERANCE_SEC) return reset();
  st.lastCt = o.ct;
  const thr = isNum(o.sessionLufs) ? Math.min(c.silenceLufs, o.sessionLufs + c.silenceRelLu) : c.silenceLufs;
  const silent = !isNum(o.lufs) || o.lufs < thr;

  if (!silent) {
    st.sound += 0.1;
    st.run = 0;
    st.armed = false;

    return wasArmed ? 'reset' : 'wait';
  }

  st.run += 0.1;
  const remain = o.duration - o.ct;
  if (st.sound < c.minSoundSec || remain > c.maxRemainSec + c.minRunSec) return 'wait';

  if (remain < TR_MIN_SKIP_SEC) {
    st.armed = false;

    return wasArmed ? 'late' : 'wait';
  }

  if (st.run + 1e-9 >= c.minRunSec && remain <= c.maxRemainSec) {
    st.armed = false;

    return 'advance';
  }

  st.armed = true;

  return wasArmed ? 'wait' : 'arm';
}
