import { queueRows, type PageWindow, type Row } from './queue-panel.mts';

export type Span = [number, number];

export function createOwnScrolls() {
  let count = 0,
    lastWhy: string | null = null;

  const scrollTo = (el: Element, top: number, why: string) => {
    count++;
    lastWhy = why;
    el.scrollTop = top;
  };

  // A no-op scroll is not counted: the scroll watcher never sees it.
  const scrollByY = (el: Element, dy: number, why: string): boolean => {
    const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
    const want = Math.max(0, Math.min(max, el.scrollTop + dy)) - el.scrollTop;
    if (Math.abs(want) < 1) return false;
    count++;
    lastWhy = why;
    if (typeof el.scrollBy === 'function') el.scrollBy(0, want);
    else el.scrollTop += want;

    return true;
  };

  return { scrollTo, scrollByY, own: () => ({ n: count, why: lastWhy }) };
}

export type OwnScrolls = ReturnType<typeof createOwnScrolls>;

const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
const END_ROW_INSET_PX = 6;
const STILL_EDGE_PX = 4;

// YTM edge-scrolls within ~130 px of the panel edges, and that loses the held row.
export function createDragGeometry(win: PageWindow, scroller: Element, row: Row, to: number, edgePx: number) {
  const rows = () => queueRows(win.document);

  const panel = () => {
    const s = scroller.getBoundingClientRect();

    return { top: Math.max(s.top, 0), bottom: Math.min(s.bottom, win.innerHeight) };
  };

  const maxTop = () => Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
  const liveIdx = () => rows().indexOf(row);

  function limits() {
    const p = panel(),
      top = scroller.scrollTop;
    let lo = p.top + (top <= 0.5 ? STILL_EDGE_PX : edgePx),
      hi = p.bottom - (top >= maxTop() - 0.5 ? STILL_EDGE_PX : edgePx);
    const boxes = rows()
      .filter((e) => e !== row)
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.height > 0);

    if (boxes.length) {
      hi = Math.min(hi, boxes[boxes.length - 1].bottom - END_ROW_INSET_PX);
      lo = Math.max(lo, boxes[0].top + END_ROW_INSET_PX);
    }

    return { lo, hi };
  }

  function pressable(): boolean {
    const p = panel(),
      r = row.getBoundingClientRect();
    if (!(r.height > 0 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1)) return false;
    const lim = limits(),
      c = mid(r);

    return to > liveIdx() ? c <= lim.hi : c >= lim.lo;
  }

  function scrollWanted(ahead: Span[] | null | undefined): number {
    const p = panel(),
      lo = p.top + edgePx,
      hi = p.bottom - edgePx;
    const rs = rows(),
      target = rs[to] as Row | undefined;
    if (!target) return 0;
    const fit = (c1: number, c2: number): Span => [Math.max(c1, c2) - hi, Math.min(c1, c2) - lo];
    const held = mid(row.getBoundingClientRect());
    const both = fit(held, mid(target.getBoundingClientRect()));
    if (both[0] > both[1]) return to > liveIdx() ? held - lo : held - hi;
    if (both[0] <= 0 && both[1] >= 0) return 0;
    const room: Span = [-scroller.scrollTop, maxTop() - scroller.scrollTop];
    const iv = narrowForAhead(both, room, ahead, (i, j) => {
      const ri = rs[i] as Row | undefined,
        rj = rs[j] as Row | undefined;

      return ri && rj ? fit(mid(ri.getBoundingClientRect()), mid(rj.getBoundingClientRect())) : null;
    });

    return iv[0] > 0 ? iv[0] : iv[1];
  }

  return { panel, limits, liveIdx, pressable, scrollWanted };
}

export type DragGeometry = ReturnType<typeof createDragGeometry>;

function narrowForAhead(
  iv: Span,
  room: Span,
  ahead: Span[] | null | undefined,
  fitRows: (i: number, j: number) => Span | null,
): Span {
  let out = iv;

  for (const [i, j] of ahead || []) {
    const f = fitRows(i, j);
    if (!f) break;
    const n: Span = [Math.max(out[0], f[0]), Math.min(out[1], f[1])];
    if (n[0] > n[1] || n[0] > room[1] || n[1] < room[0]) break;
    out = n;
  }

  return out;
}
