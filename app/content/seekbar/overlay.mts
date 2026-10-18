import * as Marks from '../../shared/seekbar-marks.mts';
import type { MarksModel } from '../../shared/seekbar-marks.mts';
import { itemLines } from './item-text.mts';
import CSS from './overlay.css?inline';

export const BAR_SEL = 'ytmusic-player-bar #progress-bar';
// YTM's newer layout has no ytmusic-player-bar; its seek bar is a range input.
export const MINI_BAR_SEL = 'ytmusic-miniplayer [class*="ProgressBarWrapper"]';
const MINI_INPUT_SEL = 'input[type="range"]';
const QUEUE_ROW_SEL =
  'ytmusic-player-queue #contents > ytmusic-player-queue-item, ytmusic-player-queue #contents > ytmusic-playlist-panel-video-wrapper-renderer';
const TRACK_SEL = '#sliderBar';
// the visible line; #sliderBar's hit area is taller
const LINE_SEL = '#progressContainer';
const BAND_EXTRA_PX = 4;
const HOVER_TOL_PX = 4;
const MIN_BAR_WIDTH_PX = 20;
// clears YTM's own hover time label
const TIP_ABOVE_PX = 44;

export function queueTitle(doc: Document, step: number): string | null {
  try {
    const rows = [...doc.querySelectorAll(QUEUE_ROW_SEL)];
    const playing = rows.findIndex(
      (r) => r.hasAttribute('selected') || !!r.querySelector('ytmusic-player-queue-item[selected]'),
    );
    const row = playing >= 0 ? rows[playing + step] : null;
    const title = row?.querySelector('.song-title')?.textContent.trim() ?? '';

    return title || null;
  } catch {
    return null;
  }
}

interface Bar {
  el: Element;
  track: Element;
  line: Element | null;
}
interface Layer {
  host: HTMLElement;
  lay: HTMLElement;
  tip: HTMLElement;
}
export interface SeekbarOverlay {
  update(m: MarksModel | null): boolean;
  relayout(): void;
  unmount(): void;
  showTip(): void;
  host(): HTMLElement | null;
  layer(): HTMLElement | null;
  tipEl(): HTMLElement | null;
  model(): MarksModel | null;
  hover(x: number | null): void;
}

// Both layouts can be in the DOM; the hidden one has an empty box.
function findBar(doc: Document, barSel: string, miniSel: string): Bar | null {
  const found: Bar[] = [];
  const bar = doc.querySelector(barSel);

  if (bar) {
    const track = bar.querySelector(TRACK_SEL) || bar;
    const line = track.querySelector(LINE_SEL) || track.shadowRoot?.querySelector(LINE_SEL) || null;
    found.push({ el: bar, track, line });
  }

  const mini = doc.querySelector(miniSel);
  const input = mini?.querySelector(MINI_INPUT_SEL);
  if (mini && input) found.push({ el: mini, track: input, line: input });

  return found.find((c) => c.track.getBoundingClientRect().width > MIN_BAR_WIDTH_PX) || found[0] || null;
}

function barRect(bar: Bar): DOMRect | null {
  const line = bar.line?.isConnected ? bar.line.getBoundingClientRect() : null;
  const r = line && line.width > MIN_BAR_WIDTH_PX ? line : bar.track.getBoundingClientRect();
  if (!(r.width > MIN_BAR_WIDTH_PX) || !(r.height >= 0)) return null;

  return r;
}

function createLayer(doc: Document): Layer | null {
  const parent = (doc.body as HTMLElement | null) ?? doc.querySelector<HTMLElement>(':root');
  if (!parent) return null;
  const host = doc.createElement('fadewise-seekbar');
  host.style.cssText =
    'all: initial; position: fixed; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483000; pointer-events: none;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const lay = doc.createElement('div');
  lay.className = 'lay';
  lay.hidden = true;
  const tip = doc.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  root.append(style, lay, tip);
  parent.append(host);

  return { host, lay, tip };
}

function placeLayer(lay: HTMLElement, r: DOMRect): void {
  const h = Math.min(Math.max(3, r.height), 8) + BAND_EXTRA_PX;
  lay.style.left = String(r.left) + 'px';
  lay.style.top = String(r.top + r.height / 2 - h / 2) + 'px';
  lay.style.width = String(r.width) + 'px';
  lay.style.height = String(h) + 'px';
}

function itemClass(it: MarksModel['items'][number]): string {
  const band = it.shape === 'band';
  const mix = it.info?.mix;
  const classes = [band ? 'it' : 'pt', it.kind];
  if (it.state === 'cancelled') classes.push('cancelled');
  if (mix && band) classes.push('mix');
  if (mix?.aggr) classes.push('aggr');

  return classes.join(' ');
}

function drawItems(doc: Document, m: MarksModel, layer: HTMLElement): void {
  const kids: HTMLElement[] = [];
  const pct = (x: number) => String((x / Number(m.dur)) * 100) + '%';

  for (const it of m.items) {
    const e = doc.createElement('div');
    e.className = itemClass(it);
    e.dataset.kind = it.kind;
    e.dataset.state = it.state;

    if (it.shape === 'band') {
      e.style.left = pct(Number(it.start));
      e.style.width = pct(Number(it.end) - Number(it.start));
    } else e.style.left = pct(Number(it.at));

    kids.push(e);

    if (it.kind === 'fadeOut' && it.info?.aligned) {
      const beat = doc.createElement('div');
      beat.className = 'align';
      beat.style.left = pct(Number(it.start));
      kids.push(beat);
    }
  }

  layer.replaceChildren(...kids);
}

