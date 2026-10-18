import { noteError, post, round, safe } from './common.mts';
import { releaseFade, startFadeIn, updateFadeOut } from './fades.mts';
import { checkJump, frameState, housekeeping, noteAdChange, silentFrameChanges } from './frame-steps.mts';
import { applyGainFor } from './gain.mts';
import { ovTick } from './overlap-capture.mts';
import { OV_DRAIN_LIMIT_SEC } from './overlap-core.mts';
import { ovCancel } from './overlap-events.mts';
import { fadeStateFor } from './plan.mts';
import { addAccepted, commitHead, flush, FLUSH_EVERY_FRAMES, headFrame, startSession, guard } from './session.mts';
import { isExcluded, type Player } from './state.mts';
import { fadeStatus } from './status.mts';
import { swFrame } from './switch-log.mts';
import { tkStatus } from './tempo-key.mts';
import { updateTransition } from './transition.mts';
import type { Frame, PlaySession } from './types.mts';
import { diagFirstSound, logMeter } from './verify.mts';
import { audioConfigFor, isAdNow, playerDuration, playerVideoId, trackMeta } from './youtube.mts';

const LOCK_AFTER_SOUND_SEC = 2;
const LOOP_HEAD_SEC = 3;
const LOOP_END_SEC = 1.5;

interface FrameCtx {
  f: Frame;
  v: HTMLVideoElement;
  c: AudioContext;
  now: number;
  ad: boolean;
  vid: string | null;
  ct: number;
  vol: number;
  raw: number;
  rawPeak: number;
}

// 1-track repeat is a new listen; otherwise its head would become the stored ending
function looped(s: PlaySession | null, fc: FrameCtx): boolean {
  if (fc.ad || !fc.vid || !s || s.videoId !== fc.vid || s.lastAcceptedPos === null || fc.ct >= LOOP_HEAD_SEC)
    return false;
  const nearEnd =
    s.durationSec !== null && Number.isFinite(s.durationSec) && s.durationSec - s.lastAcceptedPos < LOOP_END_SEC;

  return s.reachedEnd || nearEnd;
}

function sessionFor(pl: Player, fc: FrameCtx): PlaySession | null {
  const { vid, ad } = fc;
  let s = pl.session;
  const again = looped(s, fc);

  if (again && s) {
    // the loop may come without an 'ended' event
    pl.A.markEnded(s, s.durationSec);

    if (pl.fade && pl.fade.vid === vid) {
      releaseFade(pl, 'track_change');
      pl.fade = null;
    }
  }

  if (!ad && vid && (!s || s.videoId !== vid || again)) {
    s = startSession(pl, vid);
    pl.head = { vid, prevCt: null, prevT: null, killed: false, pending: [] };
    guard(pl, 'track_change');
  }

  if (!ad && vid && s && s.videoId === vid) {
    s.meta ??= trackMeta(pl, vid);
    s.yt ??= audioConfigFor(pl, vid);
    const d = playerDuration(pl);
    if (d) s.durationSec = d;
  }

  return s;
}

function analysisState(pl: Player, fc: FrameCtx, state: string): string {
  const { f, v, vid, ct, raw, rawPeak } = fc;

  if (state === 'analyzing' && vid) {
    if (f.t < pl.hardGuardUntil) return 'guard';
    if (f.t < pl.softGuardUntil) return headFrame(pl, f, v, vid, ct, raw, rawPeak);
    if (pl.head) commitHead(pl);
  } else if (pl.head && (state === 'ad' || state === 'muted' || state === 'ahead')) pl.head.killed = true;

  return state;
}

function analyse(pl: Player, fc: FrameCtx, s: PlaySession | null, state: string): boolean {
  const { f, v, vid, ct, raw } = fc;
  pl.counts[state] = (pl.counts[state] || 0) + 1;
  const accepted = state === 'analyzing' && f.n > 0;
  if (!accepted || !s || !vid) return accepted;
  const fr = { vid, ct, raw, fx: f.fx, cr: f.cr, bd: f.bd, contiguous: pl.prevAccepted, rate: v.playbackRate };
  addAccepted(pl, s, fr, fc.rawPeak);
  if (pl.framesSinceFlush >= FLUSH_EVERY_FRAMES) flush(pl, false);

  return accepted;
}

function trackGainStep(pl: Player, fc: FrameCtx): void {
  const { f, v, vid, ad } = fc;
  const track = pl.track;
  const audible = !ad && vid && !v.muted && fc.vol >= 1e-3 && fc.rawPeak > Math.pow(10, pl.A.SILENCE_DBFS / 20);

  if (audible && track && track.vid === vid && track.firstSoundAt === null) {
    track.firstSoundAt = f.t;
    diagFirstSound(pl, f, vid, fc.ct);
  }

  if (track && !track.locked && track.firstSoundAt !== null && f.t - track.firstSoundAt > LOCK_AFTER_SOUND_SEC)
    track.locked = true;
  if (!ad && vid && (!pl.track || pl.track.vid !== vid || !pl.track.locked)) applyGainFor(pl, 'frame');
}

