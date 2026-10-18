import type { EndingKind, IndexEntry, MixKind } from '../types.mts';
import type { FadeOut } from './fade-align.mts';
import { JUMP_TOLERANCE_SEC } from './head-frames.mts';
import { mixExitOf, mixEntryOf } from './mix.mts';
import type { MixSkip, MixPick } from './mix.mts';
import { isNum, round, obj } from './util.mts';

export const TR_TRIM_AFTER_SEC = 0.2;
export const TR_STOP_AFTER_SEC = 0.3;
export const TR_MIN_SKIP_SEC = 0.25; // closer to the end than this, the player advances by itself
export const TR_ARM_SEC = 10;
// a frame at 1.25x must still leave TR_MIN_SKIP_SEC before the end
export const TR_END_MARGIN_SEC = 0.4;
export const TR_FADE_IN_SEC = 0.3;

export type TransitionKind = 'trim' | 'fade_trim' | 'stop_wait' | 'none';
export interface PlannedPair {
  wash: boolean;
  fadeInSec: number;
  extraWaitSec: number;
  fadeOutSec: number | null;
  reasons: string[];
  tempo: string | null | undefined;
  key: string | null | undefined;
  cams: (string | null)[] | null;
  bpms: (number | null)[] | null;
}
export interface PlannedMix {
  mode: unknown;
  cost: unknown;
  nextVid: unknown;
  x: { k: MixKind; t: number; c: number };
  n: { k: MixKind; t: number; c: number };
  exit: boolean;
  entry: boolean;
  lastSoundSec: number | null;
  nextMx: boolean;
  skip: MixSkip | null;
}
export interface TransitionPlan {
  kind: TransitionKind;
  reason: string;
  advanceAtPos: number | null;
  skipSec: number | null;
  lastSoundSec: number | null;
  ending: EndingKind | null | undefined;
  pair?: PlannedPair;
  mix?: PlannedMix;
  atEnd?: boolean;
}
export interface PairChoice {
  wash?: unknown;
  fadeInSec?: unknown;
  fadeOutSec?: unknown;
  extraWaitSec?: unknown;
  reasons?: unknown;
  relation?: { tempo?: string | null; key?: string | null; cams?: unknown; bpms?: unknown } | null;
}
export interface TransitionOptions {
  enabled?: unknown;
  fadeOut?: Partial<FadeOut> | null;
  pair?: PairChoice | null;
  mix?: Partial<MixPick> | null;
  overlap?: unknown;
}

export function planTransition(entry: IndexEntry | null | undefined, opts?: TransitionOptions | null): TransitionPlan {
  const p = planTransitionPair(entry, opts);
  const m = opts && opts.mix;
  if (!entry || !m || !m.x || !m.n || (p.kind === 'none' && p.reason !== 'little_silence')) return p;
  const x = mixExitOf(m),
    n = mixEntryOf(m);
  const mix: PlannedMix = {
    mode: m.mode,
    cost: m.cost,
    nextVid: m.nextVid || null,
    x: { k: m.x.k, t: m.x.t, c: m.x.c },
    n: { k: m.n.k, t: m.n.t, c: m.n.c },
    exit: !!x,
    entry: !!n,
    lastSoundSec: entry.en && isNum(entry.en.lastSoundSec) ? entry.en.lastSoundSec : null,
    nextMx: m.nextMx !== false,
    skip: m.skip || null,
  };
  p.mix = mix;
  if (x && isNum(entry.d) && entry.d - x.t >= TR_MIN_SKIP_SEC) {
    const fo = opts.fadeOut;
    const faded = !!(fo && Math.abs((fo.endPos ?? NaN) - x.t) < 0.01);
    Object.assign(p, {
      kind: faded ? 'fade_trim' : 'trim',
      reason: p.reason === 'little_silence' ? (entry.en ? entry.en.kind : 'no_ending') : p.reason,
      advanceAtPos: round(x.t, 2),
      skipSec: round(entry.d - x.t, 2),
    });
    delete p.atEnd;

    if (p.pair) {
      p.pair.extraWaitSec = 0;
      p.pair.reasons = p.pair.reasons.filter((r) => r !== 'contrast_pause');
    }
  } else if (p.kind === 'none') {
    delete p.mix;

    return p;
  } else mix.exit = false;

  return p;
}

