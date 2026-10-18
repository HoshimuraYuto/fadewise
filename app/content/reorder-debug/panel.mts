// no chrome.* here, so the tests can drive the panel
import { t } from '../../ui/i18n.mts';
import { lineText, stateText, type DebugEvent, type DebugLimits, type DebugState } from './line-text.mts';
import CSS from './panel.css?inline';

export const MAX_LINES = 30;
const COPIED_SHOWN_MS = 1200;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function clock(ms: number): string {
  const d = new Date(ms);
  const tenths = String(Math.floor(d.getMilliseconds() / 100));

  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${tenths}`;
}

interface Line {
  at: number;
  text: string;
  cls: string;
}
interface Els {
  root: ShadowRoot;
  box: HTMLElement;
  title: HTMLElement;
  copy: HTMLElement;
  clear: HTMLElement;
  min: HTMLElement;
  stateEl: HTMLElement;
  log: HTMLElement;
}
export interface DebugPanel {
  mount(): void;
  unmount(): void;
  add(v: DebugEvent): void;
  setState(s: DebugState | null): void;
  render(): void;
  text(): string;
  copy(): Promise<boolean>;
  mounted(): boolean;
  host(): HTMLElement | null;
  lines(): Line[];
}
interface PanelOptions {
  limits: DebugLimits;
  clipboard: ((s: string) => Promise<void>) | null;
}

function lineClass(v: DebugEvent): string {
  if (v.ev === 'queue_ext' || v.ev === 'contest' || (v.ev === 'scroll' && v.src !== 'ext')) return 'ext';
  if (v.ev === 'run' && v.result !== 'done' && v.result !== 'skipped') return 'warn';
  if (v.ev === 'input' && v.use === 'abort') return 'warn';

  return '';
}

function buildPanel(doc: Document, host: HTMLElement): Els {
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; inset: auto auto 0 0;';
  const root = host.attachShadow({ mode: 'closed' });

  const el = (tag: string, className?: string) => {
    const e = doc.createElement(tag);
    if (className) e.className = className;

    return e;
  };

  const style = el('style');
  style.textContent = CSS;
  const box = el('div', 'box');
  const head = el('div', 'head');
  const title = el('span', 'title');
  const copy = el('button');
  const clear = el('button');
  const min = el('button');
  head.append(title, copy, clear, min);
  const stateEl = el('div', 'state');
  const log = el('pre', 'log');
  box.append(head, stateEl, log);
  root.append(style, box);

  return { root, box, title, copy, clear, min, stateEl, log };
}

type Buttons = Record<'copy' | 'clear' | 'min', () => void>;

function onClicks(els: Els, handlers: Buttons): void {
  for (const name of ['copy', 'clear', 'min'] as const) els[name].addEventListener('click', handlers[name]);
}

function renderHead(els: Els, minimized: boolean): void {
  els.box.classList.toggle('min', minimized);
  els.title.textContent = t('dbg.title');
  els.copy.textContent = t('dbg.copy');
  els.clear.textContent = t('dbg.clear');
  els.min.textContent = minimized ? t('dbg.expand') : t('dbg.min');
  els.min.title = els.min.textContent;
}

function renderLog(log: HTMLElement, lines: readonly Line[]): void {
  if (!lines.length) {
    log.textContent = t('dbg.empty');

    return;
  }

  const doc = log.ownerDocument;

  const rows = lines.map((l) => {
    const row = doc.createElement('div');
    const time = doc.createElement('span');
    time.className = 't';
    time.textContent = clock(l.at) + ' ';
    const text = doc.createElement('span');
    if (l.cls) text.className = l.cls;
    text.textContent = l.text;
    row.append(time, text);

    return row;
  });

  log.replaceChildren(...rows);
  log.scrollTop = log.scrollHeight;
}

function copyWithCommand(doc: Document, root: ShadowRoot, s: string): boolean {
  try {
    const area = doc.createElement('textarea');
    area.value = s;
    root.append(area);
    area.select();
    const exec = (doc as { execCommand?: (cmd: string) => boolean }).execCommand;
    const ok = !!exec?.call(doc, 'copy');
    area.remove();

    return ok;
  } catch {
    return false;
  }
}

async function copyText(o: PanelOptions, doc: Document, els: Els | null, s: string): Promise<boolean> {
  try {
    if (o.clipboard) {
      await o.clipboard(s);

      return true;
    }
  } catch {
    /* fall back to the copy command */
  }

  return els ? copyWithCommand(doc, els.root, s) : false;
}

function pushLine(lines: Line[], v: DebugEvent): boolean {
  const text = lineText(v);
  if (!text) return false;
  lines.push({ at: v.at || Date.now(), text, cls: lineClass(v) });
  while (lines.length > MAX_LINES) lines.shift();

  return true;
}

// the panel may be unmounted before the label goes back
function flashCopied(current: () => Els | null): void {
  const els = current();
  if (!els) return;
  els.copy.textContent = t('dbg.copied');
  setTimeout(() => {
    const now = current();
    if (now) now.copy.textContent = t('dbg.copy');
  }, COPIED_SHOWN_MS);
}

export function createDebugPanel(doc: Document, opts?: Partial<PanelOptions> | null): DebugPanel {
  const o: PanelOptions = Object.assign({ limits: { PAGE_RETRIES: 2 }, clipboard: null }, opts || {});
  let host: HTMLElement | null = null,
    els: Els | null = null,
    minimized = false,
    state: DebugState | null = null;
  const lines: Line[] = [];

  function mount(): void {
    if (host?.isConnected) return;
    host = doc.createElement('fadewise-debug');
    els = buildPanel(doc, host);

    onClicks(els, {
      copy: () => void doCopy(),
      clear: () => {
        lines.length = 0;
        render();
      },
      min: () => {
        minimized = !minimized;
        render();
      },
    });

    ((doc.body as HTMLElement | null) ?? doc.documentElement).append(host);
    render();
  }

  function unmount(): void {
    if (host) host.remove();
    host = null;
    els = null;
  }

  function render(): void {
    if (!els) return;
    renderHead(els, minimized);
    els.stateEl.textContent = stateText(state, o.limits);
    renderLog(els.log, lines);
  }

  const text = () => [stateText(state, o.limits)].concat(lines.map((l) => clock(l.at) + ' ' + l.text)).join('\n');

  async function doCopy(): Promise<boolean> {
    const ok = await copyText(o, doc, els, text());
    if (ok && els) flashCopied(() => els);

    return ok;
  }

  return {
    mount,
    unmount,
    add: (v) => {
      if (pushLine(lines, v)) render();
    },
    setState: (s) => {
      state = s;
      if (els) els.stateEl.textContent = stateText(state, o.limits);
    },
    render,
    text,
    copy: doCopy,
    mounted: () => !!host?.isConnected,
    host: () => host,
    lines: () => lines.slice(),
  };
}
