import type { MixKind } from '../shared/types.mts';
import { t } from './i18n.mts';

// = MIX.windowSec; importing it would pull the analysis into the content script
export const WINDOW_SEC = '50';

export interface MixCand {
  k: MixKind;
  t: number;
  c: number | null;
}
export interface MixSummary {
  rank: 0 | 1 | 2; // none | gentle | aggressive
  best: number | null;
  full: number;
  x: MixCand[];
  n: MixCand[];
  noTempo: boolean;
}
export interface NextPlan {
  n?: { k: string; t: number; c?: number | null } | null;
  why?: string | null;
  differs?: boolean;
  nextMx?: boolean;
  cost?: number | null;
  skip?: { why?: string | null; aggrCost?: number | null } | null;
}
export interface LooseRecord {
  mix?: unknown;
  tempoKey?: { tempo?: { bpm?: unknown } | null } | null | undefined;
}
interface LooseMix {
  v?: unknown;
  x?: unknown;
  n?: unknown;
  h?: unknown;
  g?: unknown;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
// = MIX_KINDS; importing it would pull the analysis into the pages and the seek bar script
const KINDS: readonly MixKind[] = ['first', 'thin', 'lift', 'last', 'fade', 'chorusEnd'];
const AGGR = new Set<string>(['lift', 'chorusEnd']);
const pad2 = (n: number) => String(n).padStart(2, '0');

function clockPos(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);

  return `${String(m)}:${pad2(Math.floor(s % 60))}.${String(Math.floor((s * 10) % 10))}`;
}

const c2 = (c: unknown) => (isNum(c) ? c.toFixed(2) : '-');

const candOf = (r: unknown): MixCand | null => {
  if (!Array.isArray(r) || !isNum(r[0]) || typeof r[1] !== 'number') return null;
  const k = KINDS[r[1]] as MixKind | undefined;

  return k ? { k, t: r[0], c: isNum(r[2]) ? r[2] : null } : null;
};

const candsOf = (list: unknown[]) =>
  list
    .map(candOf)
    .filter((c): c is MixCand => c !== null)
    .sort((a, b) => a.t - b.t);

function mixSummary(rec: LooseRecord | null | undefined): MixSummary {
  const m = rec?.mix as LooseMix | null | undefined;
  const out: MixSummary = { rank: 0, best: null, full: 0, x: [], n: [], noTempo: !isNum(rec?.tempoKey?.tempo?.bpm) };
  if (!m || typeof m !== 'object' || m.v !== 1 || !Array.isArray(m.x) || !Array.isArray(m.n)) return out;
  const xs = m.x as unknown[],
    ns = m.n as unknown[];
  out.x = candsOf(xs);
  out.n = candsOf(ns);
  const h = Array.isArray(m.h) ? (m.h as unknown[])[2] : null;
  out.full = typeof h === 'number' && Number.isInteger(h) ? h : 0;
  // planMix edge() falls back to a row's tempo, then the bar grid's
  const g = Array.isArray(m.g) ? (m.g as unknown[])[0] : null;
  if (xs.concat(ns).some((r) => Array.isArray(r) && isNum(r[4])) || isNum(g)) out.noTempo = false;
  if (!out.x.length && !out.n.length) return out;
  const ag = out.x.concat(out.n).filter((c) => AGGR.has(c.k));
  out.rank = ag.length ? 2 : 1;
  if (ag.length) out.best = Math.max(...ag.map((c) => c.c ?? 0));

  return out;
}

const mixRank = (rec: LooseRecord | null | undefined): number => {
  const s = mixSummary(rec);

  return s.rank * 1000 + (s.best !== null ? Math.round(s.best * 100) : 0) + Math.min(9, s.full);
};

function mixCellText(s: MixSummary): string {
  if (!s.rank) return t('mix.state.none');
  const head = s.rank === 2 ? t('mix.state.aggr', { c: c2(s.best) }) : t('mix.state.gentle');

  return head + t('mix.full', { n: s.full });
}

const candText = (c: MixCand) =>
  t('mix.cand', { kind: t('mixKind.' + c.k), pos: clockPos(c.t) }) +
  (AGGR.has(c.k) || c.k === 'thin' || c.k === 'fade' ? t('mix.conf', { c: c2(c.c) }) : '');

function mixCellTitle(s: MixSummary): string {
  const lines = [];
  if (!s.rank) lines.push(t('mix.noneHint'));
  if (s.x.length) lines.push(t('mix.exits', { list: s.x.map(candText).join(t('mix.sep')) }));
  if (s.n.length) lines.push(t('mix.entries', { list: s.n.map(candText).join(t('mix.sep')) }));
  if (!s.full) lines.push(t('mix.needFull'));
  if (s.noTempo) lines.push(t('mix.noTempo'));

  return lines.join('\n');
}

