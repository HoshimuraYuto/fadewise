import { ctxTime, post, pushOvLog, round, videoTime } from './common.mts';
import { fadeInCurve, releaseFade } from './fades.mts';
import { liveEligible, liveTick } from './live-gap.mts';
import { advance, enterIncoming } from './transition-advance.mts';
import { trIdle, type Player } from './state.mts';
import type { FadeState, TPlan, TrOut, TrState } from './types.mts';
import { openWash, closeWash, WASH_LEAD_SEC } from './wash.mts';
import { isAdNow, playerVideoId, sameStoredTrack } from './youtube.mts';

const TR_TIMEOUT: Partial<Record<TrState, number>> = { advancing: 6, incoming: 8, trimming: 3 };
const TR_BACK_SEC = 1;
const TR_HOLD_REASONS = new Set(['track_change', 'emptied', 'loadstart', 'jump', 'ended', 'pause']);

export function trNote(pl: Player, vid: string | null, patch: TrOut): void {
  if (vid) pl.trOut[vid] = Object.assign(pl.trOut[vid] || {}, patch);
}

export function trDiag(pl: Player, kind: string, extra?: Record<string, unknown>): void {
  if (!__FADEWISE_VERIFY__) return;
  const { tr, fadeNode } = pl;
  const vid = playerVideoId(pl);
  pushOvLog(pl, ['tr_' + kind, ctxTime(pl, 4), videoTime(pl, 3), tr.state, vid]);
  const base = {
    kind: 'tr_' + kind,
    state: tr.state,
    from: tr.fromVid,
    vid,
    ct: videoTime(pl, 3),
    at: ctxTime(pl, 3),
    fg: fadeNode ? round(fadeNode.gain.value, 4) : null,
  };
  post(pl, 'diag', Object.assign(base, extra || {}));
}

export function trHolds(pl: Player, reason: string): boolean {
  const { tr, ctx } = pl;
  const ownSeek = reason === 'seeking' && tr.selfSeek;
  if (tr.state === 'advancing' || tr.state === 'incoming') return TR_HOLD_REASONS.has(reason) || ownSeek;
  if (tr.state !== 'trimming' && tr.state !== 'fadingIn') return false;
  const ownJump = reason === 'jump' && !!ctx && ctx.currentTime <= tr.selfSeekUntil;

  return ownSeek || ownJump || reason === 'track_change';
}

// 'cancelled' leaves the gain to releaseFade, which every cancel path calls next
export function endTransition(pl: Player, result: string, reason: string | null): void {
  const { tr } = pl;
  if (tr.state === 'idle') return;
  const was = tr.state;

  if (result === 'cancelled' && was === 'armed') trNote(pl, tr.fromVid, { state: 'cancelled', cancel: reason });
  else if (result === 'cancelled') {
    const vid = playerVideoId(pl);
    const inc = vid ? pl.trIn[vid] : undefined;
    if (inc) inc.cancel = reason;
    if (tr.fromVid) trNote(pl, tr.fromVid, { cancelAfter: reason });
  }

  trDiag(pl, 'end', { result, reason, was });
  // after a completed advance the reverb tail rings out by itself
  closeWash(pl, result === 'cancelled');
  pl.tr = trIdle();
}

export function cancelTransition(pl: Player, reason: string): void {
  if (pl.tr.state === 'idle') return;
  endTransition(pl, 'cancelled', reason);
  releaseFade(pl, reason);
}

export function trPlanned(pl: Player, now: number): boolean {
  const { tr } = pl;
  const limit = TR_TIMEOUT[tr.state];
  if (limit !== undefined) return now - tr.since <= limit + 0.2;
  if (tr.state === 'fadingIn') return now <= tr.fadeInEnd + 0.2;

  return false;
}

export function armTransition(pl: Player, vid: string, kind: string | null, now: number, live?: boolean): void {
  pl.tr = Object.assign(trIdle(), { state: 'armed' as const, fromVid: vid, kind, since: now }, live ? { live } : {});
}

function stepArmed(
  pl: Player,
  v: HTMLVideoElement,
  f: FadeState,
  tp: TPlan,
  ct: number,
  now: number,
  prev: number | null,
) {
  const vid = f.vid;
  const step = pl.A.transitionStep({
    plan: tp,
    ct,
    prevCt: prev,
    duration: v.duration,
    ad: false,
    paused: v.paused,
    sameTrack: sameStoredTrack(pl, vid),
    enabled: !!pl.settings.transitions && !!pl.fadeNode,
  });
  const state = pl.tr.state;

  if (step === 'arm' && state === 'idle') {
    armTransition(pl, vid, tp.kind, now);
    trNote(pl, vid, {
      kind: tp.kind,
      reason: tp.reason,
      state: 'armed',
      atSec: null,
      skipSec: tp.skipSec,
      planSec: tp.advanceAtPos,
      pair: tp.pair || null,
    });
    trDiag(pl, 'armed', { planSec: tp.advanceAtPos, trKind: tp.kind });
  } else if (step === 'skip' && state === 'armed') {
    f.trDone = true;
    trNote(pl, vid, { state: 'skipped', cancel: 'not_reached' });
    endTransition(pl, 'skipped', 'not_reached');
  } else if (step === 'advance' && state === 'armed') advance(pl, v, f, ct, now, null);
  else if (step === 'wait' && state === 'armed' && ct < (tp.advanceAtPos ?? 0) - pl.A.TR_ARM_SEC - 1)
    endTransition(pl, 'cancelled', 'jump');
}

