import { appliedFor } from './applied.mts';
import { noteError, post, round } from './common.mts';
import { releaseFade } from './fades.mts';
import type { Player } from './state.mts';
import { mxAdd, tkAdd, tkPayload, tkReset, TK_EVERY_FLUSHES, type AcceptedFrame } from './tempo-key.mts';
import type { Frame, PlaySession } from './types.mts';
import { audioConfigFor, NO_AUDIO_CONFIG, playerDuration, playerVideoId } from './youtube.mts';

const GUARD_SEC = 1.0;
export const FLUSH_EVERY_FRAMES = 100;
const SOFT_GUARDS = new Set(['emptied', 'loadstart', 'loadedmetadata', 'durationchange', 'track_change']);
// no track_change: it can arrive after the new track's fade-in has started
const CANCELS_FADE = new Set(['seeking', 'jump', 'ad_start', 'ad_end', 'emptied', 'loadstart']);
const QUIET_GUARD_DIAGS = ['volumechange', 'durationchange', 'loadedmetadata', 'loadstart'];

function attachTempoKey(pl: Player, s: PlaySession, snap: Record<string, unknown>, final: boolean): void {
  if (final || pl.flushes % TK_EVERY_FLUSHES === 0) {
    try {
      const p = tkPayload(pl, s.videoId);
      if (p) snap.tk = p;
    } catch (e) {
      noteError(pl, e);
    }
  }

  const tk = pl.tk;

  if (final && tk && tk.vid === s.videoId && tk.mx?.length) {
    snap.mx = { f: tk.mx };
    tk.mx = null;
  }
}

export function flush(pl: Player, final: boolean): void {
  const s = pl.session;
  if (!s || s.accepted === 0 || !s.save || !pl.settings.saveAnalysis) return;
  const cfg = s.yt || audioConfigFor(pl, s.videoId) || NO_AUDIO_CONFIG;
  const extra = { sessionId: pl.sessionId, final, ytPerceptualLoudnessDb: cfg.pLd, ytLoudnessTargetLkfs: cfg.target };
  const snap = pl.A.sessionSnapshot(s, Object.assign(extra, s.meta || {}));

  try {
    snap.applied = appliedFor(pl, s);
  } catch (e) {
    noteError(pl, e);
  }

  pl.flushes++;
  attachTempoKey(pl, s, snap, final);
  post(pl, 'snapshot', snap);
  pl.framesSinceFlush = 0;
}

export function startSession(pl: Player, vid: string): PlaySession {
  if (pl.session) flush(pl, true);
  const startedAt = Date.now();
  const s: PlaySession = Object.assign(pl.A.createSession(vid, playerDuration(pl)), {
    save: !!pl.settings.saveAnalysis,
    startedAt,
  });
  pl.session = s;
  pl.trOut[vid] = undefined;
  if ((pl.trIn[vid]?.wall ?? Infinity) < startedAt - 30000) pl.trIn[vid] = undefined;
  pl.sessionId = `${vid}:${String(startedAt)}`;
  pl.framesSinceFlush = 0;
  pl.flushes = 0;
  tkReset(pl, vid);

  return s;
}

export function addAccepted(pl: Player, s: PlaySession, fr: AcceptedFrame, peak: number): void {
  pl.A.addFrame(s, fr.ct, fr.raw, peak, fr.contiguous);

  try {
    tkAdd(pl, fr);
    mxAdd(pl, fr);
  } catch (e) {
    noteError(pl, e);
  }

  pl.framesSinceFlush++;
}

