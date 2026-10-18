import { isNum, round, obj } from './util.mts';

export const MIN_COVERAGE_FOR_GAIN = 0.3;

export type GainLimit = 'no_peak' | 'peak' | 'max_boost' | 'max_cut' | null;
export interface Gain {
  gainDb: number;
  source: 'analysis' | 'youtube' | 'none';
  audibleLufs: number | null;
  limit: GainLimit;
  ytNormDb?: number;
  wantedDb?: number;
  targetLufs?: number;
}

// YouTube's normalization only attenuates.
export function computeGain(p: unknown): Gain {
  const o = obj(p) || {};
  const ytTarget = isNum(o.ytTarget) ? o.ytTarget : -7;
  const target = isNum(o.targetLufs) ? o.targetLufs : -14;
  const maxBoost = isNum(o.maxBoostDb) ? Math.max(0, o.maxBoostDb) : 6;
  const maxCut = isNum(o.maxCutDb) ? Math.max(0, o.maxCutDb) : 24;
  let raw: number | null = null,
    source: Gain['source'] = 'none';

  if (isNum(o.ownLufs) && isNum(o.ownCoverage) && o.ownCoverage >= MIN_COVERAGE_FOR_GAIN) {
    raw = o.ownLufs;
    source = 'analysis';
  } else if (isNum(o.pLd)) {
    raw = o.pLd;
    source = 'youtube';
  }

  if (raw === null) return { gainDb: 0, source, audibleLufs: null, limit: null };
  const ytNormDb = Math.min(0, ytTarget - (isNum(o.pLd) ? o.pLd : raw));
  const audible = raw + ytNormDb;
  const wanted = target - audible;
  let want = wanted;
  let limit: GainLimit = null;

  if (want > 0) {
    const peakDb = isNum(o.peakDb) ? o.peakDb : null;
    const measured = peakDb !== null && source === 'analysis';
    const headroom = measured ? -1 - (peakDb + ytNormDb) : 0;
    want = Math.max(0, Math.min(want, maxBoost, headroom));
    if (want < wanted) limit = !measured ? 'no_peak' : headroom <= maxBoost ? 'peak' : 'max_boost';
  } else {
    want = Math.max(want, -maxCut);
    if (want > wanted) limit = 'max_cut';
  }

  return {
    gainDb: round(want, 2),
    source,
    audibleLufs: round(audible, 2),
    ytNormDb: round(ytNormDb, 2),
    wantedDb: round(wanted, 2),
    targetLufs: target,
    limit,
  };
}

export function dbToLinear(db: unknown): number {
  const g = isNum(db) ? Math.pow(10, db / 20) : 1;

  return Math.min(2, Math.max(0.0625, g));
}
