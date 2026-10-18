import type { Player } from './state.mts';
import type { QueueInfo, Renderer, Row } from './types.mts';

const QUEUE_ROWS =
  'ytmusic-player-queue #contents > ytmusic-player-queue-item, ytmusic-player-queue #contents > ytmusic-playlist-panel-video-wrapper-renderer';

type RepeatHolder = HTMLElement & { repeatMode?: unknown; repeatMode_?: unknown };
type QueueState = { queue?: { repeatMode?: unknown } };
type QueueHolder = HTMLElement & { queue?: { store?: { store?: { getState?(): QueueState | null } } } };

const rendererOfRow = (row: Row | null | undefined): Renderer | null | undefined => {
  const d = row?.data;

  return (
    d &&
    (d.playlistPanelVideoRenderer ||
      d.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ||
      d)
  );
};

const idOf = (r: Renderer | null | undefined) => (typeof r?.videoId === 'string' ? r.videoId : null);
const isAlbum = (pl: Player, list: string | null) => pl.RO?.queueKind(list, null) === 'album';

function listOf(pl: Player): string | null {
  return new URL(pl.win.location.href).searchParams.get('list');
}

// watchEndpoint.index is kept through shuffles.
function albumPos(r: Renderer | null | undefined, list: string | null, noListMatches: boolean): number | null {
  const w = r?.navigationEndpoint?.watchEndpoint;
  const sameList = (noListMatches && !list) || w?.playlistId === list;

  return w && Number.isInteger(w.index) && sameList ? (w.index as number) : null;
}

function readQueue(pl: Player, vid: string, out: QueueInfo): void {
  let list: string | null = null;

  try {
    list = listOf(pl);
  } catch {
    /* ignore */
  }

  out.album = isAlbum(pl, list);
  const rows = pl.doc.querySelectorAll<Row>(QUEUE_ROWS);

  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].hasAttribute('selected')) continue;
    const cur = rendererOfRow(rows[i]);
    const next = rendererOfRow(rows[i + 1]);
    if (idOf(cur) !== vid) return;
    out.next = idOf(next);
    out.prev = i > 0 ? idOf(rendererOfRow(rows[i - 1])) : null;

    if (out.album && out.next) {
      const a = albumPos(cur, list, true);
      const b = albumPos(next, list, true);
      out.albumNext = a === null || b === null ? null : b === a + 1;
    }

    return;
  }
}

export function queueInfo(pl: Player, vid: string): QueueInfo {
  const out: QueueInfo = { next: null, album: false, albumNext: null };

  try {
    readQueue(pl, vid, out);
  } catch {
    /* ignore */
  }

  return out;
}

export const queueSignature = (q: QueueInfo): string => `${String(q.next)}|${String(q.album)}|${String(q.albumNext)}`;

export function gaplessIds(pl: Player): string[] {
  const out: string[] = [];
  let list: string | null;

  try {
    list = listOf(pl);
  } catch {
    return out;
  }

  if (!isAlbum(pl, list)) return out;
  const rows = [...pl.doc.querySelectorAll<Row>(QUEUE_ROWS)].map(rendererOfRow);

  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (!a || !b || typeof a.videoId !== 'string' || typeof b.videoId !== 'string') continue;
    const posA = albumPos(a, list, false);
    if (posA === null || albumPos(b, list, false) !== posA + 1) continue;
    const pair = pl.A.gaplessPair(pl.index[a.videoId] || null, pl.index[b.videoId] || null, {
      album: true,
      albumNext: true,
    });
    if (pair.on) out.push(a.videoId, b.videoId);
  }

  return out;
}

// YTM lays out ytmusic-player-bar or (newer layout, per session) ytmusic-miniplayer, never both.
export function nextButton(pl: Player): HTMLButtonElement | null {
  const { doc } = pl;

  return (
    doc.querySelector<HTMLButtonElement>('ytmusic-player-bar .next-button button') ||
    doc.querySelector<HTMLButtonElement>('ytmusic-player-bar .next-button') ||
    doc.querySelector<HTMLButtonElement>('ytmusic-miniplayer .ytmusicPlayerControlsNextButton button')
  );
}

function repeatFromQueue(pl: Player): unknown {
  try {
    return pl.doc.querySelector<QueueHolder>('ytmusic-player-queue')?.queue?.store?.store?.getState?.()?.queue
      ?.repeatMode;
  } catch {
    return null;
  }
}

function repeatMode(pl: Player): string | null {
  const bar = pl.doc.querySelector<RepeatHolder>('ytmusic-player-bar');
  const fromBar =
    bar && (bar.getAttribute('repeat-mode') || bar.getAttribute('repeat-mode_') || bar.repeatMode || bar.repeatMode_);
  if (typeof fromBar === 'string' && fromBar) return fromBar.toUpperCase();
  const fromQueue = repeatFromQueue(pl);
  if (typeof fromQueue === 'string' && fromQueue) return fromQueue.toUpperCase();
  // the miniplayer's button is pressed for both "all" and "one"
  const mini = pl.doc.querySelector('ytmusic-miniplayer .ytmusicPlayerControlsRepeatButton button');
  if (mini && mini.getAttribute('aria-pressed') === 'false') return 'NONE';

  return null;
}

export function nextBlocked(pl: Player, btn: HTMLButtonElement | null): string | null {
  if (!btn) return 'not_found';
  const host = btn.closest('.next-button, .ytmusicPlayerControlsNextButton');
  const hostDisabled = host && (host.hasAttribute('disabled') || host.getAttribute('aria-disabled') === 'true');
  if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || hostDisabled) return 'disabled';
  const rep = repeatMode(pl);
  if (rep === 'ONE') return 'repeat_one';
  // an unreadable miniplayer may be repeating one track
  if (rep === null && btn.closest('ytmusic-miniplayer')) return 'repeat_one';

  return null;
}
