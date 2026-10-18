export const ROW_SEL =
  'ytmusic-player-queue #contents > ytmusic-player-queue-item, ytmusic-player-queue #contents > ytmusic-playlist-panel-video-wrapper-renderer';
export const DROP_EVENT = 'ytmusic-reorderable-list-drop';
// YTM's newer layout has ytmusic-miniplayer instead of ytmusic-player-bar.
export const PLAY_BUTTON_SEL = [
  'ytmusic-player-bar #play-pause-button',
  'ytmusic-miniplayer .ytmusicPlayerControlsPlayPauseButton button',
] as const;

export function playButton(doc: Document): HTMLElement | null {
  for (const s of PLAY_BUTTON_SEL) {
    const b = doc.querySelector<HTMLElement>(s);
    if (b) return b;
  }

  return null;
}

// jsdom has no PointerEvent
export type PageWindow = Omit<Window & typeof globalThis, 'PointerEvent'> & { PointerEvent?: typeof PointerEvent };

interface RendererData {
  videoId?: unknown;
  playlistPanelVideoRenderer?: RendererData;
  playlistPanelVideoWrapperRenderer?: { primaryRenderer?: { playlistPanelVideoRenderer?: RendererData } };
  primaryRenderer?: { playlistPanelVideoRenderer?: RendererData };
}
export type Row = HTMLElement & { data?: RendererData | null };
interface QueueEl extends HTMLElement {
  queue?: { store?: { store?: { getState(): { queue?: { items?: unknown; isInfinite?: unknown } } | null } } };
}

export interface QueueRead {
  ids: string[];
  sel: number;
  store: (string | null)[] | null;
  list: string | null;
  infinite: boolean | null;
}

const rendererOf = (d: RendererData | null | undefined): RendererData | null | undefined =>
  d &&
  (d.playlistPanelVideoRenderer ||
    d.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ||
    d.primaryRenderer?.playlistPanelVideoRenderer ||
    d);

export const queueRows = (doc: Document) => Array.from(doc.querySelectorAll<Row>(ROW_SEL));

function videoIdOf(row: Row | undefined): string | null {
  const r = rendererOf(row?.data);

  return r && typeof r.videoId === 'string' ? r.videoId : null;
}

export const idsOf = (rows: Row[]) => rows.map(videoIdOf) as string[];
export const selectedIndex = (rows: Row[]) => rows.findIndex((e) => e.hasAttribute('selected'));
export const queueEl = (doc: Document) => doc.querySelector<QueueEl>('ytmusic-player-queue');

// ytmusic-player-queue's scrollTop stays 0; an ancestor scrolls the rows.
export function scrollerOf(win: PageWindow): Element | null {
  const doc = win.document;
  const q = queueEl(doc);

  for (let x: Node | null = q; x && x !== doc.documentElement; x = x.parentNode || (x as ShadowRoot).host) {
    if (x.nodeType !== 1) continue;
    const el = x as Element;
    let overflowY = '';

    try {
      overflowY = win.getComputedStyle(el).overflowY;
    } catch {
      /* ignore */
    }

    if (/auto|scroll/.test(overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
  }

  return q;
}

function storeState(doc: Document) {
  return queueEl(doc)?.queue?.store?.store?.getState()?.queue;
}

function storeIds(doc: Document): (string | null)[] | null {
  try {
    const items = storeState(doc)?.items;
    if (!Array.isArray(items)) return null;

    return items.map((x: RendererData) => (rendererOf(x)?.videoId as string | undefined) || null);
  } catch {
    return null;
  }
}

function storeInfinite(doc: Document): boolean | null {
  try {
    const queue = storeState(doc);

    return queue == null ? null : queue.isInfinite === true;
  } catch {
    return null;
  }
}

export function readQueue(win: PageWindow): QueueRead {
  const doc = win.document;
  const rows = queueRows(doc);
  let list: string | null = null;

  try {
    list = new URL(win.location.href).searchParams.get('list');
  } catch {
    /* ignore */
  }

  return { ids: idsOf(rows), sel: selectedIndex(rows), store: storeIds(doc), list, infinite: storeInfinite(doc) };
}

export function panelVisible(doc: Document): boolean {
  const app = doc.querySelector('ytmusic-app-layout');
  if (app && !app.hasAttribute('player-page-open')) return false;
  const row = queueRows(doc)[0] as Row | undefined;
  if (!row) return false;
  const box = row.getBoundingClientRect();

  return box.height > 0 && box.width > 0;
}

// YTM scrolls to the playing row a few seconds after "the music to play was updated".
export function queueSignature(win: PageWindow): string {
  const rows = queueRows(win.document);
  const scroller = scrollerOf(win);
  const top = scroller ? String(Math.round(scroller.scrollTop)) : '';

  return `${idsOf(rows).join(',')}|${String(selectedIndex(rows))}|${top}`;
}

// YTM takes a press as a click, which would act on these controls.
const CONTROL =
  'button, a, [role="button"], ytmusic-play-button-renderer, ytmusic-menu-renderer, ytmusic-like-button-renderer, ' +
  'tp-yt-paper-icon-button, yt-icon-button, ytmusic-item-thumbnail-overlay-renderer';

export function pressPoint(doc: Document, row: Row): { x: number; y: number; el: Element } | null {
  const r = row.getBoundingClientRect();

  for (const across of [0.45, 0.35, 0.55, 0.65]) {
    const x = r.x + r.width * across,
      y = r.y + r.height / 2;
    const el = doc.elementFromPoint(x, y);
    if (el && row.contains(el) && !el.closest(CONTROL)) return { x, y, el };
  }

  return null;
}

export function ytToastShown(win: PageWindow): boolean {
  type Toast = HTMLElement & { opened?: boolean };

  for (const e of win.document.querySelectorAll<Toast>('tp-yt-paper-toast, ytmusic-notification-action-renderer')) {
    if (typeof e.opened === 'boolean') {
      if (e.opened) return true;
      continue;
    }

    try {
      const r = e.getBoundingClientRect(),
        cs = win.getComputedStyle(e);
      if (r.height > 0 && r.width > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') return true;
    } catch {
      /* ignore */
    }
  }

  return false;
}
