import { t } from '../ui/i18n.mts';
import type { RunLogEntry } from '../shared/reorder.mts';
import type { EffectiveSettings } from '../shared/settings.mts';
import { applyUiLanguage, isTrue } from './settings-watch.mts';
import OVERRIDES from './toast.css?inline';

export interface ToastRun {
  result?: string;
  moved?: number;
  planned?: number;
}
interface Toast {
  showToast(): void;
  hideToast(): void;
}
export type ToastifyFn = (options: Record<string, unknown>) => Toast;

export function runToastText(run: ToastRun | null | undefined): string | null {
  if (!run || !((run.moved ?? 0) > 0)) return null;
  if (run.result === 'done') return t('toast.reordered', { n: run.moved });
  if (run.result === 'partial') return t('toast.reorderedPartial', { n: run.moved, of: run.planned || run.moved });

  return null;
}

export interface Toaster {
  show(text: string | null): Toast | null;
  root(): ShadowRoot | null;
}

export function createToaster(
  doc: Document,
  Toastify: ToastifyFn,
  css: string,
  opts?: { durationMs?: number } | null,
): Toaster {
  const o = Object.assign({ durationMs: 3500 }, opts || {});
  let host: HTMLElement | null = null,
    root: ShadowRoot | null = null,
    current: Toast | null = null;

  function mount(): ShadowRoot {
    if (host?.isConnected && root) return root;
    host = doc.createElement('fadewise-toast');
    host.style.cssText =
      'all: initial; position: fixed; z-index: 2147483647; inset: auto auto 0 0; pointer-events: none;';
    root = host.attachShadow({ mode: 'closed' });
    const st = doc.createElement('style');
    st.textContent = css + OVERRIDES;
    root.append(st);
    ((doc.body as HTMLElement | null) ?? doc.documentElement).append(host);

    return root;
  }

  function show(text: string | null): Toast | null {
    if (!text) return null;
    const r = mount();

    if (current) {
      try {
        current.hideToast();
      } catch {
        /* already gone */
      }
    }

    current = Toastify({
      text,
      duration: o.durationMs,
      selector: r,
      className: 'fw',
      gravity: 'bottom',
      position: 'right',
      close: false,
      stopOnFocus: false,
      escapeMarkup: true,
    });
    current.showToast();

    return current;
  }

  return { show, root: () => root };
}

export interface ToastDeps {
  win: Window;
  chrome: Pick<typeof chrome, 'storage' | 'i18n'>;
  Toastify: ToastifyFn;
  css: string;
  sanitizeRun?: ((r: unknown) => RunLogEntry | null) | null;
  withDefaults: (stored: unknown) => EffectiveSettings;
}
interface PageMessage {
  fadewise?: unknown;
  type?: unknown;
  data?: unknown;
}

export function startReorderToasts({ win, chrome, Toastify, css, sanitizeRun, withDefaults }: ToastDeps): Toaster {
  const toaster = createToaster(win.document, Toastify, css);
  win.addEventListener('message', (e: MessageEvent<PageMessage | null>) => {
    if (e.source !== win || !e.data || e.data['fadewise'] !== 'main' || e.data.type !== 'reorderRun') return;
    const run = (sanitizeRun ? sanitizeRun(e.data.data) : e.data.data) as ToastRun | null;
    if (!run) return;
    let get: Promise<{ settings?: unknown }>;

    try {
      get = chrome.storage.local.get('settings');
    } catch {
      return; // extension reloaded
    }

    get
      .then(({ settings }) => {
        const s = withDefaults(settings);
        if (!isTrue(s.reorderToast)) return;
        applyUiLanguage(chrome, s);
        toaster.show(runToastText(run));
      })
      .catch(() => {});
  });

  return toaster;
}
