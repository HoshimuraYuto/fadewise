import { currentKey, edgeOf } from '../../shared/tempo-key.mts';
import type { Ending, OrderKeyEdge } from '../../shared/types.mts';
import { t } from '../i18n.mts';
import { fmt, label, pct } from './format.mts';
import { hasSegments, tempoOf, type AlignView, type Num, type TempoKeyView } from './views.mts';

const RELIABLE_CONF = 0.5;
const provisional = (conf: Num): string => ((conf ?? 0) >= RELIABLE_CONF ? '' : t('tempo.provisional'));

export function endingText(en: Partial<Ending> | null | undefined): string {
  if (!en) return t('ending.none');
  const parts = [label('ending.', en.kind)];
  if (en.kind === 'abrupt' && typeof en.fadeSec === 'number')
    parts.push(t('ending.fadeSec', { s: en.fadeSec.toFixed(1) }));
  if (typeof en.silenceSec === 'number') parts.push(t('ending.silence', { s: en.silenceSec.toFixed(1) }));

  return parts.join(t('plan.sep'));
}

export function tempoText(tk: TempoKeyView): string {
  const tp = tempoOf(tk);
  if (!tp || typeof tp.bpm !== 'number') return t('tempo.none');
  const parts = [t('tempo.bpm', { bpm: tp.bpm.toFixed(1) })];
  if (tp.alt?.length) parts.push(tp.alt.includes('half') ? t('tempo.half') : t('tempo.double'));
  parts.push(t('tempo.conf', { pct: pct(tp.confidence) }) + provisional(tp.confidence));

  return parts.join(' ');
}

export function keyText(tk: TempoKeyView): string {
  const k = currentKey(tk);
  if (!k?.name) return t('tempo.none');
  let s = t('key.value', { name: k.name, camelot: k.camelot, pct: pct(k.confidence) }) + provisional(k.confidence);
  const rel = k.related.map((r) => t('key.relatedItem', { name: r.name, camelot: r.camelot }));
  if (rel.length) s += t('key.related', { list: rel.join(t('key.relatedSep')) });

  return s;
}

const edgeText = (x: OrderKeyEdge): string => {
  const k = x.cam ? t('edge.key', { cam: x.cam }) + provisional(x.kc) : t('edge.noKey');
  const b = typeof x.bpm === 'number' ? t('tempo.bpm', { bpm: x.bpm.toFixed(0) }) + provisional(x.bc) : '';

  return [k, b].filter(Boolean).join(' ');
};

const fromSegment = (h: OrderKeyEdge, e: OrderKeyEdge): boolean =>
  [h.src.key, e.src.key, h.src.tempo, e.src.tempo].includes('segment');

function edgeChanges(h: OrderKeyEdge, e: OrderKeyEdge): string[] {
  const changes = [];
  const keysDiffer = h.cam && e.cam && h.cam !== e.cam && h.kc >= RELIABLE_CONF && e.kc >= RELIABLE_CONF;
  if (h.chg.key || e.chg.key || keysDiffer) changes.push(t('edge.keyChange'));
  if (h.chg.tempo || e.chg.tempo) changes.push(t('edge.tempoChange'));

  return changes;
}

export function edgesText(tk: TempoKeyView): string | null {
  if (!hasSegments(tk)) return null;
  let h: OrderKeyEdge, e: OrderKeyEdge;

  try {
    h = edgeOf(tk, 'head');
    e = edgeOf(tk, 'tail');
  } catch {
    return null;
  }

  if (!fromSegment(h, e)) return null;
  const changes = edgeChanges(h, e);
  const line = t('edge.line', { head: edgeText(h), tail: edgeText(e) });

  return line + (changes.length ? t('edge.changes', { list: changes.join(t('key.relatedSep')) }) : '');
}

export const unitText = (a: AlignView): string =>
  a.mode === 'bar' ? t('align.unitBar', { n: (a.beats || 0) / 4 }) : t('align.unitBeat');

export function alignText(a: AlignView | null | undefined): string {
  if (!a) return t('align.none');

  if (!a.on) {
    const lowConf = a.reason === 'low_confidence' && typeof a.conf === 'number';
    const extra = lowConf ? t('align.pct', { pct: pct(a.conf) }) : '';

    return t('align.off', { reason: label('reason.', a.reason) + extra });
  }

  return t('align.on', {
    bpm: fmt(a.bpm),
    unit: unitText(a),
    end: a.endOnBeat ? t('align.endBeat') : t('align.endSound'),
  });
}
