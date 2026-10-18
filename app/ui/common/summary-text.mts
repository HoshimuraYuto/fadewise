import type { Pairs } from '../dom-sync.mts';
import { t } from '../i18n.mts';
import { fmt, label } from './format.mts';
import { STATUS_FRESH_MS, type RecentView, type Run, type StatusView } from './views.mts';

const RECENT_MS = 10 * 60 * 1000;

export function recentTransitionItems(rc: RecentView | null | undefined, nowMs?: number): string[] | null {
  const now = nowMs || Date.now();
  const tr = rc?.tr && now - rc.tr.at < RECENT_MS ? rc.tr : null;
  const gp = rc?.gapless && now - rc.gapless.at < RECENT_MS ? rc.gapless : null;
  if (gp && (!tr || gp.at >= tr.at)) return [t('sum.gapless')];
  if (!tr) return null;
  const parts = [t(tr.kind === 'live_trim' ? 'sum.trLive' : 'sum.tr', { s: fmt(tr.skipSec, 1) })];
  if (typeof tr.fadeSec === 'number') parts.push(t('sum.trFade', { s: fmt(tr.fadeSec, 1) }));
  if (typeof tr.headTrimSec === 'number' && tr.headTrimSec > 0)
    parts.push(t('sum.trHead', { s: fmt(tr.headTrimSec, 1) }));
  if (typeof tr.overlapSec === 'number' && tr.overlapSec > 0)
    parts.push(t('sum.trOverlap', { s: fmt(tr.overlapSec, 1) }));

  return parts;
}

export function recentTransitionText(rc: RecentView | null | undefined, nowMs?: number): string | null {
  return recentTransitionItems(rc, nowMs)?.join(t('plan.sep')) ?? null;
}

export function recentReorderText(run: Run, nowMs?: number): string | null {
  const now = nowMs || Date.now();
  if (!run || typeof run.at !== 'number' || now - run.at > RECENT_MS) return null;
  if (run.result === 'done' && (run.moved ?? 0) > 0) return t('sum.roDone', { n: run.moved });
  if (run.result === 'partial')
    return t('sum.roPartial', { n: run.moved || 0, reason: label('roReason.', run.reason) });
  if (run.result === 'aborted') return t('sum.roAborted', { reason: label('roReason.', run.reason) });

  return null;
}

const NO_GAIN_SOURCES = ['off', 'none', 'error'];

export function gainShortText(status: StatusView | null | undefined): string | null {
  if (!status || status.ad) return null;
  if (status.excluded || status.gainSource === 'excluded') return t('sum.gainExcluded');
  if (NO_GAIN_SOURCES.includes(status.gainSource ?? '') || typeof status.appliedGainDb !== 'number') return null;
  const db = status.appliedGainDb;
  if (Math.abs(db) < 0.05) return t('sum.gainZero');

  return t('sum.gain', { db: (db > 0 ? '+' : '') + fmt(db, 1), source: label('source.', status.gainSource) });
}

export function summaryPairs(status: StatusView | null | undefined, run: Run, nowMs?: number): Pairs | null {
  const now = nowMs || Date.now();
  if (!status?.at || now - status.at > STATUS_FRESH_MS) return null;
  const pairs: Pairs = [];
  const g = gainShortText(status);
  if (g) pairs.push([t('sum.gainLabel'), g]);
  const tr = recentTransitionItems(status.recent, now);
  if (tr) pairs.push([t('sum.trLabel'), tr]);
  const ro = recentReorderText(run, now);
  if (ro) pairs.push([t('sum.roLabel'), ro]);

  return pairs;
}
