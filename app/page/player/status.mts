import type { OverlapPlan } from '../../shared/analysis.mts';
import { round } from './common.mts';
import { mixMode } from './plan.mts';
import { liveEligible } from './live-gap.mts';
import { queueInfo } from './queue.mts';
import { isExcluded, type Player } from './state.mts';
import type { BeatOutcome, FadeState, QueueInfo, TPlan, TrIn, TrOut } from './types.mts';
import { playerDuration } from './youtube.mts';

export function styleWithOutcome(s: OverlapPlan['style'], beat: BeatOutcome | null | undefined) {
  if (!s) return null;
  if (s.kind !== 'blend') return s;

  return Object.assign({}, s, { beat: beat?.why ?? s.beat?.why ?? null });
}

function ovStatus(pl: Player, f: FadeState) {
  const p = f.oplan;
  if (!p?.on || isExcluded(pl, f.vid)) return null;
  const note = pl.trOut[f.vid]?.overlap || null;
  const cur = pl.ov.vid === f.vid ? pl.ov : null;
  const noted = (x: number | undefined) => (note && Number.isFinite(x) ? x : undefined);
  const leadSec = cur?.cap ? cur.cap.leadSec : (noted(note?.leadSec) ?? p.leadSec);
  const start = cur?.cap ? round(cur.cap.p0, 2) : (noted(note?.startSec) ?? p.captureStartPos);
  const leadEnd = round((p.advanceAtPos ?? NaN) - (leadSec ?? NaN), 2);
  const state = note?.state === 'cancelled' ? 'cancelled' : note?.state === 'done' ? 'done' : 'planned';

  return {
    leadStartPos: start,
    leadEndPos: leadEnd,
    overlapStartPos: leadEnd,
    overlapEndPos: p.advanceAtPos,
    rate: p.rate,
    leadSec,
    shape: p.shape,
    state,
    running: cur ? cur.state : null,
    cancel: note ? note.cancel || null : null,
    adapt: p.adapt || null,
    basis: p.basis || null,
    style: styleWithOutcome(p.style, note?.beat),
    swapPos: p.style?.swapPos ?? null,
  };
}

function marksStatus(pl: Player, f: FadeState) {
  const e = pl.index[f.vid] || null;
  const p = f.plan;
  const n = (x: unknown) => (Number.isFinite(x) ? round(x as number, 2) : null);

  return {
    dur: n(playerDuration(pl) || pl.video?.duration),
    fs: e ? n(e.fs) : null,
    fx: !!e?.fx,
    ls: f.ending ? n(f.ending.lastSoundSec) : null,
    fadesOn: !!pl.settings.fadesEnabled,
    trOn: !!pl.settings.transitions,
    fadeInSec: p?.fadeIn ? n(p.fadeIn.durSec) : null,
    fadeInDone: f.fadeInDone,
    outResult: f.outResult || null,
    excluded: isExcluded(pl, f.vid),
  };
}

function incomingStatus(inc: TrIn | null, q: QueueInfo | null) {
  if (!inc) return null;
  const mix = inc.mix;

  return {
    fadeIn: inc.fadeIn,
    fadeInSec: inc.fadeInSec || null,
    headTrimTo: inc.headTrimTo,
    headReason: inc.headReason,
    cancel: inc.cancel || null,
    mix: mix
      ? { k: mix.k, t: mix.t, c: mix.c, from: { k: mix.xk, t: mix.xt, match: !!(q?.prev && q.prev === mix.from) } }
      : null,
  };
}

function seenQueue(pl: Player, f: FadeState): QueueInfo | null {
  const wall = Date.now();
  if (!f.qSeen || wall - f.qSeen.at > 1000) f.qSeen = { at: wall, q: queueInfo(pl, f.vid) };

  return !isExcluded(pl, f.vid) ? f.qSeen.q : null;
}

function liveTrimStatus(pl: Player, out: TrOut, incoming: ReturnType<typeof incomingStatus>) {
  return {
    kind: 'live_trim',
    reason: 'live_silence',
    atSec: out.atSec ?? null,
    skipSec: out.skipSec ?? null,
    ending: null,
    state: pl.tr.state,
    result: out.state || null,
    cancel: out.cancel || null,
    wash: false,
    pair: null,
    incoming,
  };
}

