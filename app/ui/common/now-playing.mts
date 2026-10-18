import { syncPairs, type Pairs } from '../dom-sync.mts';
import { t } from '../i18n.mts';
import { nextLines } from '../mix-text.mts';
import { fmt, label } from './format.mts';
import { reorderStateText } from './reorder-text.mts';
import { alignText, edgesText, endingText, keyText, tempoText } from './track-text.mts';
import { incomingText, transitionText } from './transition-text.mts';
import { STATUS_FRESH_MS, type FadeView, type RecordView, type StatusView } from './views.mts';

type Add = (key: string, value: unknown) => void;

function fadePlanText(f: FadeView): string {
  const plan = [];
  if (f.fadeIn) plan.push(t('plan.fadeIn'));
  if (typeof f.fadeOutStart === 'number')
    plan.push(t('plan.fadeOut', { from: fmt(f.fadeOutStart), to: fmt(f.fadeOutEnd) }));
  if (plan.length) return plan.join(t('plan.sep'));

  return f.planReason === 'no_analysis' ? t('plan.noneUnanalysed') : t('plan.noneNotNeeded');
}

function lastActionText(a: string | null | undefined): string | null {
  if (!a) return null;

  return a.startsWith('cancel:') ? t('action.cancel', { reason: a.slice(7) }) : label('action.', a);
}

function addFade(add: Add, f: FadeView, rec: RecordView | null | undefined): void {
  add('now.ending', endingText(rec?.ending));
  add('now.fade', fadePlanText(f));
  if (typeof f.fadeOutStart === 'number') add('now.align', alignText(f.align));
  if (f.transition) add('now.transition', transitionText(f.transition));
  if (f.transition?.incoming) add('now.transitionIn', incomingText(f.transition.incoming));
  const nx = f.transition ? nextLines(f.transition.next, null) : [];
  if (nx.length) add('now.mixNext', nx.join(t('mix.lineSep')));
  const action = lastActionText(f.lastAction);
  if (action) add('now.action', action);
}

function addTrack(add: Add, status: StatusView, rec: RecordView | null | undefined, brief: boolean): void {
  add('now.state', label('state.', status.state));
  if (!brief) add('now.track', rec?.title ? `${rec.title} / ${rec.artist || ''}` : status.videoId || '–');
  if (status.excluded) add('now.excluded', t('now.excludedValue'));
  if (brief) return;
  const source = status.gainSource ? label('source.', status.gainSource) : '–';
  add('now.gain', t('now.gainValue', { db: fmt(status.appliedGainDb, 2), source }));
}

function addAnalysis(add: Add, status: StatusView, rec: RecordView | null | undefined): void {
  add('now.bpm', tempoText(rec?.tempoKey));
  add('now.key', keyText(rec?.tempoKey));
  const edges = edgesText(rec?.tempoKey);
  if (edges) add('now.edges', edges);
  add('now.analysed', t('now.seconds', { n: fmt(status.sessionAcceptedSec) }));
  if (status.tempoKey)
    add('now.tk', t('now.tkValue', { sec: fmt(status.tempoKey.fluxSec), seg: status.tempoKey.segments }));
  if (status.errors) add('now.errors', t('now.errorsValue', { n: status.errors, msg: status.lastError || '' }));
}

export function nowPairs(
  status: StatusView | null | undefined,
  rec: RecordView | null | undefined,
  opts?: { brief?: boolean },
): Pairs | null {
  if (!status?.at || Date.now() - status.at > STATUS_FRESH_MS) return null;
  const pairs: Pairs = [];

  const add: Add = (k, v) => {
    pairs.push([t(k), String(v)]);
  };

  addTrack(add, status, rec, !!opts?.brief);
  const f = status.fade && status.fade.vid === status.videoId ? status.fade : null;
  if (f?.gapless) add('now.gapless', t('now.gaplessValue'));
  if (f && !status.excluded) addFade(add, f, rec);
  if (status.reorder && status.reorder.state !== 'idle') add('now.reorder', reorderStateText(status.reorder));
  addAnalysis(add, status, rec);

  return pairs;
}

let recCache: { vid: string | null; rec: RecordView | null; stale: boolean } = { vid: null, rec: null, stale: true };

export function invalidateNowRecord(): void {
  recCache.stale = true;
}

export async function renderNow(
  container: Element,
  opts?: { brief?: boolean },
): Promise<{ status: StatusView | null; rec: RecordView | null }> {
  const status = (await chrome.storage.session.get('status')).status as StatusView | undefined;
  const vid = status?.videoId;

  if (vid && (recCache.stale || recCache.vid !== vid)) {
    const key = 'track:' + vid;
    const stored = (await chrome.storage.local.get(key))[key] as RecordView | undefined;
    recCache = { vid, rec: stored ?? null, stale: false };
  }

  const rec = vid ? recCache.rec : null;
  syncPairs(container, nowPairs(status, rec, opts), t('now.none'));

  return { status: status ?? null, rec };
}
