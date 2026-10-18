import type { BeatAlign } from '../../shared/analysis.mts';
import { HEAD_RUSH_RATE, scheduleRushEnd } from './head-rush.mts';
import { ovDiag, overlapNote } from './overlap-core.mts';
import type { Player } from './state.mts';
import type { BeatOutcome, Capture, Rush } from './types.mts';

function rushRun(pl: Player, vid: string, started: boolean, r: Rush | null) {
  if (!started || r?.mode !== 'overlap' || r.until === null) return null;
  const firstSound = pl.index[vid]?.fs;
  const latest = Number.isFinite(firstSound) ? (firstSound as number) - 0.2 : null;

  return { t0: r.t0, ct0: r.ct0, until: r.until, rate: HEAD_RUSH_RATE, latest };
}

function alignRush(pl: Player, b: BeatAlign, cap: Capture, vid: string, started: boolean, out: BeatOutcome): void {
  const { ctx, ov } = pl;
  const r = pl.rush;
  if (!ctx || !ov.vid) return;
  const run = rushRun(pl, vid, started, r);
  const aligned = run ? pl.A.alignedRushEnd(b, cap, run) : null;
  const held = __FADEWISE_VERIFY__ && pl.win.__fadewiseBeatAlign === false;

  if (!run || !r) out.why = 'no_rush';
  else if (!aligned) out.why = 'no_room';
  else if (held) out.why = 'held';
  else {
    pl.win.clearTimeout(r.timer);
    r.until = aligned.until;
    scheduleRushEnd(pl, r, (aligned.until - r.ct0) / HEAD_RUSH_RATE - (ctx.currentTime - r.t0));
    Object.assign(out, { on: true, why: 'aligned', shiftSec: aligned.shiftSec });
  }

  if (run) pl.ovBeat = { vid: ov.vid, out, align: b, cap };
  else pl.sw.beat = { at: ctx.currentTime, why: out.why, miss: null };
}

export function ovBeatAlign(pl: Player, vid: string, started: boolean): void {
  pl.ovBeat = null;
  const { ov, ctx } = pl;
  const style = ov.plan?.style;
  const b = style?.kind === 'blend' ? style.beat : null;
  if (!b || !ov.vid) return;
  const out: BeatOutcome = { on: false, why: b.why };
  if (!b.on && ctx) pl.sw.beat = { at: ctx.currentTime, why: b.why, miss: null };
  if (b.on && ov.cap) alignRush(pl, b, ov.cap, vid, started, out);
  overlapNote(pl, ov.vid, { beat: out });
  ovDiag(pl, 'beat', { ...out, until: pl.rush?.until ?? null });
}

export function ovBeatLanded(pl: Player, why: string, to: number | null): void {
  const o = pl.ovBeat;
  const ctx = pl.ctx;
  if (!o || !ctx || to === null) return;
  pl.ovBeat = null;
  if (why !== 'pos' && o.out.on) Object.assign(o.out, { on: false, why: why === 'sound' ? 'no_room' : 'rush_' + why });
  o.out.missBeats = pl.A.beatMissBeats(o.align, o.cap, to - ctx.currentTime);
  overlapNote(pl, o.vid, { beat: o.out });
  pl.sw.beat = { at: ctx.currentTime, why: o.out.why, miss: o.out.missBeats };
}
