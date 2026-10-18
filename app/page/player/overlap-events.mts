import { noteError, round } from './common.mts';
import { unityNow } from './gain.mts';
import { rushEnd } from './head-rush.mts';
import { ovDiag, ovHandGain, ovParam, overlapNote } from './overlap-core.mts';
import { ovRoute } from './overlap-graph.mts';
import { ovPrearm, ppPreWanted, ppRelease, restoreRate } from './rate.mts';
import { ovIdle, type Player } from './state.mts';
import { isAdNow } from './youtube.mts';

export function ovBoundary(pl: Player, type: string): void {
  const { ov, tr } = pl;
  if (ov.state !== 'capture') return;

  if (isAdNow(pl)) {
    ovCancel(pl, 'ad');

    return;
  }

  const own = tr.state === 'advancing' || tr.state === 'incoming';
  const { lastDur, lastCt } = ov;
  const known = typeof lastDur === 'number' && typeof lastCt === 'number';
  const left = known && Number.isFinite(lastDur) && Number.isFinite(lastCt) ? lastDur - lastCt : 0;

  if (!own && left > 1) {
    ovCancel(pl, 'user_skip');

    return;
  }

  pl.ovNode?.port.postMessage({ cmd: 'end', tailKeep: 0.3 });
  ov.state = 'drain';
  ov.since = pl.ctx ? pl.ctx.currentTime : 0;
  // noted before the remainder plays: a later drop shows only in the status and the diag
  if (ov.vid) overlapNote(pl, ov.vid, { state: 'done' });
  // the player sets the rate back to 1 itself but leaves preservesPitch=false
  restoreRate(pl);
  ovDiag(pl, 'end', { on: type });
}

function unheardSec(pl: Player, reason: string, now: number): number {
  const { ov, video } = pl;
  if (ov.state !== 'capture' || !video || !ov.cap) return 0;
  // after a seek the element is already at the target: the last frame's position is where it was
  const fromLastFrame =
    (reason === 'seek' || reason === 'user_skip') && ov.lastCt !== undefined && Number.isFinite(ov.lastCt);
  const elementPos = fromLastFrame ? (ov.lastCt as number) : video.currentTime;

  return Math.max(0, elementPos - pl.A.heardPos(ov.cap, now));
}

function releaseOverlapGains(pl: Player, was: string, reason: string, now: number): void {
  if (was === 'drain') {
    // the ad plays through the gain stage
    if (reason === 'ad') pl.ov.pendingDb = null;
    ovHandGain(pl, 0.005);
    if (reason === 'ad') unityNow(pl);

    return;
  }

  // hold the fade-out level while the worklet fades the old track away
  const g = ovParam(pl, 'gOld');
  if (!g) return;

  try {
    const value = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(value, now);
    g.setValueAtTime(1, now + 0.05);
  } catch {
    /* ignore */
  }
}

function noteCancel(pl: Player, vid: string | null, was: string, reason: string, lost: number): void {
  const fade = pl.fade;
  if (vid) overlapNote(pl, vid, { state: 'cancelled', cancel: reason, lostSec: round(lost, 2) });

  if (fade && fade.vid === vid && pl.ov.fadeOut) {
    fade.outResult = 'cancelled';
    fade.outCancel = reason;
  }

  if (fade && fade.vid === vid && was === 'capture' && (reason === 'rate' || reason === 'error' || reason === 'ad'))
    fade.ovDone = true;
  ovDiag(pl, 'cancel', { reason, was, lostSec: round(lost, 3) });
  pl.status.overlapCancel = { at: Date.now(), reason, was, lostSec: round(lost, 2) };
}

function rewindUnheard(pl: Player, lost: number, now: number): void {
  const v = pl.video;
  if (!v) return;
  pl.ov.selfSeekUntil = now + 1;

  try {
    v.currentTime = Math.max(0, v.currentTime - lost);
  } catch (e) {
    noteError(pl, e);
  }

  ovDiag(pl, 'rewind', { lostSec: round(lost, 3) });
}

export function ovCancel(pl: Player, reason: string): void {
  if (pl.rush) rushEnd(pl, reason);

  if (pl.ov.state === 'idle') {
    if (reason !== 'ad') restoreRate(pl);

    return;
  }

  const { state: was, vid, cap } = pl.ov;
  const now = pl.ctx ? pl.ctx.currentTime : 0;
  const lost = unheardSec(pl, reason, now);

  try {
    pl.ovNode?.port.postMessage({ cmd: 'flush', why: reason, fade: was === 'drain' || reason === 'ad' ? 0.005 : 0.02 });
  } catch {
    /* ignore */
  }

  releaseOverlapGains(pl, was, reason, now);
  noteCancel(pl, vid, was, reason, lost);
  pl.ov = ovIdle();
  if (reason !== 'ad') restoreRate(pl);
  if (reason === 'pause' && was === 'capture' && pl.video && lost > 0.02 && cap) rewindUnheard(pl, lost, now);
}

function rushMedia(pl: Player, type: string): void {
  if (type === 'emptied' || type === 'loadstart') rushEnd(pl, 'source');
  else if (type === 'pause') rushEnd(pl, 'pause');
  else if (type === 'seeking') rushEnd(pl, 'seek');
  else if (type === 'ratechange' && !pl.selfRate) rushEnd(pl, 'rate', true);
}

function sourceChange(pl: Player, type: string): void {
  const { ov, ctx } = pl;
  // YTM can repeat emptied / loadstart, so only after the next track has sounded
  if (ov.state === 'drain' && ov.newSoundAt && ctx && ctx.currentTime - ov.newSoundAt > 0.3) ovCancel(pl, 'user_skip');
  ovBoundary(pl, type);
  if (pl.ov.state === 'idle') ovRoute(pl, true);
  if (pl.ov.state === 'idle' || pl.ov.state === 'drain') ovPrearm(pl);
}

function idleMedia(pl: Player, type: string): void {
  if (type !== 'pause') return;
  ovRoute(pl, true);
  if (ppPreWanted(pl)) ovPrearm(pl);
  else restoreRate(pl, true);
}

function runningMedia(pl: Player, v: HTMLVideoElement, type: string): void {
  const { ov, tr } = pl;
  const now = pl.ctx ? pl.ctx.currentTime : 0;

  if (type === 'pause') {
    // the element pauses by itself at the file end and on our own "next"
    const atFileEnd = Number.isFinite(v.duration) && v.duration - v.currentTime < 0.3;
    if (ov.state === 'capture' && (atFileEnd || tr.state === 'advancing')) return;
    ovCancel(pl, 'pause');
  } else if (type === 'seeking') {
    if (now <= ov.selfSeekUntil) return;
    if (ov.state === 'capture' || v.currentTime > 0.5) ovCancel(pl, 'seek');
  } else if (type === 'ratechange' && !pl.selfRate && ov.state === 'capture') ovCancel(pl, 'rate');
}

export function ovMedia(pl: Player, v: HTMLVideoElement, type: string): void {
  if (pl.rush) rushMedia(pl, type);
  if (type === 'ratechange' && !pl.selfRate && pl.ppPre && v.playbackRate !== 1) ppRelease(pl);
  if (type === 'emptied' || type === 'loadstart') sourceChange(pl, type);
  else if (pl.ov.state === 'idle') idleMedia(pl, type);
  else runningMedia(pl, v, type);
}
