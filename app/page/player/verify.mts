import { ovLog, post, round } from './common.mts';
import type { Player } from './state.mts';
import type { Frame } from './types.mts';

const METER_LOG_FRAMES = 6000;

type PlaybackStats = { underrunEvents?: number; underrunDuration: number };

// AudioContext.playbackStats is Chrome-only and not in lib.dom
function noteUnderruns(pl: Player, v: HTMLVideoElement, c: AudioContext, now: number): void {
  const { win } = pl;

  try {
    const stats = (c as AudioContext & { playbackStats?: PlaybackStats }).playbackStats;
    const count = stats ? stats.underrunEvents : null;
    if (!stats || count === null || count === undefined || count === (win.__fadewiseUnder || 0)) return;
    const detail = {
      n: count - (win.__fadewiseUnder || 0),
      durMs: round(stats.underrunDuration * 1000, 1),
      rate: v.playbackRate,
    };
    ovLog(pl).push(['underrun', round(now, 4), round(v.currentTime, 3), pl.ov.state, detail]);
    win.__fadewiseUnder = count;
  } catch {
    /* not available */
  }
}

export function probe(pl: Player, f: Frame, v: HTMLVideoElement, c: AudioContext, now: number): void {
  if (Array.isArray(f.st) && f.st.length) {
    const log = (pl.win.__fadewiseProbe ??= []);
    const where = [pl.ov.state, pl.tr.state, v.playbackRate, v.preservesPitch, round(v.currentTime, 3)];
    for (const s of f.st) log.push(s.concat(where));
    if (log.length > 2000) log.splice(0, log.length - 2000);
  }

  noteUnderruns(pl, v, c, now);
}

export interface MeterLogEntry {
  f: Frame;
  ct: number;
  vid: string | null;
  ad: boolean;
  state: string;
}

export function logMeter(pl: Player, e: MeterLogEntry): void {
  const { f } = e;
  const log = (pl.win.__fadewiseMeterLog ??= []);
  log.push({
    t: round(f.t, 3),
    ct: round(e.ct, 3),
    vid: e.ad ? null : e.vid,
    ad: e.ad,
    state: e.state,
    e: f.e,
    p: f.p,
    e2: f.e2,
    p2: f.p2,
    g: pl.gainNode ? pl.gainNode.gain.value : null,
    fg: pl.fadeNode ? pl.fadeNode.gain.value : null,
    vis: pl.doc.visibilityState,
    fx: Array.isArray(f.fx) ? f.fx.map((x) => +x.toPrecision(3)) : null,
  });
  if (log.length > METER_LOG_FRAMES) log.splice(0, log.length - METER_LOG_FRAMES);
}

export function diagFirstSound(pl: Player, f: Frame, vid: string, ct: number): void {
  const track = pl.track;
  if (!__FADEWISE_VERIFY__ || !track) return;
  const d = track.decided;
  post(pl, 'diag', {
    kind: 'first_sound',
    vid,
    frameEnd: round(f.t, 3),
    gainAppliedAt: track.appliedAt !== null ? round(track.appliedAt, 3) : null,
    gainValue: pl.gainNode ? round(pl.gainNode.gain.value, 4) : null,
    gainDb: d ? d.gainDb : null,
    source: d ? d.source : null,
    audibleLufs: d ? d.audibleLufs : null,
    ct: round(ct, 2),
  });
}
