// MAIN world: the row's videoId is a property the page sets (row.data).
import { t, setLang, resolveLang } from '../ui/i18n.mts';
import CSS from './queue-badges.css?inline';

const TAG = 'fadewise';
export const HOST = 'fadewise-badge';
const ROW_SEL =
  'ytmusic-player-queue #contents > ytmusic-player-queue-item, ytmusic-player-queue #contents > ytmusic-playlist-panel-video-wrapper-renderer';
const RELIABLE = 0.5; // as in ui/common.mts
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export interface BadgeNumbers {
  bpm: number | null;
  bc: number;
  cam: string | null;
  kc: number;
}
export interface BadgePart {
  text: string;
  low: boolean;
}
interface Loose {
  [k: string]: Loose | undefined;
}

export function fromRecord(r: unknown): BadgeNumbers | null {
  const tk = (r as Loose | null)?.tempoKey;
  if (!tk) return null;
  const tempo = tk.tempo,
    key = tk.key;

  return {
    bpm: tempo && isNum(tempo.bpm) ? tempo.bpm : null,
    bc: tempo && isNum(tempo.confidence) ? tempo.confidence : 0,
    cam: key && typeof key.camelot === 'string' ? key.camelot : null,
    kc: key && isNum(key.confidence) ? key.confidence : 0,
  };
}

export function fromEntry(e: unknown): BadgeNumbers | null {
  const tk = (e as Loose | null)?.tk;
  if (!tk) return null;

  return {
    bpm: isNum(tk.bpm) ? tk.bpm : null,
    bc: isNum(tk.bc) ? tk.bc : 0,
    cam: typeof tk.cam === 'string' ? tk.cam : null,
    kc: isNum(tk.kc) ? tk.kc : 0,
  };
}

export function badgeParts(x: Partial<BadgeNumbers> | null | undefined): BadgePart[] | null {
  if (!x) return null;
  const parts: BadgePart[] = [];
  if (isNum(x.bpm)) parts.push({ text: t('badge.bpm', { bpm: Math.round(x.bpm) }), low: !((x.bc ?? NaN) >= RELIABLE) });
  if (x.cam && /^\d{1,2}[AB]$/.test(x.cam)) parts.push({ text: x.cam, low: !((x.kc ?? NaN) >= RELIABLE) });

  return parts.length ? parts : null;
}

interface RendererData {
  videoId?: unknown;
  playlistPanelVideoRenderer?: RendererData;
  playlistPanelVideoWrapperRenderer?: { primaryRenderer?: { playlistPanelVideoRenderer?: RendererData } };
  primaryRenderer?: { playlistPanelVideoRenderer?: RendererData };
}

const rendererOf = (d: RendererData | null | undefined): RendererData | null | undefined =>
  d &&
  (d.playlistPanelVideoRenderer ||
    d.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ||
    d.primaryRenderer?.playlistPanelVideoRenderer ||
    d);

function videoIdOf(row: Element): string | null {
  try {
    const r = rendererOf((row as Element & { data?: RendererData }).data);

    return r && typeof r.videoId === 'string' ? r.videoId : null;
  } catch {
    return null;
  }
}

interface BridgeMessage {
  fadewise?: unknown;
  type?: unknown;
  data?: { queueBadges?: unknown; uiLanguage?: unknown; vid?: string; entry?: unknown } | null;
}
type RefreshCounts = { shown: number; removed: number; skipped: number };
export interface Badges {
  refresh(): RefreshCounts;
  stop(): void;
  known: Map<string, BadgeNumbers>;
}

function hostFor(doc: Document, wrap: Element): HTMLElement {
  const existing = wrap.querySelector<HTMLElement>(':scope > ' + HOST);
  if (existing) return existing;
  const host = doc.createElement(HOST);
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  root.append(style, doc.createElement('span'));
  wrap.append(host);

  return host;
}

function partSpans(doc: Document, parts: BadgePart[]): HTMLElement[] {
  const spans: HTMLElement[] = [];

  parts.forEach((p, i) => {
    if (i) {
      const sep = doc.createElement('span');
      sep.className = 'sep';
      sep.textContent = t('badge.sep');
      spans.push(sep);
    }

    const span = doc.createElement('span');
    span.textContent = p.text;
    if (p.low) span.className = 'low';
    spans.push(span);
  });

  return spans;
}

function draw(host: HTMLElement, parts: BadgePart[], lang: string): boolean {
  const sig = JSON.stringify([lang, parts]);
  if (host.dataset.sig === sig) return false;
  host.dataset.sig = sig;
  host.shadowRoot?.querySelector('span')?.replaceChildren(...partSpans(host.ownerDocument, parts));
  if (parts.some((p) => p.low)) host.title = t('badge.provisional');
  else host.removeAttribute('title');

  return true;
}

function drawRows(doc: Document, known: Map<string, BadgeNumbers>, lang: string): RefreshCounts {
  const n = { shown: 0, removed: 0, skipped: 0 };

  for (const row of doc.querySelectorAll(ROW_SEL)) {
    const wrap = row.querySelector('.byline-wrapper');
    const vid = videoIdOf(row);

    if (!wrap || !vid) {
      n.skipped++;
      continue;
    }

    const parts = badgeParts(known.get(vid));

    if (parts) {
      draw(hostFor(doc, wrap), parts, lang);
      n.shown++;
      continue;
    }

    const old = wrap.querySelector(':scope > ' + HOST);

    if (old) {
      old.remove();
      n.removed++;
    }
  }

  return n;
}

function removeAll(doc: Document): number {
  const all = doc.querySelectorAll(HOST);
  for (const h of all) h.remove();

  return all.length;
}

function applyIndex(known: Map<string, BadgeNumbers>, type: unknown, data: BridgeMessage['data']): boolean {
  if (type === 'index' && data) {
    known.clear();

    for (const [vid, r] of Object.entries(data)) {
      const x = fromRecord(r);
      if (x) known.set(vid, x);
    }

    return true;
  }

  if (type === 'indexEntry' && data?.vid) {
    const x = fromEntry(data.entry);
    if (x) known.set(data.vid, x);
    else known.delete(data.vid);

    return true;
  }

  return false;
}

export function createBadges(win: Window, opts?: { periodMs?: number } | null): Badges {
  const doc = win.document;
  const o = Object.assign({ periodMs: 1000 }, opts || {});
  const known = new Map<string, BadgeNumbers>();
  let on = false,
    lang = 'en',
    timer: number | null = null,
    stopped = false;

  function refresh(): RefreshCounts {
    if (stopped) return { shown: 0, removed: 0, skipped: 0 };
    if (!on) return { shown: 0, removed: removeAll(doc), skipped: 0 };

    return drawRows(doc, known, lang);
  }

  function onMessage(e: MessageEvent<BridgeMessage | null>): void {
    if (e.source !== win || !e.data || e.data[TAG] !== 'bridge') return;
    const { type, data } = e.data;

    if (type === 'detached') {
      stop();

      return;
    }

    if (type === 'settings' && data) {
      on = data.queueBadges === true;
      lang = resolveLang(data.uiLanguage, win.navigator.language);
      setLang(lang);
    } else if (!applyIndex(known, type, data)) return;

    refresh();
  }

  function stop(): void {
    stopped = true;
    if (timer) win.clearInterval(timer);
    win.removeEventListener('message', onMessage);
    removeAll(doc);
  }

  win.addEventListener('message', onMessage);
  // Not paused in hidden tabs: the index usually arrives before the rows exist.
  timer = win.setInterval(refresh, o.periodMs);
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'hidden') refresh();
  });

  return { refresh, stop, known };
}
