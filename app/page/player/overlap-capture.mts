import { round } from './common.mts';
import { fadeOutCurve } from './fades.mts';
import { ovBoundary, ovCancel } from './overlap-events.mts';
import { OV_DRAIN_LIMIT_SEC, ovDiag, ovParam } from './overlap-core.mts';
import { nextBlocked, nextButton } from './queue.mts';
import { restoreRate, setRate } from './rate.mts';
import { ovIdle, type Player } from './state.mts';
import { trNote } from './transition.mts';
import type { FadeState } from './types.mts';
import { playerDuration, sameStoredTrack } from './youtube.mts';
import type { OverlapPlan } from '../../shared/analysis.mts';

function ovScheduleFade(pl: Player, f: FadeState, now: number): void {
  const fo = f.plan?.fadeOut;
  if (pl.ov.fadeOut || !pl.settings.fadesEnabled || !fo) return;
  const want = pl.A.fadeOutHeardTimes(fo, pl.ov.cap, now);
  if (!want) return;
  const g = ovParam(pl, 'gOld');
  if (!g) return;
  g.cancelScheduledValues(now);
  g.setValueAtTime(1, now);
  g.setValueCurveAtTime(fadeOutCurve, want.startCtx, want.endCtx - want.startCtx);
  pl.ov.fadeOut = want;
  f.outResult = 'scheduled';
  f.outCancel = null;
  f.lastAction = 'fade_out_scheduled';
  ovDiag(pl, 'fade_out', {
    startCtx: round(want.startCtx, 3),
    endCtx: round(want.endCtx, 3),
    startPos: fo.startPos,
    endPos: fo.endPos,
  });
}

function tickCapture(pl: Player, v: HTMLVideoElement, f: FadeState, vid: string, ct: number, now: number): void {
  const { ov } = pl;

  if (ov.vid !== vid) {
    ovBoundary(pl, 'vid');

    return;
  }

  ov.lastCt = ct;
  ov.lastDur = playerDuration(pl) || v.duration;

  if (v.playbackRate !== (ov.cap ? ov.cap.rate : pl.A.OVERLAP.rate) && !pl.selfRate) {
    ovCancel(pl, 'rate');

    return;
  }

  ovScheduleFade(pl, f, now);
}

function captureMayStart(pl: Player, f: FadeState, p: OverlapPlan | null): p is OverlapPlan {
  const { tr } = pl;
  if (!p?.on || !pl.ovNode || !pl.ctx || !pl.ovInGraph || f.trDone || f.ovDone) return false;

  return tr.state === 'idle' || tr.state === 'armed';
}

function startCapture(pl: Player, f: FadeState, p: OverlapPlan, ct: number, now: number, lead: number): void {
  const { ctx, ovNode, track } = pl;
  if (!ctx || !ovNode) return;
  const vid = f.vid;
  setRate(pl, p.rate, false);
  pl.ov = Object.assign(ovIdle(), {
    state: 'capture' as const,
    vid,
    since: now,
    plan: p,
    cap: { t0: now, p0: ct, delaySec: 512 / ctx.sampleRate, leadSec: round(lead, 2), rate: p.rate, shape: p.shape },
    oldDb: track && track.vid === vid && track.decided ? track.decided.gainDb : 0,
  });
  const style = p.style ?? null;
  ovNode.port.postMessage({
    cmd: 'capture',
    rate: p.rate,
    shape: p.shape,
    style,
    swapLeftSec: style?.swapLeftSec ?? null,
    swapInSec: style?.swapInSec ?? null,
  });
  pl.status.overlapCancel = null;
  trNote(pl, vid, {
    overlap: {
      shape: p.shape,
      leadSec: round(lead, 2),
      planLeadSec: p.leadSec,
      startSec: round(ct, 2),
      state: 'running',
      cancel: null,
      leadOutSec: null,
      xfSec: null,
      lostSec: null,
    },
  });
  ovDiag(pl, 'capture', { leadSec: lead, shape: p.shape, startPos: p.captureStartPos, p0: round(ct, 3) });
}

function tickIdle(pl: Player, f: FadeState, vid: string, ct: number, now: number): void {
  restoreRate(pl);
  const p = f.oplan;
  if (!captureMayStart(pl, f, p)) return;
  const lead = pl.A.overlapLeadAt(p, ct);
  if (lead === null || !sameStoredTrack(pl, vid) || nextBlocked(pl, nextButton(pl))) return;
  if (f.scheduled && now >= f.scheduled.startCtx - 0.05) return;

  if (f.scheduled && pl.fadeNode) {
    const g = pl.fadeNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(1, now);
    f.scheduled = null;
    f.outResult = null;
  }

  startCapture(pl, f, p, ct, now, lead);
  ovScheduleFade(pl, f, now);
}

export function ovTick(pl: Player, v: HTMLVideoElement, f: FadeState, vid: string, ct: number, now: number): void {
  const { ov } = pl;
  const leadSec = ov.cap ? ov.cap.leadSec : 0;
  if (ov.state === 'drain' && now - ov.since > leadSec + OV_DRAIN_LIMIT_SEC) ovCancel(pl, 'timeout');
  else if (ov.state === 'capture') tickCapture(pl, v, f, vid, ct, now);
  else if (ov.state === 'idle') tickIdle(pl, f, vid, ct, now);
}
