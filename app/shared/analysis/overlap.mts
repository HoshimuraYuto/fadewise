import type { IndexEntry } from '../types.mts';
import type { FadeOut } from './fade-align.mts';
import { MIX } from './mix.mts';
import { OVERLAP, leadRateOf, fitLead, overlapWindowSec } from './overlap-clock.mts';
import { overlapWaitSec, overlapEntryOf } from './overlap-entry.mts';
import { styledOverlap } from './overlap-style.mts';
import type { OverlapAdapt, OverlapOut, OverlapBasis, OverlapPlan } from './overlap-types.mts';
import type { PlannedPair, PlannedMix, TransitionPlan } from './transition.mts';
import { isNum, round, clampN } from './util.mts';

export function planOverlap(
  entry: IndexEntry | null | undefined,
  tplan: Partial<TransitionPlan> | null | undefined,
  opts?: {
    enabled?: unknown;
    nextExcluded?: unknown;
    fadeOut?: Partial<FadeOut> | null;
    next?: IndexEntry | null;
    rate?: unknown;
    style?: unknown;
  } | null,
): OverlapPlan {
  const o = opts || {};
  const out: OverlapPlan = {
    on: false,
    why: 'off',
    leadSec: null,
    rate: leadRateOf(o.rate),
    shape: null,
    captureStartPos: null,
    advanceAtPos: null,
    adapt: null,
    basis: null,
  };
  const blocked = overlapBlockedWhy(tplan, o);
  const at = tplan?.advanceAtPos;

  if (blocked !== null || !tplan || !isNum(at)) {
    out.why = blocked ?? 'no_plan';

    return out;
  }

  if (o.style === 'auto') return styledOverlap(entry, tplan, at, o.next, out);

  return simpleOverlap(entry, tplan, at, o, out);
}

function overlapBlockedWhy(
  tplan: Partial<TransitionPlan> | null | undefined,
  o: { enabled?: unknown; nextExcluded?: unknown },
): string | null {
  if (!o.enabled) return 'off';
  if (!tplan || tplan.kind === 'none' || !isNum(tplan.advanceAtPos))
    return tplan && (tplan.reason === 'gapless' || tplan.reason === 'excluded') ? tplan.reason : 'no_plan';
  if (o.nextExcluded) return 'next_excluded';

  return null;
}

function simpleOverlap(
  entry: IndexEntry | null | undefined,
  tplan: Partial<TransitionPlan>,
  at: number,
  o: { fadeOut?: Partial<FadeOut> | null; next?: IndexEntry | null },
  out: OverlapPlan,
): OverlapPlan {
  const mix = tplan.mix;
  const pair = tplan.pair;
  const byEnding = leadByEnding(entry?.en, o.fadeOut, !!mix?.exit);
  let lead = byEnding.lead;
  let shape = byEnding.shape;
  const basis: OverlapBasis = { out: byEnding.out, outSec: round(lead, 2), in: null, inSec: null, long: null };
  if (shape === 'equal') lead = capByNextStart(lead, o.next, mix, pair, basis);
  const adapt = misfitAdapt(pair, lead, shape);

  if (adapt) {
    out.adapt = adapt;
    lead = Math.max(OVERLAP.minLeadSec, lead * OVERLAP.misfitLeadFactor);
    shape = 'segue';
  }

  if (mix && mix.entry) shape = MIX.fullEntryShape;
  const wait = overlapWaitSec(o.next, tplan, !!(mix && mix.entry));
  basis.waitSec = wait;
  const need = round(wait + OVERLAP.coverSec, 2);

  if (lead < need) {
    lead = need;
    basis.covered = true;
  }

  const fitted = fitLead(lead, at, out.rate, basis);

  if (fitted === null) {
    out.why = 'short';

    return out;
  }

  return Object.assign(out, {
    on: true,
    why: shape === 'segue' ? 'segue' : 'crossfade',
    basis,
    leadSec: fitted,
    shape,
    advanceAtPos: at,
    captureStartPos: round(at - overlapWindowSec(fitted, out.rate), 2),
  });
}

function leadByEnding(
  en: IndexEntry['en'] | undefined,
  fadeOut: Partial<FadeOut> | null | undefined,
  midExit: boolean,
): { lead: number; shape: string; out: OverlapOut } {
  if (midExit) return { lead: OVERLAP.leadSec, shape: 'equal', out: 'mid' };

  if (en?.kind === 'fades') {
    // the old track is still clearly heard for the first half of its fade
    const half = isNum(en.decaySec) ? en.decaySec / 2 : OVERLAP.leadSec;

    return { lead: clampN(half, OVERLAP.leadSec, OVERLAP.maxLeadSec), shape: 'equal', out: 'fades' };
  }

  if (en?.kind === 'abrupt') {
    const lead =
      fadeOut && isNum(fadeOut.startPos) && isNum(fadeOut.endPos)
        ? clampN(fadeOut.endPos - fadeOut.startPos, OVERLAP.shortLeadSec, OVERLAP.leadSec)
        : OVERLAP.shortLeadSec;

    return { lead, shape: 'segue', out: 'abrupt' };
  }

  if (en?.kind === 'stop') return { lead: OVERLAP.shortLeadSec, shape: 'segue', out: 'stop' };

  return { lead: OVERLAP.leadSec, shape: 'equal', out: en?.kind === 'decays' ? 'decays' : 'other' };
}

function capByNextStart(
  lead: number,
  next: IndexEntry | null | undefined,
  mix: PlannedMix | undefined,
  pair: PlannedPair | undefined,
  basis: OverlapBasis,
): number {
  const start = overlapEntryOf(next, mix && mix.entry ? mix.n.k : null);
  const keyAndTempoAgree = pair?.key === 'match' && (pair.tempo === 'match' || pair.tempo === 'near');
  const cap = start.in === 'plain' && keyAndTempoAgree ? null : start.inSec;

  if (cap !== null && cap < lead) {
    basis.in = start.in;
    basis.inSec = round(cap, 2);

    return cap;
  }

  if (lead > OVERLAP.plainEntryLeadSec)
    basis.long = start.in === 'plain' ? 'key_tempo' : start.in === 'intro' || start.in === 'soft' ? start.in : null;

  return lead;
}

function misfitAdapt(pair: PlannedPair | undefined, lead: number, shape: string): OverlapAdapt | null {
  const clash = pair?.key === 'clash';
  const far = pair?.tempo === 'far';
  if (!pair || (!clash && !far)) return null;

  return {
    why: clash && far ? 'both' : clash ? 'key_clash' : 'tempo_far',
    baseLeadSec: round(lead, 2),
    baseShape: shape,
    cams: Array.isArray(pair.cams) ? pair.cams.slice(0, 2) : null,
    bpms: Array.isArray(pair.bpms) ? pair.bpms.slice(0, 2) : null,
  };
}
