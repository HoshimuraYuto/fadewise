import type { SwitchPlan } from '../../shared/analysis.mts';
import { noteError, rampParam, RELEASE_SEC, round } from './common.mts';
import { headMode, headUntil, rushStart } from './head-rush.mts';
import { ovCancel } from './overlap-events.mts';
import { ovEnter } from './overlap-enter.mts';
import { fadeStateFor } from './plan.mts';
import { nextBlocked, nextButton } from './queue.mts';
import { isExcluded, type Player } from './state.mts';
import { endTransition, startTrFadeIn, trDiag, trNote } from './transition.mts';
import type { FadeState, MixIn, TPlan, TrIn } from './types.mts';
import { closeWash } from './wash.mts';
import { isAdNow, sameStoredTrack } from './youtube.mts';

type Live = { skipSec: number } | null;
type HeadTrim = { seekTo: number | null; why: string };

function switchPlan(pl: Player, f: FadeState, tp: TPlan, live: Live): SwitchPlan {
  const overlap = !!pl.tr.overlap;
  const op = overlap ? f.oplan : null;
  const next = f.nextVid ? pl.index[f.nextVid] : null;

  return {
    kind: live ? 'live_trim' : tp.kind,
    overlap,
    leadSec: overlap && pl.ov.cap ? pl.ov.cap.leadSec : null,
    planLeadSec: op?.leadSec ?? null,
    rate: op?.rate ?? null,
    shape: op?.shape ?? null,
    adapt: op?.adapt?.why ?? null,
    style: op?.style?.kind ?? null,
    waitSec: op?.basis?.waitSec ?? null,
    headSec: next && Number.isFinite(next.fs) ? round(next.fs as number, 2) : null,
  };
}

function planMixIn(pl: Player, f: FadeState, tp: TPlan, live: Live): MixIn | null {
  const mx = !live && !f.mixOff ? tp.mix : null;
  if (!mx) return null;
  trNote(pl, f.vid, { mix: { mode: mx.mode, x: mx.x.k, n: mx.n.k, xSec: mx.x.t, nSec: mx.n.t } });
  if (!mx.entry || typeof mx.nextVid !== 'string') return null;

  return { vid: mx.nextVid, t: mx.n.t, k: mx.n.k, c: mx.n.c, from: f.vid, xk: mx.x.k, xt: mx.x.t };
}

function noteAdvance(pl: Player, v: HTMLVideoElement, f: FadeState, tp: TPlan, ct: number, live: Live): void {
  const vid = f.vid;
  const kind = live ? 'live_trim' : tp.kind;
  const pair = tp.pair || null;
  const outcome = { state: 'advanced', atSec: round(ct, 2), cancel: null, wash: !!pl.tr.washOpen, pair };
  trNote(pl, vid, Object.assign(outcome, live ? { skipSec: live.skipSec, planSec: null } : {}));
  const fo = !live && tp.kind === 'fade_trim' && f.plan?.fadeOut ? f.plan.fadeOut : null;
  pl.recent.tr = {
    at: Date.now(),
    from: vid,
    kind,
    skipSec: round(live ? live.skipSec : Math.max(0, v.duration - ct), 1),
    fadeSec: fo ? round(fo.endPos - fo.startPos, 1) : null,
    headTrimSec: null,
    overlap: !!pl.tr.overlap,
    overlapSec: null,
  };
  const pairDiag = pair && {
    tempo: pair.tempo,
    key: pair.key,
    fadeOutSec: pair.fadeOutSec,
    extraWaitSec: pair.extraWaitSec,
    fadeInSec: pair.fadeInSec,
    wash: pair.wash,
    reasons: pair.reasons,
  };
  trDiag(pl, 'advance', { planSec: tp.advanceAtPos, trKind: kind, remain: round(v.duration - ct, 3), pair: pairDiag });
}

function holdZero(g: AudioParam, now: number): void {
  rampParam(g, 0, now, RELEASE_SEC);
}

export function advance(pl: Player, v: HTMLVideoElement, f: FadeState, ct: number, now: number, live: Live): void {
  const vid = f.vid;
  const btn = nextButton(pl);
  const blocked = nextBlocked(pl, btn);
  f.trDone = true;
  const tp = f.tplan;

  if (blocked || !btn || !tp) {
    trNote(pl, vid, { state: 'skipped', cancel: blocked });
    endTransition(pl, 'skipped', blocked);
    ovCancel(pl, 'off');

    return;
  }

  const { tr } = pl;
  tr.overlap = !live && pl.ov.state === 'capture' && pl.ov.vid === vid;
  pl.sw.adv = { vid, at: now, plan: switchPlan(pl, f, tp, live) };
  if (!live && !tr.overlap && pl.fadeNode) holdZero(pl.fadeNode.gain, now);
  closeWash(pl, false);

  if (f.scheduled) {
    f.scheduled = null;
    f.fadeOutDone = true;
    f.outResult = 'done';
    f.outCancel = null;
  }

  tr.state = 'advancing';
  tr.since = now;
  tr.noFade = !!live;
  tr.mixIn = planMixIn(pl, f, tp, live);
  tr.fadeInSec = !live && tp.pair && Number.isFinite(tp.pair.fadeInSec) ? tp.pair.fadeInSec : pl.A.TR_FADE_IN_SEC;
  f.lastAction = 'tr_advance';
  noteAdvance(pl, v, f, tp, ct, live);
  btn.click();
}

