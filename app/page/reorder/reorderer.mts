import { C } from '../../shared/reorder-timing.mts';
import { blockReason, waitReason } from './conditions.mts';
import { createContext, type Ctx, type Playing, type ReordererDeps } from './context.mts';
import { run } from './run.mts';
import { contest, createInputListener, watch, WAIT_INPUT } from './watchers.mts';

export type { Diag, DomPart, Playing, ReordererDeps, RunRecord } from './context.mts';

const GUARD_END_SEC = 1.5;

type Guard = NonNullable<Ctx['st']['guard']>;

function guardStep(ctx: Ctx, g: Guard, p: Playing | null, now: number): 'drop' | 'watch' | 'paused' {
  if (!p || p.ad || p.vid !== g.vid) return 'drop';

  if (!p.paused) {
    g.pausedAt = 0;

    return now > g.until ? 'drop' : 'watch';
  }

  if (Number.isFinite(p.duration) && p.duration - p.ct < GUARD_END_SEC) return 'drop';
  if (g.pausedAt) return 'paused';
  if (now > g.until) return 'drop';
  g.pausedAt = now;
  ctx.st.abort = ctx.st.abort || 'paused';

  return 'watch';
}

// YTM's play button lags behind our run, so a pause then is undone once.
function guardCheck(ctx: Ctx, p: Playing | null): void {
  const { st, deps, T, dom } = ctx;
  const g = st.guard;
  if (!g) return;
  const now = deps.wall();
  const step = guardStep(ctx, g, p, now);
  if (step === 'drop') st.guard = null;
  if (step !== 'paused' || !p || now - g.pausedAt < T.GUARD_SETTLE_MS) return;
  st.guard = null;
  g.presses = 1;
  const ok = dom.resume ? dom.resume() : false;
  ctx.diag('guard_resume', { ok, n: g.presses, ct: +(p.ct || 0).toFixed(1), running: st.state === 'running' });
}

function onTrackChange(ctx: Ctx, vid: string): void {
  const { st, deps, T } = ctx;

  if (st.state === 'running') {
    st.abort = st.abort || 'track_change';

    return;
  }

  st.vid = vid;
  st.since = deps.now();
  st.state = deps.settings().reorder ? 'waiting' : 'idle';
  st.waitReason = null;
  st.pageRetries = 0;
  st.quietSec = T.QUIET_SEC;
  if (st.state === 'waiting') ctx.diag('track', { id: vid });
}

// YTM reshuffles or refills a mix's queue after the track change.
function waitForQuietQueue(ctx: Ctx): boolean {
  const { st, deps, T, dom } = ctx;
  const sig = dom.signature ? dom.signature() : null;

  if (sig !== st.qsig) {
    st.qsig = sig;
    st.qsigAt = deps.now();
  }

  if (deps.now() - st.since < T.SETTLE_SEC) {
    st.waitReason = 'settle';

    return true;
  }

  const changing = deps.now() - (st.qsigAt ?? NaN) < (st.quietSec || T.QUIET_SEC);
  if (!changing) return false;
  st.waitReason = 'queue_changed';
  if (deps.now() - st.since > C.MAX_WAIT_SEC) ctx.giveUp('queue_changed');

  return true;
}

function holdStart(ctx: Ctx, p: Playing): boolean {
  const { st, deps } = ctx;
  const blocked = blockReason(ctx, p, false);

  if (blocked === 'off') {
    st.state = 'idle';

    return true;
  }

  if (blocked) {
    st.waitReason = blocked;
    if (blocked === 'near_end' || blocked === 'transition') ctx.giveUp(blocked);

    return true;
  }

  const wait = waitReason(ctx, p);
  if (!wait) return false;
  st.waitReason = wait;
  if (wait === 'user_input' && deps.now() - st.since > C.MAX_WAIT_SEC) ctx.giveUp('user_input');

  return true;
}

function retryAfterPageChange(ctx: Ctx, vid: string): void {
  const { st, deps, T } = ctx;
  const last = st.lastRun;
  if (!last || last.reason !== 'queue_changed' || st.vid !== vid || st.contested === vid) return;

  if ((st.pageRetries ?? 0) >= T.PAGE_RETRIES) {
    contest(ctx);

    return;
  }

  st.pageRetries = (st.pageRetries ?? 0) + 1;
  st.state = 'waiting';
  st.since = deps.now() - T.SETTLE_SEC;
  st.qsigAt = deps.now();
  st.waitReason = 'queue_changed';
  st.quietSec = T.PAGE_QUIET_SEC;
  ctx.diag('retry', { n: st.pageRetries, why: 'queue_changed' });
}

