import { noteError, post, RAMP_SEC, round } from './common.mts';
import { releaseFade } from './fades.mts';
import { ovHoldsGain } from './overlap-core.mts';
import { ovBoundary, ovCancel } from './overlap-events.mts';
import { isExcluded, type Player } from './state.mts';
import type { GainDecision } from './types.mts';
import { audioConfigFor, isAdNow, NO_AUDIO_CONFIG, playerVideoId } from './youtube.mts';

function decideGain(pl: Player, vid: string): GainDecision {
  const cfg = audioConfigFor(pl, vid) || NO_AUDIO_CONFIG;
  const rec = pl.index[vid] || {};
  const pLd = Number.isFinite(cfg.pLd) ? cfg.pLd : Number.isFinite(rec.y) ? (rec.y as number) : null;
  const d = pl.A.computeGain({
    ownLufs: rec.l,
    ownCoverage: rec.c,
    peakDb: rec.p,
    pLd,
    ytTarget: cfg.target,
    targetLufs: pl.settings.targetLufs,
    maxBoostDb: pl.settings.maxBoostDb,
  });
  const fromAnalysis = d.source === 'analysis';

  return Object.assign(d, { ownLufs: fromAnalysis ? rec.l : null, pLd, peakDb: fromAnalysis ? rec.p : null });
}

function rampTo(pl: Player, db: number): void {
  const { gainNode, ctx } = pl;
  if (!gainNode || !ctx) return;
  if (ovHoldsGain(pl, db)) return;
  const now = ctx.currentTime;
  const g = gainNode.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(pl.A.dbToLinear(db), now + RAMP_SEC);
}

// no ramp: it would leave the first ad frame at the track's gain
export function unityNow(pl: Player): void {
  const { gainNode, ctx } = pl;
  if (!gainNode || !ctx) return;
  const now = ctx.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(1, now);
}

function gainForAd(pl: Player): void {
  ovCancel(pl, 'ad');
  pl.track = null;
  unityNow(pl);
  releaseFade(pl, 'ad');
  pl.status.appliedGainDb = 0;
  pl.status.gainSource = 'ad';
}

function chooseGain(pl: Player, vid: string): GainDecision {
  try {
    if (isExcluded(pl, vid)) return { gainDb: 0, source: 'excluded' };

    return pl.settings.gainEnabled ? decideGain(pl, vid) : { gainDb: 0, source: 'off' };
  } catch (e) {
    noteError(pl, e);

    return { gainDb: 0, source: 'error' };
  }
}

function diagGain(pl: Player, ctx: AudioContext, vid: string, reason: string, d: GainDecision): void {
  if (!__FADEWISE_VERIFY__) return;
  post(pl, 'diag', {
    kind: 'gain',
    vid,
    reason,
    gainDb: d.gainDb,
    source: d.source,
    audibleLufs: d.audibleLufs,
    at: round(ctx.currentTime, 3),
  });
}

export function applyGainFor(pl: Player, reason: string): void {
  const { gainNode, ctx } = pl;
  if (!gainNode || !ctx) return;

  if (isAdNow(pl)) {
    gainForAd(pl);

    return;
  }

  const vid = playerVideoId(pl);
  if (!vid) return;
  // YTM reports the next id a frame before the source changes
  if (pl.ov.state === 'capture' && pl.ov.vid && pl.ov.vid !== vid) ovBoundary(pl, 'vid');
  if (!pl.track || pl.track.vid !== vid)
    pl.track = { vid, locked: false, firstSoundAt: null, decided: null, appliedAt: null };
  const track = pl.track;
  if (track.locked) return;
  const d = chooseGain(pl, vid);

  if (!track.decided || track.decided.gainDb !== d.gainDb || track.decided.source !== d.source) {
    rampTo(pl, d.gainDb);
    track.decided = d;
    track.appliedAt = ctx.currentTime;
    diagGain(pl, ctx, vid, reason, d);
  }

  pl.status.appliedGainDb = d.gainDb;
  pl.status.gainSource = d.source;
}