function extendGuard(pl: Player, reason: string, until: number): void {
  const head = pl.head;

  if (SOFT_GUARDS.has(reason)) {
    pl.softGuardUntil = Math.max(pl.softGuardUntil, until);

    if (head && (reason === 'emptied' || reason === 'loadstart')) {
      head.prevCt = null;
      head.pending = [];
    }
  } else if ((reason === 'volumechange' || reason === 'jump') && head && head.prevCt === null) {
    // YouTube sets its normalization volume while loading; the position drops to 0 on the source swap
    pl.softGuardUntil = Math.max(pl.softGuardUntil, until);
  } else {
    pl.hardGuardUntil = Math.max(pl.hardGuardUntil, until);
    if (reason === 'ad_start' || reason === 'ad_end') pl.adGuardUntil = Math.max(pl.adGuardUntil, until);
    if (head) head.killed = true;
  }
}

export function guard(pl: Player, reason: string): void {
  const ctx = pl.ctx;
  if (!ctx) return;
  const until = ctx.currentTime + GUARD_SEC;
  extendGuard(pl, reason, until);
  pl.status.lastGuard = reason;
  if (CANCELS_FADE.has(reason)) releaseFade(pl, reason);
  if (__FADEWISE_VERIFY__ && !QUIET_GUARD_DIAGS.includes(reason))
    post(pl, 'diag', {
      kind: 'guard',
      reason,
      until: round(until, 3),
      ct: pl.video ? round(pl.video.currentTime, 2) : null,
      vid: playerVideoId(pl),
    });
}

function headDecision(pl: Player, f: Frame, v: HTMLVideoElement, ct: number): string {
  const head = pl.head;
  if (!head) return 'reject';

  try {
    return pl.A.headFrameDecision({
      ad: false,
      adRecent: f.t < pl.adGuardUntil,
      killed: head.killed,
      paused: v.paused,
      ct,
      prevCt: head.prevCt,
      dt: head.prevT === null ? null : f.t - head.prevT,
      rate: v.playbackRate,
      videoDuration: v.duration,
      playerDuration: playerDuration(pl),
    });
  } catch (e) {
    noteError(pl, e);

    return 'reject';
  }
}

export function headFrame(
  pl: Player,
  f: Frame,
  v: HTMLVideoElement,
  vid: string,
  ct: number,
  raw: number,
  rawPeak: number,
) {
  const head = pl.head;
  if (!head || head.vid !== vid || head.killed) return 'guard';
  const d = headDecision(pl, f, v, ct);

  if (d === 'reject') {
    head.killed = true;
    head.pending = [];

    return 'guard';
  }

  if (d === 'wait') {
    if (head.prevCt !== null) head.prevT = f.t;

    return 'guard';
  }

  head.prevCt = ct;
  head.prevT = f.t;
  if (f.n > 0) head.pending.push([ct, raw, rawPeak, f.fx, f.cr, v.playbackRate, f.bd]);

  return 'head';
}

export function commitHead(pl: Player): void {
  const h = pl.head;
  if (!h) return;
  pl.head = null;
  const s = pl.session;
  if (h.killed || !h.pending.length || !s || s.videoId !== h.vid) return;
  let contiguous = false;

  for (const [ct, raw, peak, fx, cr, rate, bd] of h.pending) {
    addAccepted(pl, s, { vid: h.vid, ct, raw, fx, cr, bd, contiguous, rate }, peak);
    contiguous = true;
  }

  pl.prevAccepted = true;
  if (__FADEWISE_VERIFY__)
    post(pl, 'diag', {
      kind: 'head_committed',
      vid: h.vid,
      frames: h.pending.length,
      from: round(h.pending[0][0], 2),
      to: round(h.pending[h.pending.length - 1][0], 2),
    });
}

export function noteLoad(pl: Player, f: Frame): void {
  if (f.pMs === undefined || !Number.isFinite(f.pMs)) return;
  const load = pl.load;
  load.frames++;
  load.fxMs += f.fxMs || 0;
  load.pMs += f.pMs;
  if (f.pMs > load.maxPMs) load.maxPMs = f.pMs;
  pl.status.workletLoad = {
    frames: load.frames,
    fxMsPerFrame: round(load.fxMs / load.frames, 3),
    totalMsPerFrame: round(load.pMs / load.frames, 3),
    maxMsPerFrame: round(load.maxPMs, 2),
  };
}
