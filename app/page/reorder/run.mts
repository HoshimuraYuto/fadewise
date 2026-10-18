import type { Move, ReorderPlan } from '../../shared/reorder.mts';
import { blockReason, stopReason } from './conditions.mts';
import type { Ctx, RunRecord } from './context.mts';
import type { Span } from './drag-geometry.mts';
import type { MoveResult } from './drag.mts';
import type { QueueRead } from './queue-panel.mts';
import { contest, syncSource } from './watchers.mts';

interface Planned {
  q: QueueRead;
  upcoming: string[];
  plan: ReorderPlan;
  moves: Move[];
}
interface Progress {
  cur: string[];
  done: number;
  reason: string;
}

function summaries(ctx: Ctx, ids: string[]) {
  return ids.map((id) => {
    const e = ctx.deps.entry(id) || {};

    return ctx.R.summaryOf(id, e.tk, e);
  });
}

function fixedIds(ctx: Ctx): Set<string> {
  const fixed = new Set(ctx.st.userMoved.keys());

  try {
    for (const id of ctx.deps.fixedIds ? ctx.deps.fixedIds() : []) fixed.add(id);
  } catch {
    /* ignore */
  }

  return fixed;
}

function planRun(ctx: Ctx, q: QueueRead, vid: string, out: RunRecord): Planned {
  const { R, st } = ctx;
  syncSource(ctx, q.ids, q.list);
  const upcoming = q.ids.slice(q.sel + 1, q.sel + 1 + R.DEFAULTS.window);
  const base: Record<string, number> = {};

  st.src.forEach((id, i) => {
    base[id] = i;
  });

  const fixed = fixedIds(ctx);
  const plan = R.planReorder(summaries(ctx, [vid])[0], summaries(ctx, upcoming), { base, fixed });
  out.window = upcoming.length;
  out.movable = plan.movable;
  out.gain = plan.gain || 0;
  const moves = plan.changed ? R.movesFor(upcoming, plan.order).slice(0, R.DEFAULTS.maxMoves) : [];
  const summary = { kind: out.kind, window: upcoming.length, movable: plan.movable, reason: plan.reason };
  const order = { from: upcoming, to: plan.order, fixed: [...fixed] };
  ctx.diag('plan', { ...summary, gain: plan.gain, moves: moves.length, ...order });

  return { q, upcoming, plan, moves };
}

function moveSpans(ctx: Ctx, upcoming: string[], moves: Move[]): Span[] {
  const spans: Span[] = [];
  let order = upcoming.slice();

  for (const m of moves) {
    const from = order.indexOf(m.id);
    spans.push([Math.min(from, m.toIndex), Math.max(from, m.toIndex)]);
    order = ctx.R.applyMove(order, m);
  }

  return spans;
}

function checkBefore(ctx: Ctx, vid: string, cur: string[]): { reason: string } | { reason: null; before: QueueRead } {
  const playing = ctx.deps.playing();
  const blocked = ctx.st.abort || blockReason(ctx, playing, true);
  if (blocked) return { reason: blocked };
  const before = ctx.dom.read();
  if (before.ids[before.sel] !== vid) return { reason: 'track_change' };
  const offset = before.sel + 1;
  const changed = before.ids.slice(offset, offset + cur.length).join(',') !== cur.join(',');

  return changed ? { reason: 'queue_changed' } : { reason: null, before };
}

interface AfterMove {
  landed: boolean;
  storeOk: boolean;
  playingOk: boolean | null;
  dupOk: boolean;
  after: QueueRead;
}

function readAfterMove(ctx: Ctx, vid: string, before: QueueRead, expect: string[]): AfterMove {
  const after = ctx.dom.read();
  const p = ctx.deps.playing();
  const next = after.ids.slice(after.sel + 1, after.sel + 1 + expect.length);

  return {
    landed: next.join(',') === expect.join(','),
    storeOk: after.store === null || after.store.join(',') === after.ids.join(','),
    playingOk: p && p.vid === vid && after.ids[after.sel] === vid && after.sel === before.sel,
    dupOk: new Set(after.ids).size === after.ids.length,
    after,
  };
}

function moveFailure(method: RunRecord['method'], m: Move, res: MoveResult, a: AfterMove): string | null {
  if (res.stopped) return res.stopped;
  if (!res.ok) return res.reason || 'error';
  if (method === 'drag' && res.drops !== (res.hops || 1)) return 'drop';
  if (!a.playingOk) return 'playing';
  if (!a.storeOk) return 'store';
  const ours = a.after.ids[a.after.sel + 1 + m.toIndex] === m.id;
  if (!a.landed && a.dupOk && ours) return 'queue_changed';
  if (!a.landed || !a.dupOk) return 'order';

  return null;
}

