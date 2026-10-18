import { t } from '../i18n.mts';
import { overlapAdaptText, overlapBasisText, overlapStyleText } from '../mix-text.mts';
import { fmt, label } from './format.mts';
import type { IncomingView, PairView, TransitionView } from './views.mts';

function pairRelation(p: PairView): string[] {
  const rel = [];
  if (p.tempo && p.tempo !== 'unknown') rel.push(label('pairTempo.', p.tempo));
  if (p.key && p.key !== 'unknown') rel.push(label('pairKey.', p.key));

  return rel;
}

function pairChanges(p: PairView): string[] {
  const rs = p.reasons ?? [];
  const mods = [];
  if (rs.includes('contrast_longer_fade') && typeof p.fadeOutSec === 'number')
    mods.push(t('pair.fade', { s: fmt(p.fadeOutSec, 1) }));
  if (p.wash) mods.push(t('tr.wash'));
  else if (rs.includes('no_wash_key_clash')) mods.push(t('pair.noWash'));
  if ((p.extraWaitSec ?? 0) > 0) mods.push(t('pair.pause', { s: fmt(p.extraWaitSec, 1) }));
  if (rs.includes('punch_in') && typeof p.fadeInSec === 'number')
    mods.push(t('pair.punch', { s: fmt(p.fadeInSec, 1) }));

  return mods;
}

export function pairText(p: PairView | null | undefined): string | null {
  if (!p) return null;
  const rel = pairRelation(p);
  const mods = pairChanges(p);
  if (p.reasons?.includes('no_next')) return t('pair.noNext');
  if (!rel.length && !mods.length) return null;

  return t('pair.line', {
    rel: rel.length ? rel.join(t('key.relatedSep')) : t('pair.unknown'),
    mods: mods.length ? mods.join(t('key.relatedSep')) : t('pair.as_is'),
  });
}

const resultText = (tr: TransitionView): string | null => {
  if (tr.result === 'cancelled' && tr.cancel) return t('action.cancel', { reason: label('trCancel.', tr.cancel) });

  return tr.result ? label('trState.', tr.result) : null;
};

function liveTrimText(tr: TransitionView): string {
  const done = typeof tr.atSec === 'number';
  const parts = [done ? t('tr.live_done', { at: fmt(tr.atSec, 1), skip: fmt(tr.skipSec, 1) }) : t('tr.live')];
  const result = resultText(tr);
  if (result) parts.push(result);

  return parts.join(t('plan.sep'));
}

function transitionHead(kind: string | undefined, vars: { at: string; skip: string }): string {
  if (kind === 'fade_trim') return t('tr.fade_trim', vars);
  if (kind === 'stop_wait') return t('tr.stop_wait', vars);

  return t('tr.trim', vars);
}

function overlapPart(tr: TransitionView): string {
  const why =
    overlapStyleText(tr.overlapStyle) || overlapAdaptText(tr.overlapAdapt) || overlapBasisText(tr.overlapBasis);

  return t('tr.overlap', { s: fmt(tr.overlapSec, 1) }) + (why ? t('sb.mixExitWhy', { why }) : '');
}

export function transitionText(tr: TransitionView | null | undefined): string {
  if (!tr) return t('tr.none', { reason: t('trReason.off') });
  if (tr.kind === 'live_trim') return liveTrimText(tr);
  if (tr.kind === 'none' || typeof tr.atSec !== 'number')
    return t('tr.none', { reason: label('trReason.', tr.reason) });
  const vars = { at: fmt(tr.atSec, 1), skip: fmt(tr.skipSec, 1) };
  const parts = [transitionHead(tr.kind, vars), t('tr.why', { reason: label('trReason.', tr.reason) })];
  if (typeof tr.overlapSec === 'number') parts.push(overlapPart(tr));
  const pair = pairText(tr.pair);
  if (pair) parts.push(pair);
  else if (tr.wash) parts.push(t('tr.wash'));
  const result = resultText(tr);
  if (result) parts.push(result);

  return parts.join(t('plan.sep'));
}

export function incomingText(i: IncomingView): string {
  const parts = [];
  if (typeof i.headTrimTo === 'number') parts.push(t('trIn.headTrim', { to: fmt(i.headTrimTo, 2) }));
  if (i.fadeIn) parts.push(t('trIn.fadeInSec', { s: fmt(typeof i.fadeInSec === 'number' ? i.fadeInSec : 0.3, 1) }));
  if (i.headReason === 'live') parts.push(t('trIn.live'));
  if (i.headReason === 'overlap') parts.push(t('trIn.overlap'));
  if (i.cancel) parts.push(t('trIn.cancel', { reason: i.cancel }));

  return parts.join(t('plan.sep')) || '–';
}