function afterRun(ctx: Ctx, vid: string): void {
  const { st, deps, T, dom } = ctx;
  if (st.state === 'running') st.state = 'done';
  st.runEndAt = deps.wall();

  try {
    if (dom.ids && dom.selIndex) st.obs = { ids: dom.ids(), sel: dom.selIndex() };
  } catch {
    /* ignore */
  }

  retryAfterPageChange(ctx, vid);
  if (st.guard) st.guard.until = deps.wall() + T.GUARD_MS;
}

function startRun(ctx: Ctx, vid: string): void {
  const { st } = ctx;
  st.state = 'running';
  st.abort = null;
  st.guard = { vid, until: Infinity, pausedAt: 0, presses: 0 };
  st.runScrolls = {};
  void run(ctx, vid)
    .catch((e: unknown) => {
      ctx.record(Object.assign(ctx.runBase(null), { result: 'aborted' as const, reason: 'error' }));
      ctx.diag('error', { message: String((e as Error | null)?.message || e).slice(0, 120) });
    })
    .finally(() => {
      afterRun(ctx, vid);
    });
}

function watchFrame(ctx: Ctx, p: Playing | null): void {
  try {
    guardCheck(ctx, p);
  } catch {
    /* ignore */
  }

  if (!ctx.deps.settings().reorder) return;

  try {
    watch(ctx);
  } catch {
    /* ignore */
  }
}

// Driven by the meter frame, which keeps running in hidden tabs.
function tick(ctx: Ctx): void {
  const { st, deps, T } = ctx;
  const p = deps.playing();
  watchFrame(ctx, p);
  if (!p?.vid || p.ad) return;

  if (p.vid !== st.vid) {
    onTrackChange(ctx, p.vid);

    return;
  }

  if (st.state === 'idle' && deps.settings().reorder) {
    st.state = 'waiting';
    st.since = deps.now();
    st.quietSec = T.QUIET_SEC;
  }

  if (st.state !== 'waiting') return;

  if (st.contested === st.vid) {
    st.state = 'done';

    return;
  }

  if (waitForQuietQueue(ctx) || holdStart(ctx, p)) return;
  startRun(ctx, p.vid);
}

function debugState(ctx: Ctx) {
  const { st, deps, T } = ctx;
  const now = deps.now();
  const left = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.round(x * 10) / 10) : null);
  const waiting = st.state === 'waiting';
  const wait = waiting ? st.waitReason : null;
  let remain: number | null = null;
  if (wait === 'settle') remain = left(T.SETTLE_SEC - (now - st.since));
  else if (wait === 'queue_changed') remain = left((st.quietSec || T.QUIET_SEC) - (now - (st.qsigAt ?? NaN)));
  else if (wait === 'user_input') remain = left(T.IDLE_SEC - (now - st.lastInput));
  const contested = st.contested === st.vid && !!st.vid;

  return { state: st.state, wait, remain, pageRetries: st.pageRetries || 0, contested, focus: ctx.hasFocus() };
}

export function createReorderer(deps: ReordererDeps) {
  const ctx = createContext(deps);
  const { st } = ctx;
  const onInput = createInputListener(ctx);
  for (const type of WAIT_INPUT) deps.win.addEventListener(type, onInput, true);

  deps.dom.setNote?.((kind, x) => {
    ctx.diag(kind, x);
  });

  const status = () => ({
    state: st.state,
    wait: st.state === 'waiting' ? st.waitReason : null,
    runs: st.runs,
    last: st.lastRun,
    userMoved: st.userMoved.size,
  });

  return {
    tick: () => {
      tick(ctx);
    },
    status,
    debugState: () => debugState(ctx),
    destroy: () => {
      for (const type of WAIT_INPUT) deps.win.removeEventListener(type, onInput, true);
    },
    _st: st,
  };
}

export type Reorderer = ReturnType<typeof createReorderer>;