async function moveOnce(ctx: Ctx, run: { vid: string; out: RunRecord }, m: Move, ahead: Span[], p: Progress) {
  const { dom } = ctx;
  const check = checkBefore(ctx, run.vid, p.cur);
  if (check.reason !== null) return check.reason;
  const offset = check.before.sel + 1;
  const expect = ctx.R.applyMove(p.cur, m);
  const drag = run.out.method === 'drag';
  const res = drag
    ? await dom.drag(m.id, offset + m.toIndex, () => stopReason(ctx), ahead)
    : await dom.playNextMove(m.id);
  const a = readAfterMove(ctx, run.vid, check.before, expect);
  const resView = { ok: res.ok, reason: res.reason, stopped: res.stopped, drops: res.drops, hops: res.hops };
  const checks = { landed: a.landed, storeOk: a.storeOk, playingOk: a.playingOk, dupOk: a.dupOk };
  ctx.diag('move', { method: run.out.method, id: m.id, to: m.toIndex, res: resView, ...checks });
  if (res.stopped && res.by) run.out.by = res.by;
  const failed = moveFailure(run.out.method, m, res, a);
  if (failed) return failed;
  p.cur = expect;
  p.done++;

  return null;
}

async function moveAll(ctx: Ctx, run: { vid: string; out: RunRecord }, planned: Planned): Promise<Progress> {
  const spans = moveSpans(ctx, planned.upcoming, planned.moves);
  const p: Progress = { cur: planned.upcoming.slice(), done: 0, reason: 'ok' };
  const first = planned.q.sel + 1;

  for (const [k, m] of planned.moves.entries()) {
    const ahead = spans.slice(k + 1).map((s): Span => [first + s[0], first + s[1]]);
    const failed = await moveOnce(ctx, run, m, ahead, p);

    if (failed) {
      p.reason = failed;
      break;
    }
  }

  return p;
}

// Having to move our last run's tracks again means the page put them back.
function noteOurMoves(ctx: Ctx, vid: string, moves: Move[], p: Progress): void {
  const { st, deps } = ctx;
  st.lastSeen = ctx.dom.read().ids.slice();
  if (!p.done) return;
  st.lastOrderSig = p.cur.join(',');
  const movedIds = new Set(moves.slice(0, p.done).map((m) => m.id));
  const ours = st.ours;
  const recent = ours && ours.vid === vid && deps.wall() - ours.at < ctx.T.CONTEST_SEC * 1000;
  if (recent && [...movedIds].some((id) => ours.ids.has(id))) contest(ctx);
  st.ours = { vid, at: deps.wall(), ids: movedIds };
}

// In a hidden tab the rows are not painted, so dragging does not work.
function chooseMethod(ctx: Ctx, planned: Planned, out: RunRecord): boolean {
  out.planned = planned.moves.length;
  const visible = ctx.dom.panelVisible() && !ctx.deps.win.document.hidden;

  if (visible) {
    out.method = 'drag';

    return true;
  }

  const next = planned.plan.order[0];
  if (next === planned.upcoming[0]) return false;
  planned.moves = [{ id: next, toIndex: 0 }];
  out.planned = 1;
  out.method = 'menu';

  return true;
}

export async function run(ctx: Ctx, vid: string): Promise<RunRecord> {
  const { deps, R, st, dom } = ctx;
  const t0 = deps.wall();
  const q = dom.read();
  const out = ctx.runBase(R.queueKind(q.list, q.infinite));

  const finish = (patch: Partial<RunRecord>) => {
    Object.assign(out, patch, { ms: deps.wall() - t0 });
    ctx.record(out);
    st.state = 'done';

    return out;
  };

  if (!R.kindAllowed(out.kind, deps.settings())) return finish({ reason: 'kind' });
  if (!q.ids.length || q.sel < 0 || q.ids[q.sel] !== vid) return finish({ reason: 'no_queue' });
  const planned = planRun(ctx, q, vid, out);
  if (!planned.plan.changed) return finish({ reason: planned.plan.reason });
  const sig = planned.plan.order.join(',');
  if (sig === st.lastOrderSig && planned.upcoming.join(',') === sig) return finish({ reason: 'same' });
  if (!chooseMethod(ctx, planned, out)) return finish({ reason: 'not_visible' });
  const scroll0 = out.method === 'drag' ? dom.scrollState() : null;
  const p = await moveAll(ctx, { vid, out }, planned);
  if (scroll0 !== null) dom.restoreScroll(scroll0);
  noteOurMoves(ctx, vid, planned.moves, p);
  const complete = p.done === planned.moves.length;
  const result = p.reason === 'ok' ? (complete ? 'done' : 'partial') : p.done ? 'partial' : 'aborted';

  return finish({ result, reason: p.reason, moved: p.done });
}
