import { JSDOM } from 'jsdom';
import type * as RP from '../../../page/reorder-page.mts';
import type { OrderKey } from '../../../shared/types.mts';

export const H = 40;
export const TOP = 60;
export const BOTTOM = 740;

export type Tk = OrderKey & Record<string, unknown>;

export interface SimTrack {
  tk?: Tk;
  d?: number;
}

export interface SimFlags {
  noDrop: boolean;
  storeLags: boolean;
  dropTwice: boolean;
  edgeScroll?: boolean;
  edgeStep?: number;
  menuNoEndpoint?: boolean;
  menuNeverOpens?: boolean;
}

export interface QueueSimOptions {
  ids: string[];
  sel?: number;
  list?: string;
  infinite?: boolean;
  tail?: number;
  flags?: Partial<SimFlags>;
  tracks?: Record<string, SimTrack>;
  settings?: Record<string, unknown>;
  timing?: RP.ReordererDeps['timing'];
}

type SimSettings = Record<string, unknown> & { reorder: boolean; reorderAlbums: boolean };
export type Row = HTMLElement & { data: { videoId: string } };
export type Flagged = HTMLElement & { opened: boolean; close?: () => void };
type SimEvent = (string | number | boolean)[];
export type TrustedEvent = Event & { __trusted?: boolean };

export const isTrusted = (e: Event) => (e as TrustedEvent).__trusted === true;

export const tick0 = () =>
  new Promise<void>((r) => {
    setTimeout(r, 0);
  });

export function createSimState(o: QueueSimOptions, list: string) {
  return {
    flags: Object.assign<SimFlags, Partial<SimFlags> | undefined>(
      { noDrop: false, storeLags: false, dropTwice: false },
      o.flags,
    ),
    events: [] as SimEvent[],
    scroll: 0,
    sel: 0,
    store: [] as string[],
    infinite: o.infinite !== undefined ? o.infinite : list.startsWith('RD'),
    playing: null as RP.Playing | null,
    clock: 0,
    wall: 1e12,
    menuOps: 0,
    menuClicks: [] as string[],
    edgeScrolls: 0,
    focus: true,
    fixedIds: null as string[] | null,
    settings: Object.assign<SimSettings, Record<string, unknown> | undefined>(
      { reorder: true, reorderAlbums: false },
      o.settings,
    ),
    tr: { state: 'idle', armAt: null as number | null },
    runs: [] as RP.RunRecord[],
    diag: [] as RP.Diag[],
    debug: [] as RP.DebugView[],
    qdom: null as unknown as RP.QueueDom,
    ro: null as unknown as RP.Reorderer,
    toastEl: null as unknown as Flagged,
  };
}

export type SimState = ReturnType<typeof createSimState>;

export interface RowHandlers {
  playButton(row: Row): void;
  menuButton(row: Row): void;
}

export interface QueuePage {
  w: RP.PageWindow;
  doc: Document;
  contents: Element;
  queue: Element;
  layout: Element;
  state: SimState;
  rows: () => Row[];
  ids: () => string[];
  selectedIndex: () => number;
  newRow: (vid: string) => Row;
}

function makeRow(doc: Document, vid: string, on: RowHandlers): Row {
  const row = doc.createElement('ytmusic-player-queue-item') as Row;
  row.data = { videoId: vid };

  const menu = doc.createElement('ytmusic-menu-renderer');
  const menuButton = doc.createElement('button');
  menu.appendChild(menuButton);
  row.appendChild(menu);

  const thumb = doc.createElement('ytmusic-play-button-renderer');
  thumb.className = 'thumb';
  row.appendChild(thumb);

  const info = doc.createElement('div');
  info.className = 'song-info';
  row.appendChild(info);

  thumb.addEventListener('click', () => {
    on.playButton(row);
  });
  menuButton.addEventListener('click', () => {
    on.menuButton(row);
  });

  return row;
}

export function createQueuePage(o: QueueSimOptions, list: string, on: RowHandlers): QueuePage {
  const dom = new JSDOM(
    `<!doctype html><html><body><ytmusic-app-layout player-page-open></ytmusic-app-layout>
    <ytmusic-player-queue><div id="contents"></div></ytmusic-player-queue><ytmusic-popup-container></ytmusic-popup-container></body></html>`,
    { url: `https://music.youtube.com/watch?v=${o.ids[0]}&list=${list}`, pretendToBeVisual: true },
  );
  const w = dom.window as unknown as RP.PageWindow;
  const doc = w.document;
  const contents = doc.querySelector('#contents')!;
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true });

  const rows = () => Array.from(contents.children) as Row[];

  return {
    w,
    doc,
    contents,
    queue: doc.querySelector('ytmusic-player-queue')!,
    layout: doc.querySelector('ytmusic-app-layout')!,
    state: createSimState(o, list),
    rows,
    ids: () => rows().map((e) => e.data.videoId),
    selectedIndex: () => rows().findIndex((e) => e.hasAttribute('selected')),
    newRow: (vid) => makeRow(doc, vid, on),
  };
}

export function resync(page: QueuePage): void {
  page.state.sel = page.selectedIndex();
  page.state.store = page.ids();
}

export function setSelected(page: QueuePage, i: number): void {
  page.rows().forEach((e, k) => {
    if (k === i) e.setAttribute('selected', '');
    else e.removeAttribute('selected');
  });
  page.state.sel = i;
}
