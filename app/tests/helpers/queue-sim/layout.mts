import { BOTTOM, H, TOP, type QueuePage, type Row } from './page.mts';

const box = (x: number, y: number, width: number, height: number) =>
  ({ x, y, top: y, bottom: y + height, left: x, right: x + width, width, height }) as DOMRect;

function installBoxes(page: QueuePage): void {
  const { w, queue, layout, state } = page;
  const panelOpen = () => layout.hasAttribute('player-page-open');

  w.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this === queue) return box(0, TOP, 400, BOTTOM - TOP);
    const i = page.rows().indexOf(this as Row);
    if (i < 0 || !panelOpen()) return box(0, 0, 0, 0);

    return box(10, TOP + i * H - state.scroll, 380, H);
  };

  page.doc.elementFromPoint = (x: number, y: number) => {
    if (!panelOpen() || y < TOP || y > BOTTOM) return null;
    const row = page.rows()[Math.floor((y - TOP + state.scroll) / H)] as Row | undefined;
    if (!row) return null;

    return x < 10 + 60 ? row.querySelector('.thumb') : row.querySelector('.song-info');
  };
}

function installScroll(page: QueuePage, tailRows: number): void {
  const { w, queue, state } = page;

  w.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    const i = page.rows().indexOf(this as Row);
    if (i >= 0) state.scroll = Math.max(0, i * H);
  };

  Object.defineProperty(queue, 'scrollTop', {
    get: () => state.scroll,
    set: (v: number) => {
      state.scroll = v;
    },
    configurable: true,
  });
  Object.defineProperty(queue, 'clientHeight', { get: () => BOTTOM - TOP, configurable: true });
  Object.defineProperty(queue, 'scrollHeight', {
    get: () => Math.max(BOTTOM - TOP, page.rows().length * H + tailRows * H),
    configurable: true,
  });
}

function installStore(page: QueuePage): void {
  const { queue, state } = page;
  const getState = () => ({
    queue: {
      items: state.store.map((v) => ({ playlistPanelVideoRenderer: { videoId: v } })),
      isInfinite: state.infinite,
    },
  });

  Object.assign(queue, { queue: { store: { store: { getState } } } });
}

export function installLayout(page: QueuePage, tailRows: number): void {
  installBoxes(page);
  installScroll(page, tailRows);
  installStore(page);
}
