import type { IndexEntry, MixKind } from '../types.mts';
import { CUT_IN_MIN_REL_LU } from './fades.mts';
import { HEAD_TRIM_MIN_SEC } from './head-trim.mts';
import { OVERLAP, HEAD_RUSH } from './overlap-clock.mts';
import type { OverlapIn } from './overlap-types.mts';
import type { TransitionPlan } from './transition.mts';
import { isNum, round } from './util.mts';

const SOFT_START_REL_LU = -10; // keep equal to reorder TC.SOFT_START_REL_LU

export function overlapWaitSec(
  next: IndexEntry | null | undefined,
  tplan: Partial<TransitionPlan> | null | undefined,
  seeksEntry?: boolean,
): number {
  let head = 0;
  const fs = next && isNum(next.fs) ? Math.max(0, next.fs) : 0;

  if (!seeksEntry && fs > 0) {
    if (fs < HEAD_TRIM_MIN_SEC) head = fs;
    else {
      const margin = next?.fx ? HEAD_RUSH.marginSec : 0;
      const rushed = Math.min(Math.max(0, fs - margin), HEAD_RUSH.wallSec * HEAD_RUSH.rate);
      head = rushed / HEAD_RUSH.rate + (fs - rushed) + HEAD_RUSH.gateSec;
    }
  }

  const at = tplan?.advanceAtPos,
    ls = tplan?.lastSoundSec;
  const tail = isNum(at) && isNum(ls) && at > ls ? Math.min(1, at - ls) : 0;

  return round(OVERLAP.loadSec + head + tail, 2);
}

export function overlapEntryOf(
  next: IndexEntry | null | undefined,
  entryKind?: MixKind | null,
): { in: OverlapIn | null; inSec: number | null } {
  if (entryKind === 'thin' || entryKind === 'lift') return { in: 'loud_entry', inSec: OVERLAP.loudEntryLeadSec };
  if (!next) return { in: 'plain', inSec: OVERLAP.plainEntryLeadSec };
  const fs = isNum(next.fs) ? next.fs : 0;
  const thin = next.mx?.n.find((c) => c.k === 'thin');
  if (thin && thin.t - fs >= OVERLAP.quietIntroMinSec) return { in: 'intro', inSec: round(thin.t - fs, 1) };
  const rel = isNum(next.h0) && isNum(next.l) && (next.c ?? 0) >= 0.3 ? next.h0 - next.l : null;
  if (rel !== null && next.fx && fs <= 0.1 && rel >= CUT_IN_MIN_REL_LU)
    return { in: 'cut_in', inSec: OVERLAP.loudEntryLeadSec };
  if (rel !== null && rel < SOFT_START_REL_LU) return { in: 'soft', inSec: null };

  return { in: 'plain', inSec: OVERLAP.plainEntryLeadSec };
}
