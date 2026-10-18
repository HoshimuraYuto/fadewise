import { idsOf, queueRows, selectedIndex, type PageWindow, type Row } from './queue-panel.mts';
import type { MoveResult, Sleep } from './drag.mts';

interface MenuData {
  icon?: { iconType?: string };
  serviceEndpoint?: {
    queueAddEndpoint?: { queueInsertPosition?: string; queueTarget?: { videoId?: string } };
    removeFromQueueEndpoint?: { videoId?: string };
  };
}
type MenuItem = HTMLElement & { data?: MenuData };
type Dropdown = HTMLElement & { opened?: boolean };

export interface MenuTiming {
  menuWaitMs: number;
  menuPollMs: number;
  actionWaitMs: number;
}

// matched by icon and endpoint: a hidden tab's dropdown has no boxes
const MENU_ITEMS = {
  next: (x: MenuData, vid: string) => {
    const add = x.serviceEndpoint?.queueAddEndpoint;

    return (
      x.icon?.iconType === 'QUEUE_PLAY_NEXT' &&
      !!add &&
      add.queueInsertPosition === 'INSERT_AFTER_CURRENT_VIDEO' &&
      !!add.queueTarget &&
      add.queueTarget.videoId === vid
    );
  },
  remove: (x: MenuData, vid: string) => {
    const remove = x.serviceEndpoint?.removeFromQueueEndpoint;

    return x.icon?.iconType === 'REMOVE' && !!remove && remove.videoId === vid;
  },
};
type MenuKind = keyof typeof MENU_ITEMS;

const dropdowns = (doc: Document) =>
  Array.from(doc.querySelectorAll<Dropdown>('ytmusic-popup-container tp-yt-iron-dropdown'));

function findMenuItem(doc: Document, kind: MenuKind, vid: string): MenuItem | null {
  for (const d of dropdowns(doc)) {
    if (!d.opened) continue;

    for (const e of d.querySelectorAll<MenuItem>('ytmusic-menu-service-item-renderer')) {
      const x = e.data;

      try {
        if (x?.icon && x.serviceEndpoint && MENU_ITEMS[kind](x, vid)) return e;
      } catch {
        /* other shape */
      }
    }
  }

  return null;
}

// Escape, not a click on body: that could reach the player
function dismissMenu(win: PageWindow): void {
  for (const d of dropdowns(win.document)) {
    if (!d.opened) continue;

    try {
      const init = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, composed: true };
      d.dispatchEvent(new win.KeyboardEvent('keydown', init));
    } catch {
      /* ignore */
    }
  }
}

async function menuPick(
  win: PageWindow,
  o: MenuTiming,
  sleep: Sleep,
  pick: { row: Row | undefined; kind: MenuKind; vid: string },
): Promise<string | null> {
  const button = pick.row?.querySelector<HTMLElement>(
    'ytmusic-menu-renderer yt-button-shape button, ytmusic-menu-renderer button',
  );
  if (!button) return 'no_button';
  button.click();
  let item: MenuItem | null = null;

  for (let waited = 0; !item && waited <= o.menuWaitMs; waited += o.menuPollMs) {
    await sleep(o.menuPollMs);
    item = findMenuItem(win.document, pick.kind, pick.vid);
  }

  if (!item) {
    dismissMenu(win);

    return dropdowns(win.document).some((d) => d.opened) ? 'menu_open' : 'no_item';
  }

  item.click();
  await sleep(o.actionWaitMs);
  dismissMenu(win);

  return null;
}

// next slot only: "Play next" adds a copy after the playing row, then the original row is removed
export async function playNextMove(win: PageWindow, o: MenuTiming, sleep: Sleep, vid: string): Promise<MoveResult> {
  const doc = win.document;
  const ids = () => idsOf(queueRows(doc));
  const orig = ids().indexOf(vid);
  if (orig < 0) return { ok: false, reason: 'not_found' };
  const addError = await menuPick(win, o, sleep, { row: queueRows(doc)[orig], kind: 'next', vid });
  if (addError) return { ok: false, reason: 'menu', detail: addError };
  const added = ids();
  const sel = selectedIndex(queueRows(doc));
  const positions = added.map((v, i) => (v === vid ? i : -1)).filter((i) => i >= 0);
  const origNow = positions.find((i) => i !== sel + 1);
  if (origNow === undefined || added[sel + 1] !== vid)
    return { ok: false, reason: 'menu', detail: 'not_inserted', after: added };
  const removeError = await menuPick(win, o, sleep, { row: queueRows(doc)[origNow], kind: 'remove', vid });
  if (removeError) return { ok: false, reason: 'menu', detail: removeError, after: ids() };

  return { ok: true, after: ids() };
}
