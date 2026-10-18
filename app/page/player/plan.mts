import type { MixPick } from '../../shared/analysis.mts';
import type { TransitionChoice } from '../../shared/reorder.mts';
import type { IndexEntry } from '../../shared/types.mts';
import { noteError, post } from './common.mts';
import { NO_FADES, releaseFade } from './fades.mts';
import { ovWanted } from './overlap-core.mts';
import { ovCancel } from './overlap-events.mts';
import { queueInfo, queueSignature } from './queue.mts';
import { isExcluded, type Player } from './state.mts';
import { cancelTransition } from './transition.mts';
import type { FadeState, PlanResult, PlayerPlan, QueueInfo, TPlan } from './types.mts';
import { playerVideoId } from './youtube.mts';

const GAPLESS_HOLD_MS = 30000;

interface PlanInput {
  vid: string;
  entry: IndexEntry | null;
  nextVid: string | null;
  next: IndexEntry | null;
  pair: TransitionChoice | null;
}

export const mixMode = (pl: Player): string =>
  (pl.A.MIX.modes as readonly unknown[]).includes(pl.settings.mixPoints) ? pl.settings.mixPoints : 'gentle';

function choosePair(pl: Player, inp: PlanInput): TransitionChoice | null {
  const { RO } = pl;
  const { entry, next, nextVid } = inp;
  if (!pl.settings.transitions || !entry || !RO) return null;

  try {
    const after = next && nextVid ? RO.summaryOf(nextVid, next.tk, next) : null;

    return RO.chooseTransition(RO.summaryOf(inp.vid, entry.tk, entry), after, {
      washAllowed: !!pl.settings.transitionWash,
    });
  } catch (err) {
    noteError(pl, err);

    return null;
  }
}

function plainFades(pl: Player, inp: PlanInput): PlayerPlan {
  return pl.A.planFades(inp.entry, {
    skipSilence: false,
    beatAlign: pl.settings.beatAlign !== false,
    fadeOutSec: inp.pair ? inp.pair.fadeOutSec : null,
  });
}

function fadePlan(pl: Player, inp: PlanInput): PlayerPlan | null {
  let plan: PlayerPlan | null = null;

  try {
    plan = plainFades(pl, inp);
  } catch (err) {
    noteError(pl, err);
  }

  const g = pl.recent.gapless;
  if (plan?.fadeIn && g && g.to === inp.vid && Date.now() - g.at < GAPLESS_HOLD_MS) plan.fadeIn = null;

  return plan;
}

function gaplessResult(inp: PlanInput, plan: PlayerPlan | null): PlanResult {
  if (plan) {
    plan.fadeOut = null;
    plan.align = { on: false, reason: 'no_fade' };
    plan.gapless = true;
  }

  const ending = inp.entry?.en ? inp.entry.en.kind : null;

  return { plan, tplan: { kind: 'none', reason: 'gapless', advanceAtPos: null, skipSec: null, ending }, gapless: true };
}

function pickMix(pl: Player, inp: PlanInput, noMix?: boolean): { mix: MixPick | null; none: string | null } {
  const { entry, next } = inp;
  if (noMix || !pl.settings.transitions || !entry || !next) return { mix: null, none: null };

  try {
    const m = pl.A.planMix(entry, next, {
      mode: mixMode(pl),
      now: pl.video && playerVideoId(pl) === inp.vid ? pl.video.currentTime : 0,
      midExit: !!pl.settings.fadesEnabled || ovWanted(pl),
    });
    if (!('x' in m)) return { mix: null, none: m.none };
    m.nextVid = inp.nextVid;

    return { mix: m, none: null };
  } catch (err) {
    noteError(pl, err);

    return { mix: null, none: null };
  }
}

function transitionPlan(pl: Player, inp: PlanInput, plan: PlayerPlan | null, mix: MixPick | null, overlap: boolean) {
  try {
    return pl.A.planTransition(inp.entry, {
      enabled: !!pl.settings.transitions,
      fadeOut: pl.settings.fadesEnabled && plan ? plan.fadeOut : null,
      pair: inp.pair,
      mix,
      overlap,
    }) as TPlan;
  } catch (err) {
    noteError(pl, err);

    return { kind: 'none', reason: 'error', advanceAtPos: null } as TPlan;
  }
}

function overlapPlan(pl: Player, inp: PlanInput, tplan: TPlan, plan: PlayerPlan | null) {
  try {
    return pl.A.planOverlap(inp.entry, tplan, {
      enabled: ovWanted(pl),
      nextExcluded: isExcluded(pl, inp.nextVid),
      fadeOut: pl.settings.fadesEnabled && plan ? plan.fadeOut : null,
      next: inp.nextVid ? pl.index[inp.nextVid] || null : null,
      rate: pl.settings.leadRate,
      style: pl.settings.overlapStyle === 'simple' ? 'simple' : 'auto',
    });
  } catch (err) {
    noteError(pl, err);

    return null;
  }
}

function restoreEndingFade(pl: Player, inp: PlanInput, plan: PlayerPlan): void {
  try {
    const plain = plainFades(pl, inp);
    plan.fadeOut = plain.fadeOut;
    plan.align = plain.align;
  } catch (err) {
    noteError(pl, err);
  }
}