function mixStatus(pl: Player, f: FadeState, t: TPlan) {
  const m = t.mix;
  if (!m || isExcluded(pl, f.vid)) return null;

  return { mode: m.mode, x: m.x, n: m.n, exit: m.exit, entry: m.entry, lastSoundSec: m.lastSoundSec };
}

function trStatus(pl: Player, f: FadeState) {
  const t = f.tplan;
  if (!t) return null;
  const out = pl.trOut[f.vid] || {};
  const seen = pl.trIn[f.vid];
  const q = seenQueue(pl, f);
  const incoming = incomingStatus(seen && Date.now() - seen.wall < 60000 ? seen : null, q);
  if (liveEligible(pl, f) || out.kind === 'live_trim') return liveTrimStatus(pl, out, incoming);
  const ovOn = f.oplan?.on && !isExcluded(pl, f.vid) ? f.oplan : null;

  return {
    kind: t.kind,
    reason: t.reason,
    atSec: t.advanceAtPos,
    skipSec: t.skipSec,
    ending: t.ending,
    state: pl.tr.state,
    result: out.state || null,
    cancel: out.cancel || null,
    wash: !!pl.settings.transitionWash && (t.pair ? t.pair.wash : true),
    pair: t.pair || null,
    nextKnown: !!(f.nextVid && pl.index[f.nextVid]),
    incoming,
    overlapSec: ovOn ? ovOn.leadSec : null,
    overlapAdapt: ovOn ? ovOn.adapt || null : null,
    overlapStyle: ovOn ? styleWithOutcome(ovOn.style, out.overlap?.beat) : null,
    overlapBasis: ovOn ? ovOn.basis || null : null,
    mix: mixStatus(pl, f, t),
    next: q && t.kind !== 'none' ? nextStatus(pl, f, t, q) : null,
  };
}

function noMixWhy(pl: Player, f: FadeState, q: QueueInfo): string {
  if (f.mixOff) return f.mixOffWhy === 'off' ? 'settings' : 'changed';
  if (f.gapless) return 'gapless';
  if (!q.next) return 'no_next';
  if (isExcluded(pl, q.next)) return 'next_excluded';
  if (!pl.index[q.next]) return 'next_unknown';
  if (!pl.index[f.vid]?.mx) return 'no_exit';
  if (f.mixNone) return f.mixNone;

  return 'off';
}

function nextStatus(pl: Player, f: FadeState, t: TPlan, q: QueueInfo) {
  const m = t.mix;
  const differs = !!(m?.nextVid && q.next && m.nextVid !== q.next);

  if (m && !f.mixOff) {
    const ne = typeof m.nextVid === 'string' ? pl.index[m.nextVid] : null;
    const firstSound = ne && Number.isFinite(ne.fs) ? round(ne.fs as number, 2) : m.n.t;
    const n = m.entry ? m.n : { k: 'first', t: firstSound, c: 1 };

    return {
      n: { k: n.k, t: n.t, c: n.c },
      why: null,
      nextMx: m.nextMx,
      differs,
      skip: m.skip || null,
      cost: m.cost,
      mode: m.mode,
    };
  }

  const why = noMixWhy(pl, f, q);
  const nextMx = !!(q.next && pl.index[q.next]?.mx);

  return { n: null, why, nextMx, differs: false, skip: null, cost: null, mode: mixMode(pl) };
}

export function fadeStatus(pl: Player) {
  const f = pl.fade;
  if (!f) return null;
  const p = f.plan;

  return {
    vid: f.vid,
    ending: f.ending,
    fadeIn: !!p?.fadeIn,
    fadeOutStart: p?.fadeOut ? p.fadeOut.startPos : null,
    fadeOutEnd: p?.fadeOut ? p.fadeOut.endPos : null,
    skipAt: p?.skipAtPos,
    planReason: p?.reason || null,
    align: p?.align || null,
    scheduled: !!f.scheduled || !!(pl.ov.fadeOut && pl.ov.vid === f.vid),
    lastAction: f.lastAction,
    transition: trStatus(pl, f),
    gapless: f.gapless,
    marks: marksStatus(pl, f),
    overlap: ovStatus(pl, f),
  };
}