function nextLines(nx: NextPlan | null | undefined, title: string | null): string[] {
  if (!nx) return [];
  const out = [];
  const name = title && !nx.differs ? title : null;

  if (nx.n) {
    let e = t('mixNext.entry', { kind: t('mixKind.' + nx.n.k), pos: clockPos(nx.n.t) });
    if (nx.n.k !== 'first') e += t('mixNext.conf', { c: c2(nx.n.c) });
    if (nx.nextMx === false) e += t('mixNext.noCand');
    out.push(name ? t('mixNext.line', { title: name, entry: e }) : t('mixNext.lineNoTitle', { entry: e }));
  } else {
    const why = t('mixWhy.' + (nx.why || 'off'), { s: WINDOW_SEC });
    out.push(name ? t('mixNext.none', { title: name, why }) : t('mixNext.noneNoTitle', { why }));
  }

  if (nx.differs) out.push(t('mixNext.differs'));

  if (nx.skip?.why) {
    const why =
      nx.skip.why === 'cost' && isNum(nx.skip.aggrCost) && isNum(nx.cost)
        ? t('mixSkip.costN', { a: nx.skip.aggrCost.toFixed(2), b: nx.cost.toFixed(2) })
        : t('mixSkip.' + nx.skip.why, { s: WINDOW_SEC });
    out.push(t('mixSkip.line', { why }));
  }

  return out;
}

function fromLine(
  from: { k?: string | null; t?: number | null; match?: boolean } | null | undefined,
  title: string | null,
): string | null {
  if (!from?.k) return null;
  const v = { kind: t('mixKind.' + from.k), pos: isNum(from.t) ? clockPos(from.t) : '-' };

  return title && from.match ? t('mixFrom.line', { title, ...v }) : t('mixFrom.lineNoTitle', v);
}

function overlapAdaptText(
  a: { why?: string; cams?: readonly string[] | null; bpms?: readonly number[] | null } | null | undefined,
): string | null {
  if (!a?.why || !['key_clash', 'tempo_far', 'both'].includes(a.why)) return null;
  const parts = [];
  if (a.why !== 'tempo_far' && a.cams) parts.push(`${a.cams[0]} → ${a.cams[1]}`);
  if (a.why !== 'key_clash' && a.bpms) parts.push(`${String(a.bpms[0])} → ${String(a.bpms[1])} BPM`);

  return t('ovAdapt.' + a.why, {
    detail: parts.length ? t('ovAdapt.detail', { d: parts.join(t('key.relatedSep')) }) : '',
  });
}

function overlapBasisText(
  b: { out?: string; in?: string | null; long?: string | null } | null | undefined,
): string | null {
  if (!b?.out) return null;
  const parts = [t('ovOut.' + b.out)];
  if (b.in) parts.push(t('ovIn.' + b.in));
  else if (b.long) parts.push(t('ovLong.' + b.long));

  return parts.join(t('ovBasis.sep'));
}

const BEAT_WHY = new Set([
  'grids',
  'aligned',
  'no_tempo',
  'old_unsteady',
  'new_unsteady',
  'starts_at_once',
  'mix_point',
  'no_room',
  'no_rush',
]);

function overlapBeatText(b: string | { why?: string } | null | undefined): string {
  const why = typeof b === 'string' ? b : b?.why;
  if (typeof why !== 'string') return '';
  if (BEAT_WHY.has(why)) return t('ovBeat.' + why);

  return why.startsWith('rush_') ? t('ovBeat.interrupted') : '';
}

function overlapStyleText(
  s:
    | {
        kind?: string;
        why?: string;
        aligned?: string | null;
        bpms?: readonly (number | null)[] | null;
        beat?: string | { why?: string } | null;
      }
    | null
    | undefined,
): string | null {
  if (!s?.kind || !['tail', 'blend', 'segue'].includes(s.kind)) return null;
  const why = typeof s.why === 'string' ? s.why : '';
  const how = s.kind === 'blend' && s.aligned ? 'ovStyle.blend_' + s.aligned : 'ovStyle.' + s.kind;
  const b = s.bpms;
  const detail =
    b && b.length === 2 && typeof b[0] === 'number' && typeof b[1] === 'number' && why !== 'cut' && why !== 'stop'
      ? t('ovAdapt.detail', { d: `${String(Math.round(b[0]))} → ${String(Math.round(b[1]))} BPM` })
      : '';

  return t('ovStyleWhy.' + why) + t(how) + detail + (s.kind === 'blend' ? overlapBeatText(s.beat) : '');
}

export {
  overlapStyleText,
  clockPos,
  mixSummary,
  mixRank,
  mixCellText,
  mixCellTitle,
  nextLines,
  fromLine,
  overlapAdaptText,
  overlapBasisText,
};
