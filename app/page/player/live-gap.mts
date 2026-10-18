import { round } from './common.mts';
import type { Player } from './state.mts';
import { advance } from './transition-advance.mts';
import { armTransition, endTransition, trDiag, trNote } from './transition.mts';
import type { FadeState } from './types.mts';
import { isAdNow, playerDuration } from './youtube.mts';

const LIVE_REASONS = new Set(['no_analysis', 'no_ending']);

export function liveEligible(pl: Player, f: FadeState | null): boolean {
  const tp = f?.tplan;

  return !!pl.settings.transitions && !!pl.fadeNode && !!tp && tp.kind === 'none' && LIVE_REASONS.has(tp.reason);
}

function refreshSessionLufs(pl: Player, vid: string, now: number): void {
  const { session, gap } = pl;
  if (!session || session.videoId !== vid || now - gap.lufsAt <= 1) return;
  gap.lufsAt = now;

  try {
    gap.lufs = pl.A.sessionIntegratedLufs(session);
  } catch {
    gap.lufs = null;
  }
}

function armLive(pl: Player, vid: string, now: number, remain: number): void {
  armTransition(pl, vid, 'live_trim', now, true);
  trNote(pl, vid, {
    kind: 'live_trim',
    reason: 'live_silence',
    state: 'armed',
    atSec: null,
    skipSec: null,
    planSec: null,
    pair: null,
  });
  trDiag(pl, 'armed', { trKind: 'live_trim', remain: round(remain, 2) });
}

function advanceLive(pl: Player, v: HTMLVideoElement, f: FadeState, ct: number, now: number, dur: number): void {
  const vid = f.vid;
  if (pl.tr.state === 'idle') armTransition(pl, vid, 'live_trim', now, true);
  const s = pl.session;
  // the skipped part was measured silent, so this listen counts as heard to the end
  if (s && s.videoId === vid && s.lastAcceptedPos !== null && ct - s.lastAcceptedPos < 0.35) s.reachedEnd = true;
  advance(pl, v, f, ct, now, { skipSec: round(dur - ct, 2) });
}

export function liveTick(pl: Player, v: HTMLVideoElement, f: FadeState, ct: number, now: number): void {
  const vid = f.vid;
  let st = pl.gap.st;

  if (pl.gap.vid !== vid || !st) {
    st = pl.A.liveGapState();
    pl.gap = { vid, st, lufsAt: -1, lufs: null };
  }

  refreshSessionLufs(pl, vid, now);
  const dur = playerDuration(pl) || v.duration;
  const step = pl.A.liveGapStep(st, {
    ct,
    lufs: pl.frameIn.lufs,
    duration: dur,
    contiguous: pl.frameIn.ok,
    sessionLufs: Number.isFinite(pl.gap.lufs) ? pl.gap.lufs : null,
  });
  const { tr } = pl;

  if (step === 'arm' && tr.state === 'idle') armLive(pl, vid, now, dur - ct);
  else if (step === 'reset' && tr.state === 'armed' && tr.live) {
    trNote(pl, vid, { state: 'cancelled', cancel: 'sound' });
    endTransition(pl, 'cancelled', 'sound');
  } else if (step === 'late' && tr.state === 'armed' && tr.live) {
    f.trDone = true;
    trNote(pl, vid, { state: 'skipped', cancel: 'not_reached' });
    endTransition(pl, 'skipped', 'not_reached');
  } else if (step === 'advance' && !isAdNow(pl) && !v.paused) advanceLive(pl, v, f, ct, now, dur);
}
