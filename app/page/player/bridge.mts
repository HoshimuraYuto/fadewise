import type * as Analysis from '../../shared/analysis.mts';
import type { IndexEntry } from '../../shared/types.mts';
import { noteError, post, safe, TAG } from './common.mts';
import { releaseFade } from './fades.mts';
import { applyGainFor } from './gain.mts';
import { attachMeter, setPostTap } from './graph.mts';
import { ovWanted } from './overlap-core.mts';
import { ovCancel } from './overlap-events.mts';
import { ovRoute } from './overlap-graph.mts';
import { fadeStateFor } from './plan.mts';
import { isExcluded, type Player } from './state.mts';
import { cancelTransition } from './transition.mts';
import type { PlayerSettings } from './types.mts';
import { closeWash } from './wash.mts';
import { playerVideoId } from './youtube.mts';

type BridgeMessage = { [TAG]?: unknown; type?: unknown; data?: unknown } | null;

const unlockTrackGain = (pl: Player): void => {
  if (!pl.track) return;
  pl.track.locked = false;
  pl.track.decided = null;
};

function replanIdle(pl: Player): void {
  if (!pl.fade || pl.tr.state !== 'idle' || pl.ov.state !== 'idle') return;
  const keep = pl.fade.vid;
  pl.fade = null;
  fadeStateFor(pl, keep);
}

// A media element source cannot be undone, so the graph stays.
function detach(pl: Player): void {
  if (pl.detachedAt !== null) return;
  pl.detachedAt = Date.now();
  ovCancel(pl, 'off');
  cancelTransition(pl, 'off');
  pl.settings = Object.assign(pl.settings, {
    gainEnabled: false,
    fadesEnabled: false,
    transitions: false,
    transitionWash: false,
    overlap: false,
    reorder: false,
    reorderAlbums: false,
    saveAnalysis: false,
    postMeter: false,
  });
  releaseFade(pl, 'off');
  closeWash(pl, true);
  applyGainFor(pl, 'detached');
  pl.status.detached = true;
  if (__FADEWISE_VERIFY__) post(pl, 'diag', { kind: 'detached' });
}

function replanTransition(pl: Player): void {
  const fade = pl.fade;
  if (!fade || fade.gapless || isExcluded(pl, fade.vid) || fade.trDone) return;

  try {
    fade.tplan = pl.A.planTransition(pl.index[fade.vid] || null, {
      enabled: !!pl.settings.transitions,
      fadeOut: pl.settings.fadesEnabled && fade.plan ? fade.plan.fadeOut : null,
      overlap: ovWanted(pl) && !isExcluded(pl, fade.nextVid),
    });
  } catch (e) {
    noteError(pl, e);
  }
}

function onSettings(pl: Player, data: Partial<PlayerSettings>): void {
  pl.settings = Object.assign(pl.settings, data);
  const { settings } = pl;
  if (!ovWanted(pl)) ovCancel(pl, 'off');
  ovRoute(pl, !pl.video || pl.video.paused);
  unlockTrackGain(pl);
  if (!settings.fadesEnabled) releaseFade(pl, 'off');
  if (!settings.transitions && pl.tr.state !== 'idle') releaseFade(pl, 'off');
  if (!settings.transitionWash) closeWash(pl, true);
  const fade = pl.fade;

  if (fade && !fade.trDone && fade.tplan?.mix && (pl.tr.state === 'armed' || pl.ov.state === 'capture')) {
    fade.mixOff = true;
    fade.mixOffWhy = 'off';
    ovCancel(pl, 'off');
    cancelTransition(pl, 'off');
  }

  if (pl.fade && pl.tr.state === 'idle' && pl.ov.state === 'idle') replanIdle(pl);
  else replanTransition(pl);
  setPostTap(pl, !!__FADEWISE_VERIFY__ && !!settings.postMeter);
  applyGainFor(pl, 'settings');
}

function onExcluded(pl: Player, data: unknown[]): void {
  const next = new Set(data.filter((x): x is string => typeof x === 'string'));
  const vid = playerVideoId(pl);
  const changed = !!vid && pl.excluded.has(vid) !== next.has(vid);
  pl.excluded = next;

  if (changed) {
    ovCancel(pl, 'off');
    if (pl.tr.state !== 'idle') cancelTransition(pl, 'off');
    if (next.has(vid)) releaseFade(pl, 'off');
    unlockTrackGain(pl);
    applyGainFor(pl, 'excluded');
  }

  replanIdle(pl);
}

function onIndex(pl: Player, data: object): void {
  pl.index = {};
  for (const [vid, rec] of Object.entries(data)) pl.index[vid] = pl.A.indexEntryOf(rec as Analysis.RecordInput);
}

function onIndexEntry(pl: Player, data: unknown): void {
  const d = data as { vid?: unknown; entry?: IndexEntry | null };
  if (typeof d.vid === 'string' && d.vid) pl.index[d.vid] = d.entry;
}

function onWorkletUrl(pl: Player, url: string): void {
  pl.workletUrl = url;
  if (pl.connected && !pl.meterOk) void attachMeter(pl);
}

function onOverlapUrl(pl: Player, url: string): void {
  pl.overlapUrl = url;
  ovRoute(pl, !pl.video || pl.video.paused);
}

function onBridgeMessage(pl: Player, type: unknown, data: unknown): void {
  if (type === 'workletUrl' && typeof data === 'string' && !pl.workletUrl) onWorkletUrl(pl, data);
  else if (type === 'overlapUrl' && typeof data === 'string' && !pl.overlapUrl) onOverlapUrl(pl, data);
  else if (type === 'settings' && data) onSettings(pl, data);
  else if (type === 'index' && data) onIndex(pl, data);
  else if (type === 'excluded' && Array.isArray(data)) onExcluded(pl, data);
  else if (type === 'detached') detach(pl);
  else if (type === 'indexEntry' && data) onIndexEntry(pl, data);
  else if (type === 'statusRequest') post(pl, 'status', pl.status);
}

export function listenToBridge(pl: Player): void {
  pl.win.addEventListener(
    'message',
    safe(pl, (e: MessageEvent<BridgeMessage>) => {
      if (e.source !== pl.win || !e.data || e.data[TAG] !== 'bridge' || pl.detachedAt !== null) return;
      onBridgeMessage(pl, e.data.type, e.data.data);
    }),
  );
}
