import { DURATION_MATCH_SEC } from './common.mts';
import type { Player } from './state.mts';
import type { MoviePlayer } from './types.mts';

export const NO_AUDIO_CONFIG: { pLd?: number | null; target?: number | null } = {};

export const moviePlayer = (pl: Player): MoviePlayer | null => pl.doc.getElementById('movie_player');

export function playerVideoId(pl: Player): string | null {
  try {
    return moviePlayer(pl)?.getVideoData?.()?.video_id || null;
  } catch {
    return null;
  }
}

// The element's duration is the ad's while an ad plays.
export function playerDuration(pl: Player): number | null {
  try {
    const d = moviePlayer(pl)?.getDuration?.();

    return d !== undefined && d > 0 ? d : null;
  } catch {
    return null;
  }
}

export function isAdNow(pl: Player): boolean {
  const mp = moviePlayer(pl);
  if (!mp) return false;
  if (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting')) return true;
  const pd = playerDuration(pl);
  const v = pl.video;

  return !!(v && Number.isFinite(v.duration) && pd && Math.abs(v.duration - pd) > DURATION_MATCH_SEC);
}

export function audioConfigFor(pl: Player, vid: string): { pLd: number | null; target: number | null } | null {
  try {
    const r = moviePlayer(pl)?.getPlayerResponse?.();
    if (!r?.videoDetails || r.videoDetails.videoId !== vid) return null;
    const c = r.playerConfig?.audioConfig;
    if (!c) return null;

    return {
      pLd: Number.isFinite(c.perceptualLoudnessDb) ? (c.perceptualLoudnessDb as number) : null,
      target: Number.isFinite(c.loudnessTargetLkfs) ? (c.loudnessTargetLkfs as number) : null,
    };
  } catch {
    return null;
  }
}

// The player bar shows the ad's title for a moment after an ad.
export function trackMeta(pl: Player, vid: string): ReturnType<Player['A']['pickTrackMeta']> | null {
  try {
    return pl.A.pickTrackMeta(moviePlayer(pl)?.getVideoData?.(), vid);
  } catch {
    return null;
  }
}

export function sameStoredTrack(pl: Player, vid: string): boolean {
  const e = pl.index[vid];
  const v = pl.video;
  if (!v || !e || !Number.isFinite(e.d) || !Number.isFinite(v.duration)) return false;

  return Math.abs(v.duration - (e.d as number)) <= DURATION_MATCH_SEC && !isAdNow(pl);
}
