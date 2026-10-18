import { createOwnScrolls, type Span } from './drag-geometry.mts';
import { drag, type DragOptions, type MoveResult, type Note, type Sleep, type StopCheck } from './drag.mts';
import {
  idsOf,
  panelVisible,
  playButton,
  queueRows,
  queueSignature,
  readQueue,
  scrollerOf,
  selectedIndex,
  ytToastShown,
  type PageWindow,
} from './queue-panel.mts';
import { playNextMove, type MenuTiming } from './row-menu.mts';

export interface QueueDomOptions extends DragOptions, MenuTiming {
  // timers are throttled in a hidden tab
  sleep?: Sleep;
  isTrusted?: (e: Event) => boolean;
}

const DEFAULTS: QueueDomOptions = {
  stepPx: 3,
  stepMs: 16,
  settleMs: 120,
  maxSteps: 600,
  dropWaitMs: 700,
  menuWaitMs: 2000,
  menuPollMs: 100,
  actionWaitMs: 900,
  scrollWaitMs: 300,
  moveTimeoutMs: 15000,
  // not the real mouse's 1, or a real press during our drag goes to the dragged row
  pointerId: 7,
  edgePx: 160,
  maxHops: 4,
};

export function createQueueDom(win: PageWindow, opts?: Partial<QueueDomOptions> | null) {
  const o: QueueDomOptions = Object.assign({}, DEFAULTS, opts || {});
  const doc = win.document;
  const scrolls = createOwnScrolls();
  let note: Note | null = null;

  const sleep: Sleep =
    o.sleep ||
    ((ms) =>
      new Promise<void>((resolve) => {
        win.setTimeout(resolve, ms);
      }));

  const env = { win, o, sleep, trusted: o.isTrusted || ((e: Event) => e.isTrusted), scrolls, note: () => note };

  function restoreScroll(top: unknown): boolean {
    const scroller = scrollerOf(win);
    if (!scroller || typeof top !== 'number' || Math.abs(scroller.scrollTop - top) < 2) return false;
    scrolls.scrollTo(scroller, top, 'restore');

    return true;
  }

  function resume(): boolean {
    const button = playButton(doc);
    if (!button) return false;
    button.click();

    return true;
  }

  return {
    read: () => readQueue(win),
    panelVisible: () => panelVisible(doc),
    drag: (vid: string, to: number, shouldStop: StopCheck, ahead?: Span[] | null): Promise<MoveResult> =>
      drag(env, vid, to, shouldStop, ahead),
    playNextMove: (vid: string) => playNextMove(win, o, sleep, vid),
    rows: () => queueRows(doc),
    scrollState: () => scrollerOf(win)?.scrollTop ?? null,
    restoreScroll,
    signature: () => queueSignature(win),
    resume,
    ytToast: () => ytToastShown(win),
    ids: () => idsOf(queueRows(doc)),
    selIndex: () => selectedIndex(queueRows(doc)),
    ownScroll: scrolls.own,
    setNote: (fn: Note | null) => {
      note = fn;
    },
  };
}

export type QueueDom = ReturnType<typeof createQueueDom>;
