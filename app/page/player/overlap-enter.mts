import { rampParam, RELEASE_SEC } from './common.mts';
import { headMode, headUntil, rushStart } from './head-rush.mts';
import { ovBeatAlign } from './overlap-beat.mts';
import { fadeStateFor } from './plan.mts';
import { isExcluded, type Player } from './state.mts';
import { mixEntryFor, noteHeadTrim } from './transition-advance.mts';
import { endTransition, trDiag } from './transition.mts';
import type { MixIn, TrIn } from './types.mts';

function seekToMixEntry(pl: Player, v: HTMLVideoElement, inc: TrIn, mi: MixIn, now: number): void {
  pl.ov.selfSeekUntil = now + 1;
  pl.tr.selfSeek = true;
  pl.tr.selfSeekUntil = now + 1;
  Object.assign(inc, { headTrimTo: mi.t, headReason: 'mix_' + mi.k, mix: mi, seekAt: now });
  noteHeadTrim(pl, mi.t - v.currentTime);
  trDiag(pl, 'mix_entry', { to: mi.t, k: mi.k, overlap: true });
  v.currentTime = mi.t;
  endTransition(pl, 'done', null);
}

export function ovEnter(pl: Player, v: HTMLVideoElement, vid: string, now: number): void {
  const inc: TrIn = {
    fadeIn: false,
    headTrimTo: null,
    headReason: 'overlap',
    at: now,
    wall: Date.now(),
    overlap: true,
  };
  pl.trIn[vid] = inc;
  fadeStateFor(pl, vid).fadeInDone = true;
  const fadeNode = pl.fadeNode;
  if (fadeNode && fadeNode.gain.value !== 1) rampParam(fadeNode.gain, 1, now, RELEASE_SEC);
  trDiag(pl, 'incoming_overlap', {});
  const draining = pl.ov.state === 'drain';
  const mi = draining ? mixEntryFor(pl, vid, v.currentTime) : null;

  if (mi) {
    seekToMixEntry(pl, v, inc, mi, now);

    return;
  }

  const noRush = isExcluded(pl, vid) || !draining || pl.ov.inSound || headMode(pl) === 'off';
  const h = noRush ? null : headUntil(pl, v, vid);
  let started = false;

  if (h && rushStart(pl, vid, h.pos, 'overlap')) {
    started = true;
    inc.headReason = 'overlap_rush_' + h.why;
  }

  ovBeatAlign(pl, vid, started);
  endTransition(pl, 'done', null);
}
