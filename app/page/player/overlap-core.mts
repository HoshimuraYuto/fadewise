import { ctxTime, post, pushOvLog, RAMP_SEC, setParam, videoTime } from './common.mts';
import type { Player } from './state.mts';
import { trNote } from './transition.mts';
import type { OverlapNote } from './types.mts';
import { playerVideoId } from './youtube.mts';

export const OV_DRAIN_LIMIT_SEC = 6;
const OV_RESTORE_SEC = 0.05;

export const ovWanted = (pl: Player): boolean =>
  !!(pl.settings.overlap && pl.settings.transitions && pl.detachedAt === null);

export const ovParam = (pl: Player, name: string): AudioParam | null => pl.ovNode?.parameters.get(name) ?? null;

export function ovDiag(pl: Player, kind: string, extra?: Record<string, unknown> | null): void {
  if (!__FADEWISE_VERIFY__) return;
  const { video, ov } = pl;
  const detail = extra?.w ? extra.w : kind.startsWith('rush') ? extra : null;
  pushOvLog(pl, [kind, ctxTime(pl, 4), videoTime(pl, 3), ov.state, detail]);
  const base = {
    kind: 'ov_' + kind,
    state: ov.state,
    vid: playerVideoId(pl),
    ct: videoTime(pl, 3),
    at: ctxTime(pl, 3),
    rate: video ? video.playbackRate : null,
    pp: video ? video.preservesPitch : null,
  };
  post(pl, 'diag', Object.assign(base, extra || {}));
}

export function overlapNote(pl: Player, vid: string, patch: OverlapNote): void {
  trNote(pl, vid, { overlap: Object.assign({}, pl.trOut[vid]?.overlap, patch) });
}

export function ovHoldsGain(pl: Player, db: number): boolean {
  const kB = ovParam(pl, 'kB');
  if (pl.ov.state !== 'drain' || !kB) return false;
  pl.ov.pendingDb = db;
  setParam(pl, kB, pl.A.dbToLinear(db) / pl.A.dbToLinear(pl.ov.oldDb), RAMP_SEC);

  return true;
}

export function ovHandGain(pl: Player, dur: number): void {
  const db = pl.ov.pendingDb;
  setParam(pl, ovParam(pl, 'kB'), 1, dur);
  setParam(pl, ovParam(pl, 'gOld'), 1, dur + OV_RESTORE_SEC);
  if (db !== null && pl.gainNode) setParam(pl, pl.gainNode.gain, pl.A.dbToLinear(db), dur);
}
