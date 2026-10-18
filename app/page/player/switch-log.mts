import type { Player } from './state.mts';

const SW_KEEP = 5;
const SW_WAIT_SEC = 15;

function overlapCancelReason(pl: Player): string | null {
  const c = pl.status.overlapCancel as { at?: number; reason?: string } | null | undefined;

  return c && typeof c.at === 'number' && Date.now() - c.at < 30000 ? (c.reason ?? null) : null;
}

function closeSwitch(pl: Player, firstAt: number | null): void {
  const sw = pl.sw;
  const open = sw.open;
  sw.open = null;
  if (!open) return;
  const remainderEnd = sw.drainEnd !== null && sw.drainEnd > open.t0 - 1 ? sw.drainEnd - open.t0 : null;
  sw.drainEnd = null;
  const firstSec = firstAt === null ? null : firstAt - open.t0;
  const rec = pl.A.finishSwitch(open.rec, firstSec, remainderEnd, overlapCancelReason(pl));
  if (sw.beat && sw.beat.at > open.t0 - 1) Object.assign(rec, { beat: sw.beat.why, beatMiss: sw.beat.miss ?? null });
  sw.beat = null;
  sw.list.push(rec);
  if (sw.list.length > SW_KEEP) sw.list.splice(0, sw.list.length - SW_KEEP);
  pl.status.switches = sw.list.slice();
}

function isLoud(pl: Player, vid: string, raw: number, rawPeak: number): boolean {
  const stored = pl.index[vid]?.l;
  if (Number.isFinite(stored)) return raw > 0 && pl.A.energyToLufs(raw) >= (stored as number) - 30;

  return rawPeak > Math.pow(10, pl.A.SILENCE_DBFS / 20);
}

function openSwitch(pl: Player, vid: string, t: number): void {
  const sw = pl.sw;
  const cur = sw.cur;
  if (!cur) return;
  if (sw.open) closeSwitch(pl, null);
  const own = sw.adv && sw.adv.vid === cur.vid && t - sw.adv.at < 10 ? sw.adv : null;
  const t0 = own ? own.at : t;
  const lastLoudSec = cur.loudAt === null ? null : cur.loudAt - t0;
  sw.open = { to: vid, t0, rec: pl.A.switchRecord(own ? own.plan : null, lastLoudSec) };
  sw.adv = null;
}

export function swFrame(
  pl: Player,
  vid: string | null,
  ct: number,
  t: number,
  raw: number,
  rawPeak: number,
  ad: boolean,
) {
  const sw = pl.sw;
  if (sw.open && t - sw.open.t0 > SW_WAIT_SEC) closeSwitch(pl, null);
  if (ad || !vid) return;
  const loud = isLoud(pl, vid, raw, rawPeak);
  if (sw.cur && sw.cur.vid !== vid) openSwitch(pl, vid, t);
  if (!sw.cur || sw.cur.vid !== vid) sw.cur = { vid, loudAt: null };
  if (loud) sw.cur.loudAt = t;
  const open = sw.open;
  if (!open || open.to !== vid || ct <= 0.02) return;
  if (open.rec.playSec === null) open.rec.playSec = +(t - open.t0).toFixed(2);
  if (loud) closeSwitch(pl, t);
}
