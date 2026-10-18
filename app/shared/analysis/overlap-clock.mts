import type { FadeOut } from './fade-align.mts';
import type { OverlapBasis, OverlapPlan } from './overlap-types.mts';
import { isNum, round } from './util.mts';

const FADE_OUT_LEAD_SEC = 0.2;

export const OVERLAP = Object.freeze({
  rate: 1.25,
  // 2x loses 8-12 kHz through the element's resampler
  rates: Object.freeze([1.25, 1.5] as const),
  leadSec: 3,
  shortLeadSec: 2,
  maxLeadSec: 10,
  minLeadSec: 1,
  minStartSec: 10,
  delaySec: 512 / 48000,
  misfitLeadFactor: 0.5,
  loudEntryLeadSec: 3,
  plainEntryLeadSec: 6,
  quietIntroMinSec: 3,
  // measured 0.2-0.81 s from our "next" until the next track plays on the element
  loadSec: 0.8,
  coverSec: 0.5,
});
export const HEAD_RUSH = Object.freeze({ rate: 3, marginSec: 0.25, wallSec: 2.5, gateSec: 0.04 });

export type LeadRate = (typeof OVERLAP.rates)[number];
export const leadRateOf = (x: unknown): LeadRate =>
  (OVERLAP.rates as readonly unknown[]).includes(x) ? (x as LeadRate) : OVERLAP.rate;

export function fitLead(lead: number, at: number, rate: number, basis: OverlapBasis): number | null {
  const room = overlapLeadFrom(OVERLAP.minStartSec, at, rate);
  let fitted = lead;

  if (room < fitted) {
    fitted = room;
    basis.in = 'short';
    basis.inSec = round(Math.max(0, room), 2);
  }

  fitted = Math.min(fitted, OVERLAP.maxLeadSec);

  return fitted >= OVERLAP.minLeadSec ? round(fitted, 2) : null;
}

// the first frame inside the window comes up to 0.1 s after its start
const OVERLAP_FRAME_SLACK_SEC = 0.05;

export function overlapLeadAt(
  p: Pick<OverlapPlan, 'leadSec' | 'rate' | 'captureStartPos' | 'advanceAtPos'> | null | undefined,
  ct: number,
): number | null {
  if (!p || !isNum(p.captureStartPos) || !isNum(p.advanceAtPos) || !isNum(p.leadSec)) return null;
  if (ct < p.captureStartPos || ct >= p.advanceAtPos) return null;
  const lead = Math.min(p.leadSec, overlapLeadFrom(ct, p.advanceAtPos, p.rate));

  return lead >= OVERLAP.minLeadSec - OVERLAP_FRAME_SLACK_SEC ? lead : null;
}

export function overlapWindowSec(lead: number, rate: number): number {
  return (lead * rate) / (rate - 1);
}

export function overlapLeadFrom(ct: unknown, advanceAtPos: unknown, rate: unknown): number {
  if (!isNum(ct) || !isNum(advanceAtPos) || !isNum(rate) || !(rate > 1)) return 0;

  return Math.max(0, ((advanceAtPos - ct) * (rate - 1)) / rate);
}

export interface Capture {
  t0: number;
  p0: number;
  delaySec?: number | null;
}
export const heardPos = (cap: Capture, ctxNow: number): number =>
  cap.p0 - (isNum(cap.delaySec) ? cap.delaySec : OVERLAP.delaySec) + (ctxNow - cap.t0);
export const heardCtx = (cap: Capture, pos: number): number =>
  cap.t0 + (isNum(cap.delaySec) ? cap.delaySec : OVERLAP.delaySec) + (pos - cap.p0);
export interface FadeTimes {
  startCtx: number;
  endCtx: number;
  restoreCtx: number;
}

export function fadeOutHeardTimes(
  fadeOut: FadeOut | null | undefined,
  cap: Partial<Capture> | null | undefined,
  ctxNow: number,
): FadeTimes | null {
  if (!fadeOut || !cap || !isNum(cap.t0) || !isNum(cap.p0)) return null;
  const c = cap as Capture;
  const startCtx = heardCtx(c, fadeOut.startPos);
  if (startCtx < ctxNow + 0.02) return null;

  return { startCtx, endCtx: heardCtx(c, fadeOut.endPos), restoreCtx: heardCtx(c, fadeOut.restorePos) };
}

export function fadeOutTimes(
  fadeOut: FadeOut | null | undefined,
  ct: unknown,
  ctxNow: unknown,
  rate?: unknown,
): FadeTimes | null {
  if (!fadeOut || !isNum(ct) || !isNum(ctxNow)) return null;
  const r = isNum(rate) && rate > 0 ? rate : 1;
  if (ct > fadeOut.startPos - FADE_OUT_LEAD_SEC) return null;
  const at = (p: number) => ctxNow + (p - ct) / r;

  return { startCtx: at(fadeOut.startPos), endCtx: at(fadeOut.endPos), restoreCtx: at(fadeOut.restorePos) };
}
