import type { Applied } from '../../shared/analysis.mts';
import type { Player } from './state.mts';
import type { FadeState, PlaySession, TrackGain } from './types.mts';

type AppliedOut = Partial<Record<keyof Applied, unknown>>;

function gainApplied(track: TrackGain | null, vid: string) {
  const d = track && track.vid === vid ? track.decided : null;
  if (!d) return null;

  return {
    db: d.gainDb,
    source: d.source,
    limit: d.limit,
    wantedDb: d.wantedDb,
    audibleLufs: d.audibleLufs,
    ytNormDb: d.ytNormDb,
    targetLufs: d.targetLufs,
    ownLufs: d.ownLufs,
    pLd: d.pLd,
    peakDb: d.peakDb,
  };
}

function fadesApplied(pl: Player, f: FadeState, out: AppliedOut): void {
  const p = f.plan;
  if (p?.fadeIn) out.fadeIn = { done: f.fadeInDone, fromDb: p.fadeIn.fromDb, durSec: p.fadeIn.durSec };
  if (!p?.fadeOut) return;
  const state = f.outResult || (pl.settings.fadesEnabled ? 'not_reached' : 'off');
  out.fadeOut = { state, cancel: f.outCancel, startSec: p.fadeOut.startPos, endSec: p.fadeOut.endPos, align: p.align };
}

function transitionApplied(pl: Player, vid: string) {
  const o = pl.trOut[vid];
  if (!o?.kind) return undefined;

  return {
    kind: o.kind,
    reason: o.reason,
    state: o.state,
    cancel: o.cancel || o.cancelAfter || null,
    planSec: o.planSec,
    atSec: o.atSec,
    skipSec: o.skipSec,
    wash: !!o.wash,
    pair: o.pair || null,
    overlap: o.overlap || null,
    mix: o.mix || null,
  };
}

function incomingApplied(pl: Player, vid: string, startedAt: number) {
  const i = pl.trIn[vid];
  if (!i || i.wall < startedAt - 30000) return undefined;

  return {
    fadeIn: i.fadeIn,
    headTrimTo: i.headTrimTo,
    headReason: i.headReason,
    cancel: i.cancel || null,
    overlap: !!i.overlap,
  };
}

function appliedNow(pl: Player, vid: string, startedAt: number): AppliedOut {
  const out: AppliedOut = {
    at: startedAt,
    gain: gainApplied(pl.track, vid),
    fadeIn: null,
    fadeOut: null,
    skipAtSec: null,
  };
  const f = pl.fade && pl.fade.vid === vid ? pl.fade : null;
  if (f) fadesApplied(pl, f, out);
  const transition = transitionApplied(pl, vid);
  if (transition) out.transition = transition;
  const incoming = incomingApplied(pl, vid, startedAt);
  if (incoming) out.incoming = incoming;

  return out;
}

// kept on the session because the next track's events can come first
export function appliedFor(pl: Player, s: PlaySession): Record<string, unknown> {
  const cur = appliedNow(pl, s.videoId, s.startedAt);
  const last = s.lastApplied || {};
  const out = {
    at: s.startedAt,
    gain: cur.gain || last.gain || null,
    fadeIn: cur.fadeIn || last.fadeIn || null,
    fadeOut: cur.fadeOut || last.fadeOut || null,
    skipAtSec: cur.skipAtSec ?? last.skipAtSec ?? null,
    transition: cur.transition || last.transition || null,
    incoming: cur.incoming || last.incoming || null,
  };
  s.lastApplied = out;

  return out;
}
