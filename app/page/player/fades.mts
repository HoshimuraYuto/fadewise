import { post, RELEASE_SEC, round } from './common.mts';
import { closeWash } from './wash.mts';
import { cancelTransition, endTransition, trHolds, trPlanned } from './transition.mts';
import { fadeStateFor, refreshPair } from './plan.mts';
import { ovCancel } from './overlap-events.mts';
import type { Player } from './state.mts';
import type { FadeState, PlayerPlan } from './types.mts';
import { playerVideoId, sameStoredTrack } from './youtube.mts';

const SCHEDULE_AHEAD_SEC = 15;
const DRIFT_MAX_SEC = 0.25;
const GAPLESS_END_SEC = 1.5;
const FADE_CURVE_POINTS = 64;

const curve = (f: (x: number) => number) => {
  const c = new Float32Array(FADE_CURVE_POINTS);
  for (let i = 0; i < FADE_CURVE_POINTS; i++) c[i] = f(i / (FADE_CURVE_POINTS - 1));

  return c;
};

export const fadeOutCurve = curve((x) => Math.cos((Math.PI / 2) * x));
fadeOutCurve[FADE_CURVE_POINTS - 1] = 0;
export const fadeInCurve = curve((x) => Math.pow(Math.sin((Math.PI / 2) * x), 2));
fadeInCurve[0] = 0;
fadeInCurve[FADE_CURVE_POINTS - 1] = 1;

export const NO_FADES = (): PlayerPlan => ({
  fadeIn: null,
  fadeOut: null,
  skipAtPos: null,
  reason: 'analysed',
  align: { on: false, reason: 'no_fade' },
});

function resetFadeGain(g: AudioParam, now: number, instant: boolean): void {
  try {
    g.cancelScheduledValues(now);
  } catch {
    /* ignore */
  }

  try {
    if (instant) g.setValueAtTime(1, now);
    else {
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(1, now + RELEASE_SEC);
    }
  } catch {
    try {
      g.value = 1;
    } catch {
      /* ignore */
    }
  }
}

function noteFadeCancelled(pl: Player, fade: FadeState, reason: string, now: number): void {
  if (__FADEWISE_VERIFY__ && fade.scheduled)
    post(pl, 'diag', {
      kind: 'fade_cancel',
      vid: fade.vid,
      reason,
      at: round(now, 3),
      plannedStart: round(fade.scheduled.startCtx, 3),
    });

  // an abrupt track ends before restorePos, so a fade-out that reached 0 counts as done
  if (fade.scheduled) {
    const reachedZero = now >= fade.scheduled.endCtx - 0.05;
    fade.outResult = reachedZero ? 'done' : 'cancelled';
    fade.outCancel = reachedZero ? null : reason;
  }

  fade.scheduled = null;
  fade.fadingIn = false;
  fade.fadeOutDone = false;
  fade.lastAction = 'cancel:' + reason;
}

export function releaseFade(pl: Player, reason: string): void {
  if (trHolds(pl, reason)) return;
  if (pl.tr.state !== 'idle') endTransition(pl, 'cancelled', reason);
  const { fadeNode, ctx, fade } = pl;
  if (!fadeNode || !ctx) return;
  const g = fadeNode.gain;
  const now = ctx.currentTime;
  const busy = fade && (fade.scheduled || fade.fadingIn);
  if (!busy && g.value === 1) return;
  // ads: no ramp may still be running when the ad starts
  resetFadeGain(g, now, reason === 'ad' || reason === 'ad_start' || reason === 'ad_end');
  if (fade) noteFadeCancelled(pl, fade, reason, now);
}

export function startFadeIn(pl: Player, reason: string): void {
  const { fadeNode, ctx, video } = pl;
  if (!pl.settings.fadesEnabled || !fadeNode || !ctx || !video) return;
  if (pl.tr.state !== 'idle' || pl.ov.state === 'drain') return;
  const vid = playerVideoId(pl);
  if (!vid) return;
  const f = fadeStateFor(pl, vid);
  const fi = f.plan?.fadeIn;
  if (!fi || f.fadeInDone || video.paused || video.currentTime > 0.3 || !sameStoredTrack(pl, vid)) return;
  f.fadeInDone = true;
  const g = fadeNode.gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(pl.A.dbToLinear(fi.fromDb), now);
  g.linearRampToValueAtTime(1, now + fi.durSec);
  f.fadingIn = true;
  f.fadeInEnd = now + fi.durSec;
  f.lastAction = 'fade_in';
  if (__FADEWISE_VERIFY__)
    post(pl, 'diag', {
      kind: 'fade_in',
      vid,
      reason,
      at: round(now, 3),
      fromDb: fi.fromDb,
      durSec: fi.durSec,
      ct: round(video.currentTime, 3),
    });
}

