export const DIALOG_SELECTOR = 'ytmusic-you-there-renderer';
const BUTTONS = [
  '#confirm-button button',
  '#confirm-button tp-yt-paper-button',
  '#confirm-button',
  '.actions button',
  'tp-yt-paper-button',
  'button',
];

function isShown(el: Element, win: Window): boolean {
  const box = el.closest('tp-yt-paper-dialog') || el;
  if (box.hasAttribute('aria-hidden') && box.getAttribute('aria-hidden') !== 'false') return false;
  if (box.hasAttribute('hidden')) return false;

  try {
    if (win.getComputedStyle(box).display === 'none') return false;
  } catch {
    /* treat as shown */
  }

  return true;
}

function findButton(dialog: Element): HTMLElement | null {
  for (const sel of BUTTONS) {
    const b = dialog.querySelector<HTMLElement>(sel);
    if (b) return b;
  }

  return null;
}

export interface Answered {
  at: number;
  text: string;
}
export interface AutoContinueOptions {
  doc: Document;
  win: Window;
  isEnabled?: () => boolean;
  onAnswered?: (info: Answered) => void;
}
export interface AutoContinue {
  check(): void;
  stop(): void;
}

export function startAutoContinue(opts: AutoContinueOptions): AutoContinue {
  const { doc, win } = opts;
  const answered = new WeakSet<Element>();

  const check = () => {
    try {
      if (opts.isEnabled && !opts.isEnabled()) return;

      for (const d of doc.querySelectorAll(DIALOG_SELECTOR)) {
        if (!isShown(d, win)) {
          answered.delete(d);
          continue;
        }

        if (answered.has(d)) continue;
        const b = findButton(d);
        if (!b) continue;
        answered.add(d);
        b.click();
        if (opts.onAnswered)
          opts.onAnswered({ at: Date.now(), text: (d.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) });
      }
    } catch {
      /* never interfere with the page */
    }
  };

  // the document's own window, which differs from the global one in the tests
  const MO = (win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver ?? MutationObserver;
  const mo = new MO(check);
  mo.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'hidden', 'style', 'opened'],
  });
  check();

  return {
    check,
    stop: () => {
      mo.disconnect();
    },
  };
}
