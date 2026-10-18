import * as Marks from '../shared/seekbar-marks.mts';
import type { MarksModel } from '../shared/seekbar-marks.mts';
import type { EffectiveSettings } from '../shared/settings.mts';
import { createSeekbarOverlay, type SeekbarOverlay } from './seekbar/overlay.mts';
import { applyUiLanguage, isTrue, watchSettings } from './settings-watch.mts';

export { clockPos, itemLines, itemText } from './seekbar/item-text.mts';
export { BAR_SEL, MINI_BAR_SEL, createSeekbarOverlay, queueTitle, type SeekbarOverlay } from './seekbar/overlay.mts';

const TAG = 'fadewise';
const RELAYOUT_EVERY_MS = 1000;

interface PageStatus {
  ad?: unknown;
  videoId?: unknown;
  fade?: { vid?: unknown } | null;
}

export function modelFromStatus(st: PageStatus | null | undefined, isAdDom?: boolean): MarksModel | null {
  if (!st || st.ad || isAdDom) return null;
  const f = st.fade;
  if (!f || !st.videoId || f.vid !== st.videoId) return null;

  return Marks.seekbarMarks(f);
}

interface Message {
  fadewise?: unknown;
  type?: unknown;
  data?: unknown;
}
export interface SeekbarDeps {
  win: Window;
  chrome: Pick<typeof chrome, 'storage' | 'i18n'>;
  withDefaults: (stored: unknown) => EffectiveSettings;
}

function adShowing(doc: Document): boolean {
  const player = doc.getElementById('movie_player');

  return !!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
}

export function startSeekbarMarks({ win, chrome, withDefaults }: SeekbarDeps): SeekbarOverlay {
  const doc = win.document;
  const ov = createSeekbarOverlay(doc);
  let on = false,
    last: PageStatus | null = null;

  const refresh = () => {
    if (on) ov.update(modelFromStatus(last, adShowing(doc)));
    else ov.unmount();
  };

  watchSettings(chrome, (stored) => {
    const s = withDefaults(stored);
    applyUiLanguage(chrome, s);
    on = isTrue(s.seekbarMarks);
    refresh();
  });

  const onMessage = (e: MessageEvent<Message | null>) => {
    if (e.source !== win || !e.data) return;

    if (e.data[TAG] === 'bridge' && e.data.type === 'detached') {
      on = false;
      ov.unmount();
      win.removeEventListener('message', onMessage);

      return;
    }

    if (e.data[TAG] !== 'main' || e.data.type !== 'status') return;
    last = e.data.data as PageStatus | null;
    if (on) refresh();
  };

  win.addEventListener('message', onMessage);
  win.addEventListener(
    'resize',
    () => {
      ov.relayout();
    },
    { passive: true },
  );
  // The bar moves without a resize and no status comes while paused: follow it once a second.
  win.setInterval(() => {
    if (on && doc.visibilityState !== 'hidden') ov.relayout();
  }, RELAYOUT_EVERY_MS);

  return ov;
}