function maybeOpenWash(pl: Player, f: FadeState, tp: TPlan, ct: number): void {
  const washWanted = tp.pair ? tp.pair.wash : !pl.RO;
  const { tr } = pl;
  if (tr.state !== 'armed' || !pl.settings.transitionWash || !washWanted || tr.washOpen || pl.ov.state !== 'idle')
    return;
  const fo = f.plan?.fadeOut;
  const openAt = tp.kind === 'fade_trim' && fo ? fo.startPos : (tp.advanceAtPos ?? 0) - WASH_LEAD_SEC;
  if (ct >= openAt) openWash(pl);
}

function updateBeforeAdvance(pl: Player, v: HTMLVideoElement, vid: string, ct: number, now: number): void {
  const f = pl.fade && pl.fade.vid === vid ? pl.fade : null;
  const prev = pl.trPrev.vid === vid ? pl.trPrev.ct : null;
  pl.trPrev = { vid, ct };
  if (!f?.tplan || f.trDone) return;

  if (liveEligible(pl, f)) {
    liveTick(pl, v, f, ct, now);

    return;
  }

  if (pl.tr.live) {
    endTransition(pl, 'cancelled', 'off');

    return;
  }

  const tp = f.tplan;

  // inside the last sound an advance only cuts the track short, unless the run-ahead carries it over
  if (tp.atEnd && !(pl.ov.state === 'capture' && pl.ov.vid === vid)) {
    if (pl.tr.state === 'armed') endTransition(pl, 'cancelled', 'off');

    return;
  }

  stepArmed(pl, v, f, tp, ct, now, prev);
  maybeOpenWash(pl, f, tp, ct);
}

export function updateTransition(pl: Player, v: HTMLVideoElement, vid: string, ct: number, now: number): void {
  const { tr } = pl;

  if (tr.state === 'idle' || tr.state === 'armed') {
    updateBeforeAdvance(pl, v, vid, ct, now);

    return;
  }

  const sounding = !v.paused && v.readyState >= 2;

  // the new track may show up without emptied / loadstart (same element, new videoId)
  if ((tr.state === 'incoming' || tr.state === 'advancing') && vid !== tr.fromVid && sounding)
    enterIncoming(pl, v, vid, ct, now);
  // "previous" right after our advance: the outgoing track never counts as incoming, so the gain would stay at 0
  else if (tr.state === 'incoming' && vid === tr.fromVid && sounding && now - tr.since >= TR_BACK_SEC) {
    cancelTransition(pl, 'track_change');
    if (pl.fade && pl.fade.vid === vid) pl.fade = null;
  }
}

function endWithoutFade(pl: Player, g: AudioParam, now: number, why: string): void {
  if (g.value !== 1) {
    g.cancelScheduledValues(now);
    g.setValueAtTime(1, now);
  }

  trDiag(pl, 'incoming_no_fade', { why });
  endTransition(pl, 'done', null);
}

export function startTrFadeIn(pl: Player, vid: string | null, why: string): void {
  const { fadeNode, ctx, tr } = pl;
  if (!fadeNode || !ctx) return;
  const g = fadeNode.gain;
  const now = ctx.currentTime;

  if (tr.noFade) {
    endWithoutFade(pl, g, now, why);

    return;
  }

  const dur =
    tr.fadeInSec !== undefined && Number.isFinite(tr.fadeInSec) && tr.fadeInSec > 0
      ? tr.fadeInSec
      : pl.A.TR_FADE_IN_SEC;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0, now);
  g.setValueCurveAtTime(fadeInCurve, now + 0.005, dur);
  tr.state = 'fadingIn';
  tr.since = now;
  tr.fadeInEnd = now + 0.005 + dur;
  const fade = pl.fade;

  if (fade && fade.vid === vid) {
    fade.fadingIn = true;
    fade.fadeInEnd = tr.fadeInEnd;
    fade.lastAction = 'tr_fade_in';
  }

  const inc = vid ? pl.trIn[vid] : undefined;

  if (inc) {
    inc.fadeIn = true;
    inc.fadeInSec = dur;
  }

  trDiag(pl, 'fade_in', { why, durSec: dur });
}

export function trTick(pl: Player, v: HTMLVideoElement, now: number): void {
  const { tr } = pl;

  if (tr.state === 'fadingIn' && now > tr.fadeInEnd + 0.02) {
    endTransition(pl, 'done', null);

    return;
  }

  const limit = TR_TIMEOUT[tr.state];
  if (!limit || now - tr.since <= limit) return;

  if (tr.state === 'trimming' && !v.paused) {
    tr.selfSeek = false;
    startTrFadeIn(pl, playerVideoId(pl), 'trim_timeout');

    return;
  }

  cancelTransition(pl, 'timeout');
}

export function onTrMedia(pl: Player, type: string): void {
  const { tr, video, ctx } = pl;
  if (tr.state === 'idle') return;

  if (isAdNow(pl)) {
    cancelTransition(pl, 'ad');

    return;
  }

  if ((type === 'emptied' || type === 'loadstart') && tr.state === 'advancing') {
    tr.state = 'incoming';
    tr.since = ctx ? ctx.currentTime : 0;
    trDiag(pl, 'incoming', { via: type });
  } else if (type === 'seeked' && tr.selfSeek) {
    tr.selfSeek = false;
    if (tr.state === 'trimming') startTrFadeIn(pl, playerVideoId(pl), 'seeked');
  } else if (type === 'playing' && (tr.state === 'incoming' || tr.state === 'advancing') && video && ctx) {
    const vid = playerVideoId(pl);
    if (vid && vid !== tr.fromVid) enterIncoming(pl, video, vid, video.currentTime, ctx.currentTime);
  }
}