export function mixEntryFor(pl: Player, vid: string, ct: number): MixIn | null {
  const m = pl.tr.mixIn;
  if (!m || m.vid !== vid || isExcluded(pl, vid) || isAdNow(pl) || !sameStoredTrack(pl, vid)) return null;
  if (!(Number.isFinite(ct) && ct < m.t - 0.5 && ct < 2)) return null;

  return m;
}

export function noteHeadTrim(pl: Player, sec: number): void {
  const recent = pl.recent.tr;
  if (recent && recent.from === pl.tr.fromVid) recent.headTrimSec = round(sec, 1);
}

export function selfSeek(pl: Player, v: HTMLVideoElement, to: number, now: number): void {
  pl.tr.selfSeek = true;
  pl.tr.selfSeekUntil = now + 1;
  v.currentTime = to;
}

function enterExcluded(pl: Player, vid: string, now: number): void {
  pl.trIn[vid] = { fadeIn: false, headTrimTo: null, headReason: 'excluded', at: now, wall: Date.now() };
  if (pl.fadeNode) rampParam(pl.fadeNode.gain, 1, now, RELEASE_SEC);
  trDiag(pl, 'incoming_excluded', {});
  endTransition(pl, 'done', null);
}

function headTrimPlan(pl: Player, v: HTMLVideoElement, vid: string): HeadTrim {
  try {
    const h = pl.A.planHeadTrim(pl.index[vid] || null, v.duration);
    if (__FADEWISE_VERIFY__ && pl.win.__fadewiseHeadLong === false && h.why === 'exact_quiet')
      return { seekTo: null, why: 'long' };

    return h;
  } catch (err) {
    noteError(pl, err);

    return { seekTo: null, why: 'no_analysis' };
  }
}

function enterAtMixPoint(pl: Player, v: HTMLVideoElement, inc: TrIn, mi: MixIn, ct: number, now: number): void {
  pl.tr.state = 'trimming';
  pl.tr.since = now;
  Object.assign(inc, { headTrimTo: mi.t, headReason: 'mix_' + mi.k, mix: mi, seekAt: now });
  noteHeadTrim(pl, mi.t - ct);
  trDiag(pl, 'mix_entry', { to: mi.t, k: mi.k });
  selfSeek(pl, v, mi.t, now);
}

function trimHead(pl: Player, v: HTMLVideoElement, vid: string, h: HeadTrim, inc: TrIn, ct: number, now: number) {
  const hu = h.seekTo !== null && headMode(pl) === 'rate' && sameStoredTrack(pl, vid) ? headUntil(pl, v, vid) : null;

  if (hu && hu.pos !== null && rushStart(pl, vid, hu.pos, 'plain')) {
    pl.tr.state = 'trimming';
    pl.tr.since = now;
    inc.headReason = 'rush_exact';
    trDiag(pl, 'head_rush', { to: hu.pos });

    return;
  }

  if (h.seekTo !== null && ct < h.seekTo - 0.1 && sameStoredTrack(pl, vid)) {
    pl.tr.state = 'trimming';
    pl.tr.since = now;
    inc.headTrimTo = h.seekTo;
    noteHeadTrim(pl, h.seekTo - ct);
    trDiag(pl, 'head_trim', { to: h.seekTo });
    selfSeek(pl, v, h.seekTo, now);

    return;
  }

  startTrFadeIn(pl, vid, 'playing');
}

export function enterIncoming(pl: Player, v: HTMLVideoElement, vid: string, ct: number, now: number): void {
  if (pl.tr.noFade) {
    pl.trIn[vid] = { fadeIn: false, headTrimTo: null, headReason: 'live', at: now, wall: Date.now() };
    startTrFadeIn(pl, vid, 'playing');

    return;
  }

  if (pl.tr.overlap) {
    ovEnter(pl, v, vid, now);

    return;
  }

  // the transition fade-in replaces the cut-in fade
  fadeStateFor(pl, vid).fadeInDone = true;

  if (isExcluded(pl, vid)) {
    enterExcluded(pl, vid, now);

    return;
  }

  const h = headTrimPlan(pl, v, vid);
  const inc: TrIn = { fadeIn: false, headTrimTo: null, headReason: h.why, at: now, wall: Date.now() };
  pl.trIn[vid] = inc;
  const mi = mixEntryFor(pl, vid, ct);
  if (mi) enterAtMixPoint(pl, v, inc, mi, ct, now);
  else trimHead(pl, v, vid, h, inc, ct, now);
}
