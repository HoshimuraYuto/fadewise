import { isNum, round, obj } from './util.mts';
import type { Loose } from './util.mts';

export const APPLIED_KEEP = 5;
const APPLIED_CODES: Record<string, string[]> = {
  source: ['analysis', 'youtube', 'none', 'off', 'error', 'excluded'],
  limit: ['peak', 'no_peak', 'max_boost', 'max_cut'],
  fadeState: ['planned', 'scheduled', 'done', 'cancelled', 'off', 'not_reached'],
  cancel: [
    'seeking',
    'jump',
    'ad_start',
    'ad_end',
    'emptied',
    'loadstart',
    'pause',
    'drift',
    'watchdog',
    'ad',
    'off',
    'error',
    'track_change',
    'ended',
  ],
  align: [
    'aligned',
    'off',
    'no_fade',
    'no_tempo',
    'low_confidence',
    'octave',
    'no_phase',
    'out_of_range',
    'no_grid',
    'tempo_change',
    'unstable',
    'no_beat_in_range',
    'error',
  ],
  mode: ['bar', 'beat'],
  trKind: ['trim', 'fade_trim', 'stop_wait', 'live_trim', 'none'],
  trReason: [
    'fades',
    'decays',
    'abrupt',
    'stop',
    'live_silence',
    'off',
    'no_analysis',
    'no_ending',
    'no_duration',
    'little_silence',
    'error',
    'excluded',
    'gapless',
  ],
  trState: ['armed', 'advanced', 'cancelled', 'skipped'],
  trCancel: [
    'seeking',
    'jump',
    'ad_start',
    'ad_end',
    'emptied',
    'loadstart',
    'pause',
    'drift',
    'watchdog',
    'ad',
    'off',
    'error',
    'track_change',
    'ended',
    'timeout',
    'not_reached',
    'not_found',
    'disabled',
    'repeat_one',
    'sound',
  ],
  pairReason: [
    'contrast_longer_fade',
    'wash_echo_out_tempo_change',
    'wash_cover_cut',
    'wash_into_quiet_head',
    'no_wash_key_clash',
    'contrast_pause',
    'punch_in',
    'default',
    'no_next',
  ],
  pairRel: ['match', 'near', 'far', 'ok', 'clash', 'unknown'],
  headReason: [
    'exact',
    'exact_quiet',
    'not_exact',
    'short',
    'long',
    'duration',
    'no_analysis',
    'live',
    'excluded',
    'gapless',
    'overlap',
    'mix_thin',
    'mix_lift',
  ],
  mixKind: ['first', 'thin', 'lift', 'last', 'fade', 'chorusEnd'],
  mixMode: ['gentle', 'auto', 'aggressive'],
  ovShape: ['equal', 'segue'],
  ovState: ['running', 'done', 'cancelled'],
  ovCancel: ['pause', 'seek', 'rate', 'user_skip', 'ad', 'off', 'error', 'timeout', 'track_change'],
};
const num = (x: unknown, d: number) => (isNum(x) ? round(x, d) : null);
const code = (list: string, x: unknown) => (typeof x === 'string' && APPLIED_CODES[list].includes(x) ? x : null);

export type Applied = NonNullable<ReturnType<typeof sanitizeApplied>>;

const appliedGain = (g: Loose) => ({
  db: num(g.db, 2),
  source: code('source', g.source),
  limit: code('limit', g.limit),
  wantedDb: num(g.wantedDb, 2),
  audibleLufs: num(g.audibleLufs, 2),
  ytNormDb: num(g.ytNormDb, 2),
  targetLufs: num(g.targetLufs, 1),
  ownLufs: num(g.ownLufs, 2),
  pLd: num(g.pLd, 2),
  peakDb: num(g.peakDb, 1),
});

const appliedFadeIn = (fadeIn: Loose) => ({
  done: fadeIn.done === true,
  fromDb: num(fadeIn.fromDb, 1),
  durSec: num(fadeIn.durSec, 2),
});

const appliedAlign = (align: Loose) => ({
  on: align.on === true,
  reason: code('align', align.reason),
  mode: code('mode', align.mode),
  beats: num(align.beats, 0),
  bpm: num(align.bpm, 1),
});

