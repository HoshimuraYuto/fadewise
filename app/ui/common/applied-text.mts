import { t } from '../i18n.mts';
import { fmt, label } from './format.mts';
import { unitText } from './track-text.mts';
import { pairText } from './transition-text.mts';
import type { AppliedView } from './views.mts';

type Applied = NonNullable<AppliedView>;

function gainPart(g: NonNullable<Applied['gain']>): string {
  const why = [label('source.', g.source)];
  if (g.limit) why.push(t('applied.limit', { limit: label('limit.', g.limit), want: fmt(g.wantedDb, 1) }));

  return t('applied.gain', { db: fmt(g.db, 1), why: why.join(t('plan.sep')) });
}

function fadeOutPart(fo: NonNullable<Applied['fadeOut']>): string {
  const cancelled = fo.state === 'cancelled' && fo.cancel;
  const state = cancelled ? t('fadeState.cancelledBy', { reason: fo.cancel }) : label('fadeState.', fo.state);
  const al = fo.align;
  let align = '';
  if (al?.on) align = t('applied.alignOn', { unit: unitText(al) });
  else if (al) align = t('applied.alignOff', { reason: label('reason.', al.reason) });

  return t('applied.fadeOut', { state }) + align;
}

function transitionPart(tr: NonNullable<Applied['transition']>): string {
  const cancelled = tr.state === 'cancelled' && tr.cancel;
  const state = cancelled
    ? t('fadeState.cancelledBy', { reason: label('trCancel.', tr.cancel) })
    : label('trState.', tr.state);
  let s = t('applied.transition', { state, kind: label('trReason.', tr.reason) });
  if (typeof tr.atSec === 'number') s += t('applied.transitionAt', { at: fmt(tr.atSec, 1) });
  const pair = pairText(tr.pair);
  if (pair) s += t('plan.sep') + pair;

  return s;
}

function listenParts(last: Applied): string[] {
  const parts = [];
  if (last.gain) parts.push(gainPart(last.gain));
  if (last.fadeOut) parts.push(fadeOutPart(last.fadeOut));
  if (last.fadeIn?.done) parts.push(t('plan.fadeIn'));
  if (typeof last.skipAtSec === 'number') parts.push(t('plan.skip', { at: fmt(last.skipAtSec) }));
  const tr = last.transition;
  if (tr?.kind && tr.kind !== 'none') parts.push(transitionPart(tr));

  return parts;
}

export function appliedText(list: unknown): string {
  const xs = (Array.isArray(list) ? (list as unknown[]) : []).filter((x): x is Applied => !!x && typeof x === 'object');
  if (!xs.length) return t('applied.none');
  const parts = listenParts(xs[xs.length - 1]);
  let s = parts.length ? parts.join(t('plan.sep')) : t('applied.none');
  const earlier = xs
    .slice(0, -1)
    .reverse()
    .map((x) => (x.gain ? fmt(x.gain.db, 1) : '–'));
  if (earlier.length) s += t('applied.earlier', { list: earlier.join(t('key.relatedSep')) });

  return s;
}

// known number and code fields only, so no title or id can slip into a copy
const SWITCH_NUM = ['leadSec', 'planLeadSec', 'rate', 'waitSec', 'headSec', 'oldLastSec', 'playSec', 'firstSec'];
const SWITCH_NUM2 = ['remEndSec', 'dipSec', 'beatMiss'];
const SWITCH_CODE = ['by', 'kind', 'shape', 'style', 'adapt', 'cancel', 'beat'];

const codeOrNull = (x: unknown) => (typeof x === 'string' && /^[a-z_]{1,24}$/.test(x) ? x : null);
const numOrNull = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

function switchRow(x: unknown): Record<string, unknown> {
  const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const o: Record<string, unknown> = { overlap: r.overlap === true };
  for (const k of SWITCH_CODE) o[k] = codeOrNull(r[k]);
  for (const k of [...SWITCH_NUM, ...SWITCH_NUM2]) o[k] = numOrNull(r[k]);

  return o;
}

export function switchesText(list: unknown, version: string): string {
  if (!Array.isArray(list) || !list.length) return '';

  return JSON.stringify({ fadewise: version, switches: (list as unknown[]).slice(-5).map(switchRow) });
}
