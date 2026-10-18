import { DURATION_MATCH_SEC, round, safe } from './common.mts';
import { ovBeatLanded } from './overlap-beat.mts';
import { ovDiag } from './overlap-core.mts';
import { ppPreWanted, setRate } from './rate.mts';
import type { Player } from './state.mts';
import { startTrFadeIn } from './transition.mts';
import type { Rush } from './types.mts';
import { isAdNow } from './youtube.mts';

// Chrome mutes audio above 16x playbackRate
export const HEAD_RUSH_RATE = 3;
const HEAD_RUSH_MARGIN_SEC = 0.25;
const HEAD_RUSH_WALL_SEC = 2.5;
const RUSH_GATE_SEC = 0.04;

// setTimeout fires late, so the rush ends 30 ms early
export function scheduleRushEnd(pl: Player, r: Rush, leftSec: number): void {
  r.timer = pl.win.setTimeout(
    safe(pl, () => {
      rushEnd(pl, 'pos');
    }),
    Math.max(0, leftSec * 1000 - 30),
  );
}

export function rushStart(pl: Player, vid: string, until: number | null, mode: Rush['mode']): boolean {
  const { video, ctx } = pl;
  if (!video || !ctx || isAdNow(pl) || video.paused || video.playbackRate !== 1 || pl.rush) return false;
  const ct = video.currentTime;
  if (until !== null && until - ct < 0.15) return false;
  if (mode === 'overlap' && !pl.ovNode) return false;
  const r: Rush = { vid, until, mode, ct0: ct, t0: ctx.currentTime, pp0: video.preservesPitch, from: pl.tr.fromVid };
  pl.rush = r;
  if (mode === 'overlap') pl.ovNode?.port.postMessage({ cmd: 'gate', on: true });
  setRate(pl, HEAD_RUSH_RATE, false);
  if (until !== null) scheduleRushEnd(pl, r, (until - ct) / HEAD_RUSH_RATE);
  r.limit = pl.win.setTimeout(
    safe(pl, () => {
      rushEnd(pl, 'limit');
    }),
    HEAD_RUSH_WALL_SEC * 1000,
  );
  ovDiag(pl, 'rush', { until, mode, from: round(ct, 3) });

  return true;
}

function noteRush(pl: Player, r: Rush, why: string, to: number | null): Record<string, unknown> {
  const info = {
    why,
    fromSec: round(r.ct0, 2),
    toSec: to === null ? null : round(to, 2),
    wallSec: pl.ctx ? round(pl.ctx.currentTime - r.t0, 3) : null,
  };
  const inc = pl.trIn[r.vid];
  if (inc) inc.headRush = info;
  const recent = pl.recent.tr;
  if (recent && recent.from === r.from && to !== null) recent.headTrimSec = round(to - r.ct0, 1);

  return info;
}

export function rushEnd(pl: Player, why: string, rateSetByOther?: boolean): void {
  const r = pl.rush;
  if (!r) return;
  pl.rush = null;
  pl.win.clearTimeout(r.timer);
  pl.win.clearTimeout(r.limit);
  const { video, ovNode } = pl;
  if (!rateSetByOther && video && video.playbackRate === HEAD_RUSH_RATE)
    setRate(pl, 1, !(pl.ppPre && ppPreWanted(pl)) && r.pp0);
  // the media element's output lags a rate change by its buffer
  if (r.mode === 'overlap' && ovNode) ovNode.port.postMessage({ cmd: 'gate', on: false, delay: RUSH_GATE_SEC });
  const to = video ? video.currentTime : null;
  ovDiag(pl, 'rush_end', noteRush(pl, r, why, to));
  if (r.mode === 'overlap') ovBeatLanded(pl, why, to);
  if (r.mode === 'plain' && pl.tr.state === 'trimming' && !['pause', 'seek', 'ad', 'source'].includes(why))
    startTrFadeIn(pl, r.vid, 'rush_' + why);
}

// pos null: stop at the worklet's first input sample; null: no rush
export function headUntil(pl: Player, v: HTMLVideoElement, vid: string): { pos: number | null; why: string } | null {
  const e = pl.index[vid];
  if (!e?.fx || !Number.isFinite(e.fs)) return { pos: null, why: e ? 'not_exact' : 'no_analysis' };
  const firstSound = e.fs as number;
  const sameLength =
    Number.isFinite(e.d) && Number.isFinite(v.duration) && Math.abs((e.d as number) - v.duration) <= DURATION_MATCH_SEC;
  if (!sameLength || firstSound < pl.A.HEAD_TRIM_MIN_SEC) return null;

  return { pos: round(firstSound - HEAD_RUSH_MARGIN_SEC, 2), why: 'exact' };
}

export function headMode(pl: Player): string {
  if (!__FADEWISE_VERIFY__) return 'default';
  const m = pl.win.__fadewiseHeadMode;

  return m === 'seek' || m === 'off' || m === 'rate' ? m : 'default';
}
