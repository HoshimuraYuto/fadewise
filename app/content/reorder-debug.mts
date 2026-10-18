import type { EffectiveSettings } from '../shared/settings.mts';
import type { DebugEvent, DebugLimits, DebugState } from './reorder-debug/line-text.mts';
import { createDebugPanel, type DebugPanel } from './reorder-debug/panel.mts';
import { applyUiLanguage, isTrue, watchSettings } from './settings-watch.mts';

export { lineText, stateText } from './reorder-debug/line-text.mts';
export type { DebugEvent, DebugLimits, DebugState } from './reorder-debug/line-text.mts';
export { MAX_LINES, createDebugPanel, type DebugPanel } from './reorder-debug/panel.mts';

const TAG = 'fadewise';

interface Message {
  fadewise?: unknown;
  type?: unknown;
  data?: unknown;
}
export interface DebugDeps {
  win: Window;
  chrome: Pick<typeof chrome, 'storage' | 'i18n'>;
  withDefaults: (stored: unknown) => EffectiveSettings;
  limits: DebugLimits;
}

export function startReorderDebug({ win, chrome, withDefaults, limits }: DebugDeps): DebugPanel {
  const panel = createDebugPanel(win.document, { limits, clipboard: (s) => win.navigator.clipboard.writeText(s) });
  const hasBody = () => (win.document.body as HTMLElement | null) !== null;
  let on = false;

  watchSettings(chrome, (stored) => {
    const s = withDefaults(stored);
    applyUiLanguage(chrome, s);
    on = isTrue(s.reorderDebug);

    if (!on) {
      panel.unmount();

      return;
    }

    // document_start: <body> may not exist yet
    if (hasBody()) panel.mount();
    else
      win.document.addEventListener(
        'DOMContentLoaded',
        () => {
          if (on) panel.mount();
        },
        { once: true },
      );
    panel.render();
  });

  win.addEventListener('message', (e: MessageEvent<Message | null>) => {
    if (!on || e.source !== win || !e.data || e.data[TAG] !== 'main') return;
    const { type, data } = e.data;
    if (type !== 'roDebug' && type !== 'roDebugState') return;
    if (!panel.mounted() && hasBody()) panel.mount();
    const ev = data as DebugEvent | null;
    if (type === 'roDebug' && ev && typeof ev.ev === 'string') panel.add(ev);
    else if (type === 'roDebugState') panel.setState(data as DebugState | null);
  });

  return panel;
}