function playbackSteps(pl: Player, fc: FrameCtx): void {
  const { v, vid, ad, ct, now } = fc;

  if (!ad && vid && !v.paused) {
    try {
      if (ct <= 0.3) startFadeIn(pl, 'frame');
      ovTick(pl, v, fadeStateFor(pl, vid), vid, ct, now);
      updateFadeOut(pl, v, vid, ct, now);
      updateTransition(pl, v, vid, ct, now);
    } catch (e) {
      noteError(pl, e);
      ovCancel(pl, 'error');
      releaseFade(pl, 'error');
    }
  } else if (!ad && pl.ov.state === 'drain' && now - pl.ov.since > OV_DRAIN_LIMIT_SEC + 6) ovCancel(pl, 'timeout');
}

function publishStatus(pl: Player, fc: FrameCtx, state: string): void {
  const { f, v, c, ad, vid, ct } = fc;
  const { gainNode, fadeNode, session, settings } = pl;
  const postGain = __FADEWISE_VERIFY__ && f.e2 !== undefined && Number.isFinite(f.e2) && f.e2 > 0;
  pl.status = Object.assign(pl.status, {
    state,
    counts: pl.counts,
    videoId: ad ? null : vid,
    ad,
    ctxState: c.state,
    ctxTime: round(fc.now, 2),
    meter: pl.meterOk,
    connected: pl.connected,
    gainLinear: gainNode ? round(gainNode.gain.value, 4) : null,
    fadeLinear: fadeNode ? round(fadeNode.gain.value, 4) : null,
    postMeterDb: postGain ? round(10 * Math.log10(f.e2 as number), 1) : null,
    saving: !!(session?.save && settings.saveAnalysis),
    fade: fadeStatus(pl),
    reorder: pl.reorderer ? pl.reorderer.status() : null,
    position: round(ct, 1),
    volume: round(fc.vol, 3),
    muted: v.muted,
    errors: pl.errors,
    at: Date.now(),
    excluded: !ad && isExcluded(pl, vid),
    recent: { tr: pl.recent.tr, gapless: pl.recent.gapless },
    sessionAcceptedSec: session ? round(session.accepted * 0.1, 1) : 0,
    tempoKey: tkStatus(pl),
  });
  if ((f.seq || 0) % 5 === 0) post(pl, 'status', pl.status);
}

function frameContext(pl: Player, f: Frame, v: HTMLVideoElement, c: AudioContext, now: number, ad: boolean) {
  const vol = v.volume;

  return {
    f,
    v,
    c,
    ad,
    now,
    vid: playerVideoId(pl),
    ct: v.currentTime,
    vol,
    raw: vol > 0 ? f.e / (vol * vol) : 0,
    rawPeak: vol > 0 ? f.p / vol : 0,
  };
}

function handleTrackFrame(pl: Player, fc: FrameCtx): void {
  const { f, ad, vid } = fc;
  noteAdChange(pl, ad);
  let state = frameState(fc.v, vid, ad);
  checkJump(pl, f, fc.v, vid, fc.ct, ad);
  const s = sessionFor(pl, fc);
  state = analysisState(pl, fc, state);
  const accepted = analyse(pl, fc, s, state);
  trackGainStep(pl, fc);
  // the first-play gap closer trusts only contiguous analysed frames
  pl.frameIn = { lufs: fc.raw > 0 ? pl.A.energyToLufs(fc.raw) : -Infinity, ok: accepted && pl.prevAccepted };
  swFrame(pl, vid, fc.ct, f.t, fc.raw, fc.rawPeak, ad);
  playbackSteps(pl, fc);
  pl.prevAccepted = accepted || (state === 'head' ? pl.prevAccepted : false);
  pl.lastFrame = { ct: fc.ct, t: f.t, vid: ad ? null : vid };
  if (__FADEWISE_VERIFY__ && pl.settings.postMeter) logMeter(pl, { f, ct: fc.ct, vid, ad, state });
  publishStatus(pl, fc, state);
}

export const createFrameHandler = (pl: Player): ((f: Frame) => void) =>
  safe(pl, (f: Frame) => {
    const v = pl.video;
    const c = pl.ctx;
    if (!v || !c) return;
    const now = c.currentTime;
    const ad = isAdNow(pl);
    housekeeping(pl, f, v, c, now, ad);
    silentFrameChanges(pl, f, v, ad);
    pl.status.meterDb = f.e > 0 ? round(10 * Math.log10(f.e), 1) : null;
    handleTrackFrame(pl, frameContext(pl, f, v, c, now, ad));
  });
