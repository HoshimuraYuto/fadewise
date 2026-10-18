// YTM builds one tp-yt-iron-dropdown in the popup container, `opened` while shown.
import { resync, type Flagged, type QueuePage, type Row } from './page.mts';

type Endpoint = ((videoId: string) => object) | null;

const ITEMS: [string, Endpoint][] = [
  ['MIX', null],
  [
    'QUEUE_PLAY_NEXT',
    (v) => ({ queueAddEndpoint: { queueTarget: { videoId: v }, queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO' } }),
  ],
  [
    'ADD_TO_REMOTE_QUEUE',
    (v) => ({ queueAddEndpoint: { queueTarget: { videoId: v }, queueInsertPosition: 'INSERT_AT_END' } }),
  ],
  ['REMOVE_FROM_PLAYLIST', (v) => ({ playlistEditEndpoint: { videoId: v } })],
  ['REMOVE', (v) => ({ removeFromQueueEndpoint: { videoId: v, itemId: 'x' } })],
];

export interface RowMenu {
  dropdown: Flagged;
  open(row: Row): void;
}

function applyItem(page: QueuePage, icon: string, row: Row): void {
  const { contents, state } = page;
  const vid = row.data.videoId;

  if (icon === 'QUEUE_PLAY_NEXT') {
    contents.insertBefore(page.newRow(vid), page.rows()[state.sel + 1] ?? null);
  } else if (icon === 'ADD_TO_REMOTE_QUEUE') {
    contents.appendChild(page.newRow(vid));
  } else if (icon === 'REMOVE') {
    if (!row.hasAttribute('selected')) contents.removeChild(row);
  }

  resync(page);
}

export function installRowMenu(page: QueuePage): RowMenu {
  const { doc, state } = page;
  const dropdown = doc.createElement('tp-yt-iron-dropdown') as Flagged;
  dropdown.opened = false;

  dropdown.close = () => {
    dropdown.opened = false;
    dropdown.innerHTML = '';
  };

  doc.querySelector('ytmusic-popup-container')!.appendChild(dropdown);
  doc.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') dropdown.close?.();
  });

  const open = (row: Row) => {
    dropdown.innerHTML = '';
    if (state.flags.menuNeverOpens) return;

    for (const [icon, endpoint] of ITEMS) {
      const item = doc.createElement('ytmusic-menu-service-item-renderer');
      const serviceEndpoint = endpoint && !state.flags.menuNoEndpoint ? endpoint(row.data.videoId) : undefined;
      Object.assign(item, { data: { icon: { iconType: icon }, serviceEndpoint } });
      item.addEventListener('click', () => {
        state.menuOps++;
        state.menuClicks.push(icon);
        applyItem(page, icon, row);
        dropdown.close?.();
      });
      dropdown.appendChild(item);
    }

    dropdown.opened = true;
  };

  return { dropdown, open };
}