function checkScheduledFadeOut(pl: Player, f: FadeState, v: HTMLVideoElement, ct: number, now: number): void {
  const s = f.scheduled;
  const fo = f.plan?.fadeOut;
  if (!s || !fo) return;

  if (now >= s.restoreCtx) {
    f.scheduled = null;
    f.fadeOutDone = true;
    f.lastAction = 'fade_out_done';
    f.outResult = 'done';
    f.outCancel = null;

    return;
  }

  const expectStart = now + (fo.startPos - ct) / (v.playbackRate || 1);
  if (Math.abs(expectStart - s.startCtx) > DRIFT_MAX_SEC) releaseFade(pl, 'drift');
}

function scheduleFadeOut(pl: Player, f: FadeState, fadeNode: GainNode, vid: string, ct: number, now: number): void {
  const fo = f.plan?.fadeOut;
  const v = pl.video;
  if (!fo || !v) return;
  const want = pl.A.fadeOutTimes(fo, ct, now, v.playbackRate);
  if (f.fadeOutDone || !want || want.startCtx - now > SCHEDULE_AHEAD_SEC || !sameStoredTrack(pl, vid)) return;
  const g = fadeNode.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(1, now);
  g.setValueCurveAtTime(fadeOutCurve, want.startCtx, want.endCtx - want.startCtx);
  g.setValueAtTime(1, want.restoreCtx);
  f.scheduled = want;
  f.lastAction = 'fade_out_scheduled';
  f.outResult = 'scheduled';
  f.outCancel = null;
  if (__FADEWISE_VERIFY__)
    post(pl, 'diag', {
      kind: 'fade_out',
      vid,
      at: round(now, 3),
      ct: round(ct, 3),
      startCtx: round(want.startCtx, 3),
      endCtx: round(want.endCtx, 3),
      restoreCtx: round(want.restoreCtx, 3),
      startPos: fo.startPos,
      endPos: fo.endPos,
      align: f.plan?.align || null,
    });
}

function noteGaplessEnd(pl: Player, f: FadeState): void {
  if (f.gapless && f.nextVid) pl.recent.gapless = { at: Date.now(), from: f.vid, to: f.nextVid };
}

export function updateFadeOut(pl: Player, v: HTMLVideoElement, vid: string, ct: number, now: number): void {
  const f = fadeStateFor(pl, vid);
  if (f.fadingIn && now > (f.fadeInEnd ?? 0) + 0.05) f.fadingIn = false;
  refreshPair(pl, f, now);
  // YTM does not always send 'ended' before the next source
  if (f.gapless && Number.isFinite(v.duration) && v.duration - ct < GAPLESS_END_SEC) noteGaplessEnd(pl, f);
  if (pl.ov.state !== 'idle' && pl.ov.vid === vid) return;
  const { fadeNode, tr } = pl;
  if (!pl.settings.fadesEnabled || !f.plan?.fadeOut || !fadeNode) return;
  if ((f.fadeOutDone && !f.scheduled) || (tr.state !== 'idle' && tr.state !== 'armed')) return;
  if (f.scheduled) checkScheduledFadeOut(pl, f, v, ct, now);
  else scheduleFadeOut(pl, f, fadeNode, vid, ct, now);
}

function fadePlanned(pl: Player, now: number): boolean {
  const f = pl.fade;
  if (!f) return trPlanned(pl, now);
  const outRunning = !!f.scheduled && now <= f.scheduled.restoreCtx + 0.2;
  const inRunning = f.fadingIn && now <= (f.fadeInEnd ?? 0) + 0.2;

  return outRunning || inRunning || trPlanned(pl, now);
}

export function fadeWatchdog(pl: Player, now: number, ad: boolean): void {
  const { fadeNode, washSend, washOut } = pl;
  if (!fadeNode) return;
  if (ad && pl.ov.state !== 'idle') ovCancel(pl, 'ad');
  if (ad && pl.tr.state !== 'idle') cancelTransition(pl, 'ad');
  const washSounding = washSend && (washSend.gain.value > 0.001 || (ad && washOut && washOut.gain.value > 0.001));
  if (washSounding && (ad || pl.tr.state !== 'armed')) closeWash(pl, ad);
  const value = fadeNode.gain.value;
  if (value === 1 || (!ad && fadePlanned(pl, now))) return;
  releaseFade(pl, ad ? 'ad' : 'watchdog');
  if (__FADEWISE_VERIFY__) post(pl, 'diag', { kind: 'fade_watchdog', value: round(value, 4), at: round(now, 3) });
}