function showLines(tip: HTMLElement, lines: string[], x: number, barTop: number): void {
  const doc = tip.ownerDocument;
  const head = doc.createElement('div');
  head.className = 'h';
  head.textContent = 'Fadewise';

  const body = lines.map((s) => {
    const d = doc.createElement('div');
    d.textContent = s;

    return d;
  });

  tip.replaceChildren(head, ...body);
  tip.hidden = false;
  const half = Math.max(90, (tip.offsetWidth || 0) / 2 + 6);
  const viewWidth = doc.defaultView ? doc.defaultView.innerWidth : 1e4;
  tip.style.left = String(Math.min(Math.max(x, half), viewWidth - half)) + 'px';
  tip.style.top = String(barTop - TIP_ABOVE_PX) + 'px';
}

function hoverLines(doc: Document, model: MarksModel, x: number, r: DOMRect): string[] {
  const dur = Number(model.dur);
  const pos = ((x - r.left) / r.width) * dur;
  const tol = (HOVER_TOL_PX / r.width) * dur;

  return Marks.itemsAt(model, pos, tol).flatMap((it) => itemLines(it, (step) => queueTitle(doc, step)));
}

function updateTip(layer: Layer, model: MarksModel | null, x: number | null, r: DOMRect | null): void {
  const doc = layer.tip.ownerDocument;
  const lines = x !== null && model?.dur && r && !layer.lay.hidden ? hoverLines(doc, model, x, r) : [];
  if (x !== null && r && lines.length) showLines(layer.tip, lines, x, r.top);
  else layer.tip.hidden = true;
}

interface HoverHandlers {
  move(): void;
  leave(): void;
}

function createBarTracker(doc: Document, sel: { barSel: string; miniSel: string }, on: HoverHandlers) {
  let bar: Bar | null = null,
    hoverX: number | null = null;

  const onMove = (e: Event) => {
    hoverX = (e as MouseEvent).clientX;
    on.move();
  };

  const onLeave = () => {
    hoverX = null;
    on.leave();
  };

  function detach(): void {
    if (!bar) return;
    bar.el.removeEventListener('mousemove', onMove);
    bar.el.removeEventListener('mouseleave', onLeave);
    bar = null;
    hoverX = null;
  }

  function attach(): boolean {
    const found = findBar(doc, sel.barSel, sel.miniSel);

    if (bar && found && bar.el === found.el) {
      bar.track = found.track;
      bar.line = found.line;

      return true;
    }

    detach();
    if (!found) return false;
    bar = found;
    bar.el.addEventListener('mousemove', onMove, { passive: true });
    bar.el.addEventListener('mouseleave', onLeave, { passive: true });

    return true;
  }

  return {
    attach,
    detach,
    rect: () => (bar ? barRect(bar) : null),
    hoverX: () => hoverX,
    setHover: (x: number | null) => {
      hoverX = x;
    },
  };
}

function createLayerSlot(doc: Document) {
  let layer: Layer | null = null,
    sig = '';

  function mount(): Layer | null {
    if (layer?.host.isConnected) return layer;
    const created = createLayer(doc);
    if (created) layer = created;

    return created;
  }

  function hide(): void {
    if (!layer) return;
    layer.lay.hidden = true;
    layer.tip.hidden = true;
  }

  function show(shown: Layer, m: MarksModel, r: DOMRect): void {
    placeLayer(shown.lay, r);
    const s = Marks.marksSig(m);

    if (s !== sig) {
      sig = s;
      drawItems(doc, m, shown.lay);
    }

    shown.lay.hidden = false;
  }

  function clear(): void {
    sig = '';
    hide();
    layer?.lay.replaceChildren();
  }

  function remove(): void {
    layer?.host.remove();
    layer = null;
    sig = '';
  }

  return { mount, hide, show, clear, remove, current: () => layer };
}

export function createSeekbarOverlay(
  doc: Document,
  opts?: { barSel?: string; miniSel?: string } | null,
): SeekbarOverlay {
  const o = Object.assign({ barSel: BAR_SEL, miniSel: MINI_BAR_SEL }, opts || {});
  const slot = createLayerSlot(doc);
  let model: MarksModel | null = null;

  const bar = createBarTracker(doc, o, {
    move: () => {
      showTip();
    },
    leave: () => {
      const layer = slot.current();
      if (layer) layer.tip.hidden = true;
    },
  });

  const showTip = () => {
    const layer = slot.current();
    if (layer) updateTip(layer, model, bar.hoverX(), bar.rect());
  };

  function update(m: MarksModel | null): boolean {
    if (!m?.dur || !m.items.length) {
      model = null;
      slot.clear();

      return false;
    }

    model = m;
    const shown = slot.mount();
    const r = shown && bar.attach() ? bar.rect() : null;

    if (!shown || !r) {
      slot.hide();

      return false;
    }

    slot.show(shown, m, r);
    if (bar.hoverX() !== null) showTip();

    return true;
  }

  // YTM switches between the player bar and the miniplayer with window width.
  function relayout(): void {
    if (model) update(model);
  }

  function unmount(): void {
    bar.detach();
    slot.remove();
    model = null;
  }

  return {
    update,
    relayout,
    unmount,
    showTip,
    host: () => slot.current()?.host ?? null,
    layer: () => slot.current()?.lay ?? null,
    tipEl: () => slot.current()?.tip ?? null,
    model: () => model,
    hover: (x) => {
      bar.setHover(x);
      showTip();
    },
  };
}
