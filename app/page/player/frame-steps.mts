import { noteError } from './common.mts';
import { fadeWatchdog } from './fades.mts';
import { applyGainFor } from './gain.mts';
import { rushEnd } from './head-rush.mts';
import { ovWanted } from './overlap-core.mts';
import { ovRoute } from './overlap-graph.mts';
import { ovPrearm, ppPreWanted, restoreRate } from './rate.mts';
import { reorderTick } from './reorder.mts';
import { guard, noteLoad } from './session.mts';
import { trIdle, type Player } from './state.mts';
import { trTick } from './transition.mts';
import type { Frame } from './types.mts';
import { probe } from './verify.mts';

const SILENT_PEAK = 1e-4;
const JUMP_SEC = 0.35;

export function housekeeping(pl: Player, f: Frame, v: HTMLVideoElement, c: AudioContext, now: number, ad: boolean) {
  try {
    noteLoad(pl, f);
  } catch {
    /* ignore */
  }

  if (__FADEWISE_VERIFY__) probe(pl, f, v, c, now);

  try {
    trTick(pl, v, now);
    fadeWatchdog(pl, now, ad);
  } catch (e) {
    noteError(pl, e);

    try {
      pl.tr = trIdle();
      if (pl.fadeNode) pl.fadeNode.gain.value = 1;
    } catch {
      /* ignore */
    }
  }

  try {
    reorderTick(pl);
  } catch (e) {
    noteError(pl, e);
  }
}

export function silentFrameChanges(pl: Player, f: Frame, v: HTMLVideoElement, ad: boolean): void {
  const silent = !(f.p > SILENT_PEAK);
  if (pl.ovNode && pl.ovInGraph !== ovWanted(pl) && pl.ov.state === 'idle' && silent) ovRoute(pl, true);

  if (!ad && pl.ov.state === 'idle' && !pl.rush && silent) {
    if (ppPreWanted(pl)) ovPrearm(pl);
    else if (pl.ppPre) restoreRate(pl, true);
  }

  const rush = pl.rush;
  if (rush && (ad || (rush.until !== null && v.currentTime >= rush.until) || v.paused))
    rushEnd(pl, ad ? 'ad' : v.paused ? 'pause' : 'pos');
}

export function noteAdChange(pl: Player, ad: boolean): void {
  if (ad === pl.wasAd) return;
  guard(pl, ad ? 'ad_start' : 'ad_end');
  pl.wasAd = ad;
  applyGainFor(pl, ad ? 'ad_start' : 'ad_end');
}

export function frameState(v: HTMLVideoElement, vid: string | null, ad: boolean): string {
  if (ad) return 'ad';
  if (!vid) return 'no_track';
  if (v.paused) return 'paused';
  if (v.muted || v.volume < 1e-3) return 'muted';
  // at any rate but 1 a frame is not 100 ms of the song
  if (v.playbackRate !== 1) return 'ahead';

  return 'analyzing';
}

// catches seeks the element does not announce
export function checkJump(pl: Player, f: Frame, v: HTMLVideoElement, vid: string | null, ct: number, ad: boolean) {
  const last = pl.lastFrame;
  if (ad || !vid || !last || last.vid !== vid || v.paused) return;
  const expect = last.ct + (f.t - last.t) * (v.playbackRate || 1);
  if (Math.abs(ct - expect) > JUMP_SEC) guard(pl, 'jump');
}
