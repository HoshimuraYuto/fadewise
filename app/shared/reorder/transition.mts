import type { Ending } from '../types.mts';
import { DEFAULTS, TC, camelotCompat, headStart, isNum, sideOf, tempoDistance } from './score.mts';
import type { HeadStart, Summary, SummaryKey } from './score.mts';

export type TempoRelation = 'match' | 'near' | 'far' | 'unknown';
export type KeyRelation = 'match' | 'ok' | 'clash' | 'unknown';
export interface PairRelation {
  tempo: TempoRelation;
  tempoDist: number | null;
  tempoConf: number;
  key: KeyRelation;
  keyCompat: number | null;
  keyConf: number;
  cams: [string | null, string | null];
  bpms: [number | null, number | null];
}
type RelEdge = Partial<Pick<SummaryKey, 'bpm' | 'bpmConf' | 'camelot' | 'keyConf' | 'famConf'>>;

export function pairRelation(
  tail: RelEdge | null | undefined,
  head: RelEdge | null | undefined,
  minConf?: unknown,
): PairRelation {
  const rel = isNum(minConf) ? minConf : DEFAULTS.minConf;
  const d = tempoDistance(tail && tail.bpm, head && head.bpm);
  const tConf = d === null || !tail || !head ? 0 : Math.min(tail.bpmConf || 0, head.bpmConf || 0);
  let tempo: TempoRelation = 'unknown';
  if (d !== null && tConf >= rel) tempo = d <= TC.TEMPO_MATCH ? 'match' : d <= TC.TEMPO_NEAR ? 'near' : 'far';
  const kc = camelotCompat(tail && tail.camelot, head && head.camelot);
  // a clash needs both exact keys; a match may rest on the family confidence
  const kExact = kc === null || !tail || !head ? 0 : Math.min(tail.keyConf || 0, head.keyConf || 0);
  const kFamily =
    kc === null || !tail || !head
      ? 0
      : Math.min(Math.max(tail.famConf || 0, tail.keyConf || 0), Math.max(head.famConf || 0, head.keyConf || 0));
  let key: KeyRelation = 'unknown';
  if (kc !== null && kc >= 0.85 && kFamily >= rel) key = 'match';
  else if (kc !== null && kc >= 0.45 && kFamily >= rel) key = 'ok';
  else if (kc !== null && kc < 0.45 && kExact >= rel) key = 'clash';

  return {
    tempo,
    tempoDist: d,
    tempoConf: tConf,
    key,
    keyCompat: kc,
    keyConf: kExact,
    cams: [(tail && tail.camelot) || null, (head && head.camelot) || null],
    bpms: [tail && isNum(tail.bpm) ? tail.bpm : null, head && isNum(head.bpm) ? head.bpm : null],
  };
}

export type PairReason =
  | 'default'
  | 'no_next'
  | 'contrast_longer_fade'
  | 'wash_echo_out_tempo_change'
  | 'wash_cover_cut'
  | 'wash_into_quiet_head'
  | 'no_wash_key_clash'
  | 'contrast_pause'
  | 'punch_in';
export interface TransitionChoice {
  fadeOutSec: number | null;
  wash: boolean;
  extraWaitSec: number;
  fadeInSec: number;
  relation: PairRelation | null;
  start: HeadStart;
  reasons: PairReason[];
}

export function chooseTransition(
  prev: Summary | null | undefined,
  next: Summary | null | undefined,
  opts?: { washAllowed?: boolean } | null,
): TransitionChoice {
  const o = opts || {};
  const en = prev && prev.en;
  const out: TransitionChoice = {
    fadeOutSec: null,
    wash: false,
    extraWaitSec: 0,
    fadeInSec: TC.FADE_IN_SEC,
    relation: null,
    start: 'unknown',
    reasons: [],
  };

  if (!en || !en.kind || en.kind === 'unknown') {
    out.reasons.push('default');

    return out;
  }

  if (!next) {
    out.reasons.push('no_next');

    return out;
  }

  if (en.kind === 'abrupt') out.fadeOutSec = isNum(en.fadeSec) ? en.fadeSec : TC.FADE_MIN_SEC;

  const rel = pairRelation(sideOf(prev, 'tail'), sideOf(next, 'head'));
  const start = headStart(next);
  out.relation = rel;
  out.start = start;
  lengthenFadeOnContrast(out, en, rel);
  if (o.washAllowed) addWash(out, en, rel, start);
  pauseOnContrast(out, en, rel);
  punchIn(out, en, rel, start);
  if (!out.reasons.length) out.reasons.push('default');

  return out;
}

const contrastOf = (rel: PairRelation) => (rel.tempo === 'far' ? 1 : 0) + (rel.key === 'clash' ? 1 : 0);

function lengthenFadeOnContrast(out: TransitionChoice, en: Partial<Ending>, rel: PairRelation) {
  const contrast = contrastOf(rel);
  if (en.kind !== 'abrupt' || contrast === 0) return;

  out.fadeOutSec = Math.min(TC.FADE_MAX_SEC, Math.max(out.fadeOutSec ?? 0, TC.FADE_MIN_SEC + contrast));
  out.reasons.push('contrast_longer_fade');
}

// a fade-out has nothing left to carry and a stop is the point itself
function addWash(out: TransitionChoice, en: Partial<Ending>, rel: PairRelation, start: HeadStart) {
  if (en.kind !== 'abrupt' && en.kind !== 'decays') return;

  if (rel.key === 'clash') {
    out.reasons.push('no_wash_key_clash');

    return;
  }

  if (rel.key !== 'match' && rel.key !== 'ok') return;

  let reason: PairReason | null = null;
  if (rel.tempo === 'far') reason = 'wash_echo_out_tempo_change';
  else if (en.kind === 'abrupt') reason = 'wash_cover_cut';
  else if (start === 'soft' || start === 'silence_lead') reason = 'wash_into_quiet_head';

  if (reason) {
    out.wash = true;
    out.reasons.push(reason);
  }
}

function pauseOnContrast(out: TransitionChoice, en: Partial<Ending>, rel: PairRelation) {
  if (contrastOf(rel) < 2 || en.kind === 'stop') return;

  out.extraWaitSec = TC.CONTRAST_PAUSE_SEC;
  out.reasons.push('contrast_pause');
}

function punchIn(out: TransitionChoice, en: Partial<Ending>, rel: PairRelation, start: HeadStart) {
  const loudEnd =
    (en.kind === 'abrupt' || en.kind === 'stop') && isNum(en.endRelLu) && en.endRelLu >= TC.LOUD_END_REL_LU;
  if (start !== 'cut_in' || !loudEnd || rel.tempo !== 'match') return;

  out.fadeInSec = TC.FADE_IN_PUNCH_SEC;
  out.reasons.push('punch_in');
}
