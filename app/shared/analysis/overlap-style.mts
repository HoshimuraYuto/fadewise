import type { IndexEntry } from '../types.mts';
import { beatAlignOf } from './beat-align.mts';
import { CUT_IN_MIN_REL_LU } from './fades.mts';
import { OVERLAP, fitLead, overlapWindowSec } from './overlap-clock.mts';
import { overlapWaitSec } from './overlap-entry.mts';
import type { OverlapOut, OverlapBasis, OverlapPlan, OverlapStyle } from './overlap-types.mts';
import type { PlannedPair, PlannedMix, TransitionPlan } from './transition.mts';
import { isNum, round, clampN } from './util.mts';

export const OVERLAP_STYLE = Object.freeze({
  modes: Object.freeze(['auto', 'simple'] as const),
  // 4-8 s as heard in Spotify Mix
  minSec: 4,
  targetSec: 6,
  maxSec: 8,
  barChoices: Object.freeze([2, 4, 8]),
  tailPadSec: 1.5,
});
export type OverlapStyleMode = (typeof OVERLAP_STYLE.modes)[number];

export function blendBars(bpm: number | null | undefined): { sec: number; bars: number | null } {
  const S = OVERLAP_STYLE;
  if (!isNum(bpm) || bpm <= 0) return { sec: S.targetSec, bars: null };
  const bar = (4 * 60) / bpm;
  let best: { sec: number; bars: number | null } = { sec: S.targetSec, bars: null };

  for (const n of S.barChoices) {
    const sec = n * bar;
    if (sec < S.minSec - 0.05 || sec > S.maxSec + 0.05) continue;
    if (best.bars === null || Math.abs(sec - S.targetSec) < Math.abs(best.sec - S.targetSec) - 1e-9)
      best = { sec: round(sec, 2), bars: n };
  }

  return best;
}

function loudEdges(
  entry: IndexEntry | null | undefined,
  next: IndexEntry | null | undefined,
  at: number,
  mx: PlannedMix | undefined,
): { oldLeft: number | null; newIn: number | null } {
  let oldLeft: number | null = null;
  const en = entry?.en;

  if (mx?.exit) oldLeft = 0;
  else {
    const ls = en && isNum(en.lastSoundSec) ? en.lastSoundSec : null;
    // the worklet keeps 0.3 s of silence after the last sound
    const end = ls !== null ? Math.min(at, ls + 0.3) : at;
    if (en && (en.kind === 'fades' || en.kind === 'decays') && isNum(en.decaySec) && ls !== null)
      oldLeft = end - (ls - en.decaySec);
    const xs = entry?.mx?.x.filter((c) => (c.k === 'fade' || c.k === 'chorusEnd') && c.t < end && end - c.t <= 12);
    if (oldLeft === null && xs?.length) oldLeft = end - Math.max(...xs.map((c) => c.t));
  }

  let newIn: number | null = null;

  if (mx?.entry) newIn = 0;
  else if (next) {
    const fs = isNum(next.fs) ? next.fs : 0;
    const thin = next.mx?.n.find((c) => c.k === 'thin');
    if (thin && thin.t > fs) newIn = thin.t - fs;
    else if (next.fx && isNum(next.h0) && isNum(next.l) && next.h0 - next.l >= CUT_IN_MIN_REL_LU) newIn = 0;
  }

  return {
    oldLeft: oldLeft !== null && oldLeft >= 0 ? round(oldLeft, 2) : null,
    newIn: newIn !== null ? round(newIn, 2) : null,
  };
}

export function styledOverlap(
  entry: IndexEntry | null | undefined,
  tplan: Partial<TransitionPlan>,
  at: number,
  next: IndexEntry | null | undefined,
  out: OverlapPlan,
): OverlapPlan {
  const mix = tplan.mix;
  const outKind = overlapOutOf(entry?.en, mix);
  const style = baseStyle(tplan.pair);
  const blend = styleBlendSec(style, outKind, entry, next, at, tplan);
  // lining up the beats delays the next track by up to one beat
  const beat = style.beat;
  const beatHold = beat?.on && beat.old && beat.new ? Math.max(beat.old.period, beat.new.period) : 0;
  const wait = overlapWaitSec(next, tplan, !!(mix && mix.entry));
  const basis: OverlapBasis = {
    out: outKind,
    outSec: round(blend, 2),
    in: null,
    inSec: null,
    long: null,
    waitSec: wait,
  };
  const lead = fitLead(Math.max(wait + beatHold + blend, wait + OVERLAP.coverSec), at, out.rate, basis);

  if (lead === null) {
    out.why = 'short';

    return out;
  }

  if (beat?.on && lead < wait + beatHold + OVERLAP.coverSec)
    style.beat = Object.assign({}, beat, { on: false, why: 'no_room' as const });
  const heard = Math.max(0.5, lead - wait - (style.beat?.on ? beatHold : 0));
  style.swapPos =
    style.swapLeftSec !== null
      ? round(at - style.swapLeftSec, 2)
      : round(at - heard + (style.swapInSec ?? style.swapAt * heard), 2);

  return Object.assign(out, {
    on: true,
    why: style.kind === 'segue' ? 'segue' : 'crossfade',
    basis,
    leadSec: lead,
    shape: style.kind === 'segue' ? 'segue' : 'equal',
    advanceAtPos: at,
    captureStartPos: round(at - overlapWindowSec(lead, out.rate), 2),
    style,
  });
}

