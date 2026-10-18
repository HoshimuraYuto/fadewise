import { C } from '../../shared/reorder-timing.mts';
import type { Ctx, ScrollRun } from './context.mts';

// Input only postpones a run: our synthetic events can reach the page with isTrusted true.
export const WAIT_INPUT = ['pointerdown', 'keydown', 'wheel'] as const;
const OWN_UI = 'fadewise-debug, fadewise-toast';
const USER_PRESS_MS = 2500;
const YTM_TOAST_MS = 3000;
const USER_SCROLL_MS = 1000;
const INPUT_DIAG_LIMIT = 60;
const QUEUE_EXT_POSITIONS = 8;

type InputEvent = Event & Partial<Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaZ' | 'clientX' | 'clientY'>>;

const isOwnUi = (e: Event) => {
  try {
    const target = e.target as Partial<Element> | null;

    return !!target?.closest?.(OWN_UI);
  } catch {
    return false;
  }
};

export function createInputListener(ctx: Ctx) {
  const { deps, st, T } = ctx;
  const trusted = deps.isTrusted || ((e: Event) => e.isTrusted);
  let inputDiags = 0;
  const deaf = () => st.state === 'running' || deps.wall() - st.runEndAt < T.DEAF_AFTER_RUN_MS;

  return (e: InputEvent) => {
    if (deaf() || !trusted(e) || isOwnUi(e) || !ctx.hasFocus()) return;
    if (e.type === 'wheel' && !e.deltaX && !e.deltaY && !e.deltaZ) return;
    st.lastInput = deps.now();
    if (e.type === 'wheel' || e.type === 'keydown') st.lastScrollInput = deps.wall();
    if (e.type === 'pointerdown') st.handAt = deps.wall();
    if (st.state !== 'waiting' || inputDiags >= INPUT_DIAG_LIMIT) return;
    inputDiags++;
    const at = { x: Math.round(e.clientX || 0), y: Math.round(e.clientY || 0) };
    ctx.diag('input', { type: e.type, use: 'activity', t: true, f: true, ...at });
  };
}

// YTM moving rows we just moved means it wants its own order.
export function contest(ctx: Ctx): void {
  const { st } = ctx;
  if (st.contested === st.vid) return;
  st.contested = st.vid;
  ctx.diag('contest', {});
  if (st.state !== 'running') ctx.giveUp('contested');
}

function endScroll(ctx: Ctx): void {
  const { st } = ctx;
  const c = st.scroll?.cur;
  if (!st.scroll || !c) return;
  st.scroll.cur = null;
  if (st.runScrolls) st.runScrolls[c.src] = (st.runScrolls[c.src] || 0) + 1;
  const span = { from: Math.round(c.from), to: Math.round(c.to), ms: c.last - c.t0 };
  ctx.diag('scroll', { src: c.src, why: c.why, ...span, running: st.state === 'running' });
}

function watchToast(ctx: Ctx): void {
  const { dom, st, deps } = ctx;
  const shown = dom.ytToast ? dom.ytToast() : false;

  if (shown && !st.toastOn) {
    st.toastAt = deps.wall();
    ctx.diag('yt_toast', {});
  }

  st.toastOn = shown;
}

function watchOrder(ctx: Ctx, ids: string[], sel: number): void {
  const { st, deps } = ctx;
  const prev = st.obs;
  st.obs = { ids, sel };
  if (!prev || st.state === 'running' || !ids.length || !prev.ids.length) return;
  const moved = ctx.R.movedBetween(prev.ids, ids);
  if (!moved.length) return;
  const user = deps.wall() - (st.handAt ?? -Infinity) < USER_PRESS_MS;
  const pos = moved.map((id) => ids.indexOf(id) - sel).slice(0, QUEUE_EXT_POSITIONS);
  const toast = !!st.toastOn || deps.wall() - (st.toastAt ?? -Infinity) < YTM_TOAST_MS;
  ctx.diag('queue_ext', { by: user ? 'user' : 'page', n: moved.length, pos, toast });
  const ours = st.ours;
  const recent = ours && ours.vid === st.vid && deps.wall() - ours.at < ctx.T.CONTEST_SEC * 1000;
  if (recent && moved.some((id) => ours.ids.has(id))) contest(ctx);
}

function watchScroll(ctx: Ctx): void {
  const { dom, st, deps, T } = ctx;
  const top = dom.scrollState();
  if (typeof top !== 'number') return;
  const own = dom.ownScroll ? dom.ownScroll() : { n: 0, why: null };
  const sc = st.scroll || (st.scroll = { top, own: own.n, cur: null });

  if (Math.abs(top - sc.top) >= 1) {
    const byUser = deps.wall() - (st.lastScrollInput ?? -Infinity) < USER_SCROLL_MS;
    const src: ScrollRun['src'] = own.n !== sc.own ? 'ext' : byUser ? 'user' : 'ytm';

    if (sc.cur && sc.cur.src === src && deps.wall() - sc.cur.last <= T.SCROLL_GAP_MS) {
      sc.cur.to = top;
      sc.cur.last = deps.wall();
    } else {
      endScroll(ctx);
      const why = src === 'ext' ? own.why : null;
      sc.cur = { src, why, from: sc.top, to: top, t0: deps.wall(), last: deps.wall() };
    }
  } else if (sc.cur && deps.wall() - sc.cur.last > T.SCROLL_GAP_MS) endScroll(ctx);

  sc.top = top;
  sc.own = own.n;
}

export function watch(ctx: Ctx): void {
  const { dom } = ctx;
  if (!dom.ids || !dom.selIndex) return;
  const ids = dom.ids(),
    sel = dom.selIndex();
  watchToast(ctx);
  watchOrder(ctx, ids, sel);
  watchScroll(ctx);
}

export function syncSource(ctx: Ctx, ids: string[], listId: string | null): string[] {
  const { st, deps, R } = ctx;

  if (listId !== st.listId || !st.src.length) {
    st.listId = listId;
    st.src = ids.slice();
    st.lastSeen = ids.slice();
    st.lastOrderSig = null;

    return [];
  }

  const moved = st.lastSeen ? R.movedBetween(st.lastSeen, ids) : [];
  const now = deps.wall();
  for (const id of moved) st.userMoved.set(id, now);
  for (const [id, at] of st.userMoved) if (now - at > C.USER_MOVED_HOLD_MS) st.userMoved.delete(id);
  const present = new Set(ids);
  const src = st.src.filter((id) => present.has(id) && !moved.includes(id));

  ids.forEach((id, i) => {
    if (src.includes(id)) return;
    const pred = i > 0 ? ids[i - 1] : null;
    const at = pred === null ? 0 : src.indexOf(pred) + 1;
    src.splice(at < 0 ? src.length : at, 0, id);
  });

  st.src = src;
  st.lastSeen = ids.slice();
  if (moved.length) ctx.diag('user_moved', { n: moved.length });

  return moved;
}