function appliedFadeOut(fadeOut: Loose) {
  const align = obj(fadeOut.align);

  return {
    state: code('fadeState', fadeOut.state),
    cancel: code('cancel', fadeOut.cancel),
    startSec: num(fadeOut.startSec, 2),
    endSec: num(fadeOut.endSec, 2),
    align: align ? appliedAlign(align) : null,
  };
}

const appliedPair = (pair: Loose) => ({
  tempo: code('pairRel', pair.tempo),
  key: code('pairRel', pair.key),
  fadeOutSec: num(pair.fadeOutSec, 1),
  extraWaitSec: num(pair.extraWaitSec, 1),
  fadeInSec: num(pair.fadeInSec, 2),
  wash: pair.wash === true,
  reasons: Array.isArray(pair.reasons)
    ? (pair.reasons as unknown[])
        .map((reason) => code('pairReason', reason))
        .filter((reason): reason is string => !!reason)
        .slice(0, 6)
    : [],
});

const appliedOverlap = (overlap: Loose) => ({
  shape: code('ovShape', overlap.shape),
  state: code('ovState', overlap.state),
  cancel: code('ovCancel', overlap.cancel),
  leadSec: num(overlap.leadSec, 2),
  leadOutSec: num(overlap.leadOutSec, 2),
  xfSec: num(overlap.xfSec, 2),
  lostSec: num(overlap.lostSec, 2),
});

const appliedMix = (mix: Loose) => ({
  mode: code('mixMode', mix.mode),
  x: code('mixKind', mix.x),
  n: code('mixKind', mix.n),
  xSec: num(mix.xSec, 2),
  nSec: num(mix.nSec, 2),
});

function appliedTransition(transition: Loose) {
  const pair = obj(transition.pair);
  const overlap = obj(transition.overlap);
  const mix = obj(transition.mix);

  return {
    kind: code('trKind', transition.kind),
    reason: code('trReason', transition.reason),
    state: code('trState', transition.state),
    cancel: code('trCancel', transition.cancel),
    planSec: num(transition.planSec, 2),
    atSec: num(transition.atSec, 2),
    skipSec: num(transition.skipSec, 2),
    wash: transition.wash === true,
    pair: pair ? appliedPair(pair) : null,
    ...(overlap ? { overlap: appliedOverlap(overlap) } : {}),
    ...(mix ? { mix: appliedMix(mix) } : {}),
  };
}

const appliedIncoming = (incoming: Loose) => ({
  fadeIn: incoming.fadeIn === true,
  headTrimTo: num(incoming.headTrimTo, 2),
  headReason: code('headReason', incoming.headReason),
  cancel: code('trCancel', incoming.cancel),
});

export function sanitizeApplied(x: unknown) {
  const applied = obj(x);
  if (!applied || !isNum(applied.at)) return null;
  const gain = obj(applied.gain);
  const fadeIn = obj(applied.fadeIn);
  const fadeOut = obj(applied.fadeOut);
  const transition = obj(applied.transition);
  const incoming = obj(applied.incoming);

  return {
    at: Math.round(applied.at),
    gain: gain ? appliedGain(gain) : null,
    fadeIn: fadeIn ? appliedFadeIn(fadeIn) : null,
    fadeOut: fadeOut ? appliedFadeOut(fadeOut) : null,
    skipAtSec: num(applied.skipAtSec, 2),
    transition: transition ? appliedTransition(transition) : null,
    incoming: incoming ? appliedIncoming(incoming) : null,
  };
}

export function mergeApplied(list: unknown, entry: unknown): Applied[] {
  const prev = Array.isArray(list) ? (list as unknown[]).filter((x): x is Applied => isNum(obj(x)?.at)) : [];
  const e = sanitizeApplied(entry);
  if (!e) return prev.slice(-APPLIED_KEEP);

  return prev
    .filter((x) => x.at !== e.at)
    .concat(e)
    .sort((x, y) => x.at - y.at)
    .slice(-APPLIED_KEEP);
}
