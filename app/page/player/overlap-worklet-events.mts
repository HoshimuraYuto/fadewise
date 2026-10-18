import { rushEnd } from './head-rush.mts';
import { ovDiag, ovHandGain, overlapNote } from './overlap-core.mts';
import { ovRoute } from './overlap-graph.mts';
import { restoreRate } from './rate.mts';
import { ovIdle, type Player } from './state.mts';
import type { OvEvent } from './types.mts';

const listOf = (x: unknown, n: number) => (Array.isArray(x) ? x.slice(0, n) : null);

function workletReport(d: OvEvent): Record<string, unknown> {
  return {
    at: Date.now(),
    silentWins: d.silentWins,
    wins: d.wins,
    minOutDb: d.minOutDb,
    outClicks: d.outClicks,
    inClicks: d.inClicks,
    maxOutClick: d.maxOutClick,
    maxInClick: d.maxInClick,
    why: d.why,
    aheadSec: d.aheadSec,
    inSilentWins: d.inSilentWins,
    handoverSec: d.handoverSec,
    lowWins: d.lowWins,
    lowBoth: d.lowBoth,
    lowBothRaw: d.lowBothRaw,
    style: d.style,
    sumCutDb: d.sumCutDb,
    silentAt: listOf(d.silentAt, 12),
    outAt: listOf(d.outAt, 12),
    inAt: listOf(d.inAt, 24),
  };
}

function onDrained(pl: Player, d: OvEvent, vid: string | null): void {
  const recent = pl.recent.tr && pl.recent.tr.from === vid ? pl.recent.tr : null;
  ovHandGain(pl, 0);
  if (vid) overlapNote(pl, vid, { state: d.killed ? 'cancelled' : 'done' });
  if (pl.fade && pl.fade.vid === vid && pl.ov.fadeOut) pl.fade.outResult = 'done';
  if (recent && d.killed) recent.overlapCancel = 'dropped';
  ovDiag(pl, 'drained', { killed: !!d.killed });
  pl.ov = ovIdle();
  restoreRate(pl);
  ovRoute(pl, false);
}

function onTiming(pl: Player, d: OvEvent, vid: string): void {
  const recent = pl.recent.tr && pl.recent.tr.from === vid ? pl.recent.tr : null;

  if (d.ev === 'drain') {
    if (pl.ctx && typeof d.leadOutSec === 'number') pl.sw.drainEnd = pl.ctx.currentTime + d.leadOutSec;
    overlapNote(pl, vid, { leadOutSec: d.leadOutSec });
    if (recent) recent.leadOutSec = d.leadOutSec;
  } else if (d.ev === 'newSound') {
    pl.ov.newSoundAt = pl.ctx ? pl.ctx.currentTime : 0;
    overlapNote(pl, vid, { xfSec: d.xfSec, swapSec: d.swapSec });
    if (recent) recent.overlapSec = d.xfSec;
  } else if (d.ev === 'flush') overlapNote(pl, vid, { lostSec: d.lostSec });
}

export function onOvEvent(pl: Player, d: OvEvent): void {
  const vid = pl.ov.vid;

  if (d.ev === 'inSound') {
    pl.ov.inSound = true;
    if (pl.rush?.mode === 'overlap') rushEnd(pl, 'sound');
  }

  if (d.ev === 'drained' && pl.ov.state === 'drain') onDrained(pl, d, vid);
  else if (d.ev === 'report') {
    const last = workletReport(d);
    pl.status.overlapLast = last;
    ovDiag(pl, 'report', last);
  } else if (vid && d.ev !== 'drained') onTiming(pl, d, vid);

  if (__FADEWISE_VERIFY__ && d.ev && d.ev !== 'report') ovDiag(pl, 'w_' + d.ev, { w: d });
}