function planTransitionPair(entry: IndexEntry | null | undefined, opts?: TransitionOptions | null): TransitionPlan {
  const p = planTransitionBase(entry, opts);
  const pair = opts && opts.pair;
  if (!entry || !pair || p.kind === 'none') return p;
  const relation = pair.relation;
  const cams: unknown = relation && relation.cams,
    bpms: unknown = relation && relation.bpms;
  p.pair = {
    wash: pair.wash === true,
    fadeInSec: isNum(pair.fadeInSec) ? pair.fadeInSec : TR_FADE_IN_SEC,
    extraWaitSec: 0,
    fadeOutSec: isNum(pair.fadeOutSec) ? pair.fadeOutSec : null,
    reasons: Array.isArray(pair.reasons) ? (pair.reasons.slice() as string[]) : [],
    tempo: relation ? relation.tempo : null,
    key: relation ? relation.key : null,
    cams: Array.isArray(cams) ? (cams.slice(0, 2) as (string | null)[]) : null,
    bpms: Array.isArray(bpms) ? (bpms as unknown[]).map((b) => (isNum(b) ? round(b, 0) : null)).slice(0, 2) : null,
  };
  const w = isNum(pair.extraWaitSec) && !p.atEnd ? pair.extraWaitSec : 0;

  if (w > 0) {
    const at = round((p.advanceAtPos ?? 0) + w, 2);
    if ((entry.d ?? NaN) - at >= TR_MIN_SKIP_SEC) {
      p.advanceAtPos = at;
      p.skipSec = round((entry.d ?? NaN) - at, 2);
      p.pair.extraWaitSec = w;
    } else p.pair.reasons = p.pair.reasons.filter((r) => r !== 'contrast_pause');
  }

  return p;
}

function advanceByEnding(
  ending: string,
  lastSound: number,
  fadeOut: Partial<FadeOut> | null | undefined,
): { kind: TransitionKind; at: number } | null {
  if (ending === 'fades' || ending === 'decays') return { kind: 'trim', at: lastSound + TR_TRIM_AFTER_SEC };
  if (ending === 'stop') return { kind: 'stop_wait', at: lastSound + TR_STOP_AFTER_SEC };
  if (ending !== 'abrupt') return null;
  if (fadeOut && isNum(fadeOut.endPos) && fadeOut.endPos <= lastSound + 0.001)
    return { kind: 'fade_trim', at: fadeOut.endPos };

  return { kind: 'trim', at: lastSound };
}

function planTransitionBase(entry: IndexEntry | null | undefined, opts?: TransitionOptions | null): TransitionPlan {
  const o = opts || {};
  const out: TransitionPlan = {
    kind: 'none',
    reason: 'off',
    advanceAtPos: null,
    skipSec: null,
    lastSoundSec: null,
    ending: null,
  };
  if (!o.enabled) return out;

  if (!entry) {
    out.reason = 'no_analysis';

    return out;
  }

  const en = entry.en;
  out.ending = en ? (en.kind ?? null) : null;

  if (!en || !en.kind || en.kind === 'unknown' || !isNum(en.lastSoundSec)) {
    out.reason = 'no_ending';

    return out;
  }

  if (!isNum(entry.d) || entry.d <= 0) {
    out.reason = 'no_duration';

    return out;
  }

  out.lastSoundSec = en.lastSoundSec;
  const advance = advanceByEnding(en.kind, en.lastSoundSec, o.fadeOut);

  if (!advance) {
    out.reason = 'no_ending';

    return out;
  }

  const kind = advance.kind;
  const at = round(advance.at, 2);
  const skip = entry.d - at;

  if (o.overlap && skip < TR_END_MARGIN_SEC) {
    const end = round(Math.min(at, entry.d - TR_END_MARGIN_SEC), 2);
    if (end > 0)
      return Object.assign(out, {
        kind,
        reason: en.kind,
        advanceAtPos: end,
        skipSec: round(entry.d - end, 2),
        atEnd: true,
      });
  }

  if (!(skip >= TR_MIN_SKIP_SEC)) {
    out.reason = 'little_silence';
    out.skipSec = round(Math.max(0, skip), 2);

    return out;
  }

  return Object.assign(out, { kind, reason: en.kind, advanceAtPos: at, skipSec: round(skip, 2) });
}

export function transitionStep(p: unknown): 'wait' | 'arm' | 'advance' | 'skip' {
  const o = obj(p) || {};
  const pl = obj(o.plan);
  if (!o.enabled || !pl || pl.kind === 'none' || !isNum(pl.advanceAtPos) || o.ad || o.paused || !isNum(o.ct))
    return 'wait';
  if (o.ct < pl.advanceAtPos) return pl.advanceAtPos - o.ct <= TR_ARM_SEC ? 'arm' : 'wait';
  if (!isNum(o.prevCt) || o.prevCt >= pl.advanceAtPos || o.ct - o.prevCt > JUMP_TOLERANCE_SEC) return 'skip';
  if (!o.sameTrack) return 'skip';
  if (!isNum(o.duration) || o.duration - o.ct < TR_MIN_SKIP_SEC) return 'skip';

  return 'advance';
}
