import * as R from '../../shared/reorder.mts';
import type { RunLogEntry } from '../../shared/reorder.mts';
import type { Row } from '../dom-sync.mts';
import { t } from '../i18n.mts';
import { label } from './format.mts';
import type { ReorderStateView, Run } from './views.mts';

const reasonText = (run: NonNullable<Run>): string =>
  run.reason === 'user_input' && run.by
    ? t('roReason.withBy', { reason: label('roReason.', run.reason), by: label('roBy.', run.by) })
    : label('roReason.', run.reason);

function resultText(run: NonNullable<Run>): string {
  if (run.result === 'done') return t('ro.done', { n: run.moved || 0 });
  if (run.result === 'partial')
    return t('ro.partial', { n: run.moved || 0, of: run.planned || 0, reason: reasonText(run) });
  if (run.result === 'aborted') return t('ro.aborted', { reason: reasonText(run) });

  return t('ro.skipped', { reason: label('roReason.', run.reason) });
}

export function reorderRunText(run: Run): string {
  if (!run) return t('ro.none');
  const kind = run.kind ? label('roKind.', run.kind) : null;
  let s = resultText(run);
  if (run.method === 'menu' && (run.moved || 0) > 0) s += t('ro.byMenu');
  const when = typeof run.at === 'number' ? new Date(run.at).toLocaleTimeString() : '';

  return t('ro.line', { text: s, kind: kind || '–', at: when });
}

export const runsOf = (log: unknown): Run[] => (Array.isArray(log) ? (log as Run[]) : []);

// reorderLog is stored oldest first; rows are newest first.
export function reorderHistoryRows(log: unknown): Row[] {
  return runsOf(log)
    .filter((x): x is NonNullable<Run> => !!x && typeof x.at === 'number')
    .slice(-R.RUN_LOG_KEEP)
    .reverse()
    .map((run) => ({ key: String(run.at), cells: [[reorderRunText(run)]] }));
}

export function reorderLogForExport(log: unknown): RunLogEntry[] {
  return runsOf(log)
    .map(R.sanitizeRun)
    .filter((r): r is RunLogEntry => r !== null)
    .slice(-R.RUN_LOG_KEEP);
}

export function popupReorderText(log: unknown, reorderOn: boolean): string {
  const runs = runsOf(log);
  const last = runs[runs.length - 1] ?? null;
  if (!last && reorderOn) return t('ro.pending');

  return reorderRunText(last);
}

export function reorderStateText(r: ReorderStateView | null | undefined): string | null {
  if (!r) return null;
  if (r.state !== 'waiting') return label('roState.', r.state);

  return r.wait ? t('roState.waitingFor', { reason: label('roWait.', r.wait) }) : t('roState.waiting');
}