function planWithMix(pl: Player, inp: PlanInput, plan: PlayerPlan | null, noMix?: boolean): PlanResult {
  const { mix, none } = pickMix(pl, inp, noMix);
  const exit = mix ? pl.A.mixExitOf(mix) : null;

  if (exit && plan) {
    plan.fadeOut = pl.A.mixFadeOut(exit);
    plan.align = { on: false, reason: 'off' };
  }

  let tplan = transitionPlan(pl, inp, plan, mix, ovWanted(pl) && !isExcluded(pl, inp.nextVid));
  if (exit && plan && !tplan.mix?.exit) restoreEndingFade(pl, inp, plan);
  let oplan = overlapPlan(pl, inp, tplan, plan);

  // an advance moved into the last sound is only for the overlap
  if (tplan.atEnd && oplan?.on) {
    if (plan?.fadeOut) plan.fadeOut = pl.A.fadeOutEndingAt(plan.fadeOut, tplan.advanceAtPos);
  } else if (tplan.atEnd) {
    tplan = transitionPlan(pl, inp, plan, mix, false);
    oplan = overlapPlan(pl, inp, tplan, plan);
  }

  return { plan, tplan, oplan, mixNone: none };
}

export function planFor(pl: Player, vid: string, q: QueueInfo | null, noMix?: boolean): PlanResult {
  const qi = q || { next: null, album: false, albumNext: null };
  const nextVid = qi.next;
  const entry = pl.index[vid] || null;
  if (isExcluded(pl, vid))
    return {
      plan: Object.assign(NO_FADES(), { reason: 'excluded' }),
      tplan: { kind: 'none', reason: 'excluded', advanceAtPos: null, skipSec: null },
    };
  const next = nextVid && !isExcluded(pl, nextVid) ? pl.index[nextVid] || null : null;
  let gap = { on: false, why: 'not_album' };

  try {
    gap = pl.A.gaplessPair(entry, nextVid ? pl.index[nextVid] || null : null, qi);
  } catch (err) {
    noteError(pl, err);
  }

  const inp: PlanInput = { vid, entry, nextVid, next, pair: null };
  if (!gap.on) inp.pair = choosePair(pl, inp);
  const plan = fadePlan(pl, inp);
  if (gap.on) return gaplessResult(inp, plan);

  return planWithMix(pl, inp, plan, noMix);
}

function applyPlan(f: FadeState, q: QueueInfo, p: PlanResult): void {
  f.nextVid = q.next;
  f.qSig = queueSignature(q);
  f.plan = p.plan;
  f.tplan = p.tplan;
  f.oplan = p.oplan || null;
  f.gapless = !!p.gapless;
  f.mixNone = p.mixNone || null;
}

// track_change can arrive after the new track's fade-in began, so the plan is made on its first frame.
export function fadeStateFor(pl: Player, vid: string): FadeState {
  if (pl.fade && pl.fade.vid === vid) return pl.fade;
  releaseFade(pl, 'track_change');
  const q = queueInfo(pl, vid);
  const en = pl.index[vid]?.en;
  const fade: FadeState = {
    vid,
    nextVid: null,
    qSig: '',
    gapless: false,
    plan: null,
    tplan: null,
    oplan: null,
    mixNone: null,
    ovDone: false,
    trDone: false,
    scheduled: null,
    fadingIn: false,
    fadeOutDone: false,
    fadeInDone: false,
    lastAction: null,
    outResult: null,
    outCancel: null,
    pairCheckedAt: 0,
    ending: en
      ? { kind: en.kind, fadeSec: en.fadeSec, silenceSec: en.silenceSec, lastSoundSec: en.lastSoundSec }
      : null,
  };
  applyPlan(fade, q, planFor(pl, vid, q));
  pl.fade = fade;

  return fade;
}

function dropChangedMix(pl: Player, f: FadeState, now: number): boolean {
  f.pairCheckedAt = now;
  const q = queueInfo(pl, f.vid);
  if (queueSignature(q) === f.qSig) return false;
  f.mixOff = true;
  f.mixOffWhy = 'track_change';
  ovCancel(pl, 'track_change');
  cancelTransition(pl, 'track_change');
  if (__FADEWISE_VERIFY__) post(pl, 'diag', { kind: 'mix_cancel', vid: f.vid, next: q.next, planned: f.nextVid });

  return true;
}

export function refreshPair(pl: Player, f: FadeState, now: number): void {
  if (now - f.pairCheckedAt < 1 || f.trDone) return;
  const mixFixed = (pl.tr.state === 'armed' || pl.ov.state === 'capture') && f.tplan?.mix && !f.mixOff;
  if (mixFixed && !dropChangedMix(pl, f, now)) return;
  if (pl.tr.state !== 'idle' || pl.ov.state !== 'idle') return;
  if (f.scheduled && now >= f.scheduled.startCtx - 0.05) return;
  f.pairCheckedAt = now;
  const q = queueInfo(pl, f.vid);
  if (queueSignature(q) === f.qSig && !(f.mixOff && f.tplan?.mix)) return;

  if (f.scheduled && pl.fadeNode) {
    const g = pl.fadeNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(1, now);
    f.scheduled = null;
    f.outResult = null;
    f.lastAction = null;
  }

  const p = planFor(pl, f.vid, q, f.mixOff);
  applyPlan(f, q, p);
  if (__FADEWISE_VERIFY__) post(pl, 'diag', { kind: 'mix_replan', vid: f.vid, next: q.next, mix: p.tplan.mix || null });
}