function overlapOutOf(en: IndexEntry['en'] | undefined, mix: PlannedMix | undefined): OverlapOut {
  if (mix?.exit) return 'mid';
  const kind = en?.kind;

  return kind === 'fades' || kind === 'decays' || kind === 'abrupt' || kind === 'stop' ? kind : 'other';
}

function baseStyle(pair: PlannedPair | undefined): OverlapStyle {
  const clash = pair?.key === 'clash';

  return {
    kind: 'tail',
    why: pair?.tempo === 'far' ? 'tempo_far' : clash ? 'key_clash' : 'tempo_unknown',
    curve: 'equal',
    bass: true,
    hpNew: false,
    hpOld: false,
    swapAt: 0.5,
    swapLeftSec: null,
    swapInSec: null,
    swapPos: null,
    aligned: null,
    bars: null,
    cams: pair && Array.isArray(pair.cams) ? pair.cams.slice(0, 2) : null,
    bpms: pair && Array.isArray(pair.bpms) ? pair.bpms.slice(0, 2) : null,
  };
}

function styleBlendSec(
  style: OverlapStyle,
  outKind: OverlapOut,
  entry: IndexEntry | null | undefined,
  next: IndexEntry | null | undefined,
  at: number,
  tplan: Partial<TransitionPlan>,
): number {
  const S = OVERLAP_STYLE;

  if (outKind === 'abrupt' || outKind === 'stop') {
    Object.assign(style, { kind: 'segue', why: outKind === 'abrupt' ? 'cut' : 'stop', curve: 'segue' });

    return outKind === 'stop' ? OVERLAP.shortLeadSec : OVERLAP.leadSec;
  }

  const pair = tplan.pair;
  const tempoClose = !!pair && (pair.tempo === 'match' || pair.tempo === 'near') && pair.key !== 'clash';
  if (tempoClose) return blendStyleSec(style, entry, next, at, tplan.mix);
  const decay = entry?.en && isNum(entry.en.decaySec) ? entry.en.decaySec : null;
  if (decay === null) return S.minSec;
  if (outKind === 'fades') return clampN(decay, S.minSec, S.maxSec);
  if (outKind === 'decays') return clampN(decay + S.tailPadSec, S.minSec, S.maxSec);

  return S.minSec;
}

function blendStyleSec(
  style: OverlapStyle,
  entry: IndexEntry | null | undefined,
  next: IndexEntry | null | undefined,
  at: number,
  mix: PlannedMix | undefined,
): number {
  Object.assign(style, { kind: 'blend', why: 'tempo_close', curve: 'overlap', hpNew: true, hpOld: true });
  style.beat = beatAlignOf(entry, next, mix);
  const bars = blendBars(style.bpms && isNum(style.bpms[0]) ? style.bpms[0] : null);
  style.bars = bars.bars;
  const edges = loudEdges(entry, next, at, mix);
  const aligned = swapAlignedBlend(edges.oldLeft, edges.newIn);
  if (!aligned) return bars.sec;
  Object.assign(style, aligned.style, { bars: null });

  return aligned.sec;
}

function swapAlignedBlend(
  oldLeft: number | null,
  newIn: number | null,
): { sec: number; style: Partial<OverlapStyle> } | null {
  const S = OVERLAP_STYLE;
  const fits = (len: number, swap: number) => swap >= 0.25 * len && swap <= 0.75 * len;

  if (oldLeft !== null && newIn !== null) {
    const len = oldLeft + newIn;
    if (len >= S.minSec && len <= S.maxSec && fits(len, newIn))
      return { sec: round(len, 2), style: { aligned: 'both', swapLeftSec: oldLeft } };
  }

  if (oldLeft !== null && oldLeft > 0) {
    const len = clampN(2 * oldLeft, S.minSec, S.maxSec);
    if (fits(len, len - oldLeft)) return { sec: round(len, 2), style: { aligned: 'old', swapLeftSec: oldLeft } };
  }

  if (newIn !== null && newIn > 0) {
    const len = clampN(2 * newIn, S.minSec, S.maxSec);
    if (fits(len, newIn)) return { sec: round(len, 2), style: { aligned: 'new', swapInSec: newIn } };
  }

  return null;
}
