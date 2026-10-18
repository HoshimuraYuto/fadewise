import { createDragGeometry, type DragGeometry, type OwnScrolls, type Span } from './drag-geometry.mts';
import {
  DROP_EVENT,
  idsOf,
  pressPoint,
  queueEl,
  queueRows,
  scrollerOf,
  selectedIndex,
  type PageWindow,
  type Row,
} from './queue-panel.mts';

export type Sleep = (ms: number) => Promise<void>;
export type StopCheck = () => string | null;
export type Note = (kind: string, x: Record<string, unknown>) => void;

export interface MoveResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  stopped?: string | null;
  by?: string;
  drops?: number;
  hops?: number;
  landed?: number;
  after?: string[];
}

export interface DragOptions {
  stepPx: number;
  stepMs: number;
  settleMs: number;
  maxSteps: number;
  dropWaitMs: number;
  scrollWaitMs: number;
  moveTimeoutMs: number;
  pointerId: number;
  edgePx: number;
  maxHops: number;
}

export interface DragEnv {
  win: PageWindow;
  o: DragOptions;
  sleep: Sleep;
  trusted: (e: Event) => boolean;
  scrolls: OwnScrolls;
  note: () => Note | null;
}

// YTM picks the row up only after a held press.
const PRESS_HOLD_MS = 150;
const SETTLED_CHECKS = 2;

interface Pointer {
  x: number;
  y: number;
  fire(type: string, buttons: number, target?: Element | null): void;
  firing(): boolean;
}

// `firing`: our events can arrive with isTrusted true.
function createPointer(win: PageWindow, row: Row, pointerId: number): Pointer {
  let firing = false;

  const pointer: Pointer = {
    x: 0,
    y: 0,
    firing: () => firing,
    fire(type, buttons, target) {
      const { x, y } = pointer;
      const base = { bubbles: true, cancelable: true, composed: true, button: 0, buttons, view: win as Window };
      const init = {
        ...base,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        pointerId,
        pointerType: 'mouse',
        isPrimary: true,
      };
      const to = target || win.document.elementFromPoint(x, y) || row;
      const Ev = type.startsWith('pointer') ? win.PointerEvent || win.MouseEvent : win.MouseEvent;
      firing = true;

      try {
        to.dispatchEvent(new Ev(type, init));
      } finally {
        firing = false;
      }
    },
  };

  return pointer;
}

function createQueueWatch(doc: Document, row: Row, vid: string, before: string[], sel0: number) {
  const selVid = sel0 >= 0 ? before[sel0] : null;
  const others0 = before.filter((v) => v !== vid).join(',');

  return () => {
    if (!row.isConnected) return true;
    const rows = queueRows(doc);
    const ids = idsOf(rows);
    const sel = selectedIndex(rows);
    if (selVid !== null && (sel !== sel0 || ids[sel] !== selVid)) return true;
    const others = ids.filter((v) => v !== vid);

    return others.slice(0, before.length - 1).join(',') !== others0;
  };
}

interface DragRun {
  env: DragEnv;
  row: Row;
  to: number;
  geo: DragGeometry;
  scroller: Element;
  pointer: Pointer;
  shouldStop: StopCheck;
  queueChanged: () => boolean;
  deadline: number;
  rel: (i: number) => number;
  state: { stopped: string | null; steps: number; hops: number; drops: number; realPress: boolean };
}

async function scrollForHop(run: DragRun, why: string, ahead: Span[] | null | undefined): Promise<void> {
  const want = run.geo.scrollWanted(ahead);
  if (Math.abs(want) >= 1 && run.env.scrolls.scrollByY(run.scroller, want, why))
    await run.env.sleep(run.env.o.scrollWaitMs);
}

function stopNow(run: DragRun): string | null {
  if (run.queueChanged()) return 'queue_changed';

  return run.shouldStop() || (Date.now() > run.deadline ? 'timeout' : null);
}

async function steer(run: DragRun, start: number): Promise<void> {
  const { env, geo, pointer, state } = run;
  let settled = 0,
    goal = run.to;

  while (state.steps < env.o.maxSteps) {
    if (!state.stopped) {
      const stop = stopNow(run);

      if (stop) {
        state.stopped = stop;
        goal = start;
        settled = 0;
      }
    }

    if (state.stopped === 'queue_changed') break;

    if (geo.liveIdx() === goal) {
      await env.sleep(env.o.settleMs);

      if (geo.liveIdx() === goal) {
        settled++;
        if (settled >= SETTLED_CHECKS) break;
        continue;
      }
    }

    settled = 0;
    const dir = geo.liveIdx() > goal ? -1 : 1;
    const lim = geo.limits();

    if (dir > 0 ? pointer.y >= lim.hi - 0.5 : pointer.y <= lim.lo + 0.5) {
      if (state.stopped) break;
      goal = geo.liveIdx();
      continue;
    }

    pointer.y = Math.max(lim.lo, Math.min(lim.hi, pointer.y + dir * env.o.stepPx));
    pointer.fire('pointermove', 1);
    pointer.fire('mousemove', 1);
    state.steps++;
    await env.sleep(env.o.stepMs);
  }
}

async function hop(run: DragRun): Promise<boolean> {
  const { env, geo, pointer, row, state } = run;
  const doc = env.win.document;
  const press = pressPoint(doc, row);

  if (!press) {
    state.stopped = 'not_visible';

    return false;
  }

  pointer.x = press.x;
  pointer.y = press.y;
  const start = geo.liveIdx();
  state.hops++;
  state.realPress = false;
  pointer.fire('pointerdown', 1, press.el);
  pointer.fire('mousedown', 1, press.el);
  await env.sleep(PRESS_HOLD_MS);
  await steer(run, start);
  const reached = { phase: 'reached', at: run.rel(geo.liveIdx()), steps: state.steps, hop: state.hops };
  env.note()?.('drag', { ...reached, stopped: state.stopped || null });
  // not elementFromPoint: after a shift it may be the playing row or a control
  const upTarget = row.isConnected ? row : queueEl(doc) || doc.body;
  pointer.fire('pointerup', 0, upTarget);
  pointer.fire('mouseup', 0, upTarget);
  await env.sleep(env.o.dropWaitMs);
  if (state.stopped || geo.liveIdx() === run.to || run.queueChanged()) return false;
  const stuck = geo.liveIdx() === start ? 'not_visible' : state.steps >= env.o.maxSteps ? 'timeout' : null;
  if (stuck) state.stopped = stuck;

  return !stuck;
}

async function hopUntilDone(run: DragRun): Promise<void> {
  for (;;) {
    if (run.state.hops > 0) {
      if (run.state.hops >= run.env.o.maxHops) {
        run.state.stopped = 'not_visible';
        break;
      }

      await scrollForHop(run, 'hop', null);

      if (!run.geo.pressable()) {
        run.state.stopped = 'not_visible';
        break;
      }
    }

    if (!(await hop(run))) break;
  }
}

// YTM: a real press during our hold takes the held row over.
async function hopListening(run: DragRun): Promise<void> {
  const { env, state } = run;
  const doc = env.win.document;

  const onDrop = () => {
    state.drops++;
  };

  const onPress = (e: Event) => {
    if (!run.pointer.firing() && env.trusted(e)) state.realPress = true;
  };

  doc.addEventListener(DROP_EVENT, onDrop, true);
  env.win.addEventListener('pointerdown', onPress, true);

  try {
    await hopUntilDone(run);
  } finally {
    doc.removeEventListener(DROP_EVENT, onDrop, true);
    env.win.removeEventListener('pointerdown', onPress, true);
  }
}

function startRun(env: DragEnv, rows: Row[], from: number, to: number, shouldStop: StopCheck): DragRun {
  const before = idsOf(rows);
  const row = rows[from];
  const scroller = (scrollerOf(env.win) || row.parentElement) as Element;
  const sel0 = selectedIndex(rows);

  return {
    env,
    row,
    to,
    geo: createDragGeometry(env.win, scroller, row, to, env.o.edgePx),
    scroller,
    pointer: createPointer(env.win, row, env.o.pointerId),
    shouldStop,
    queueChanged: createQueueWatch(env.win.document, row, before[from], before, sel0),
    deadline: 0,
    rel: (i) => (i >= 0 && sel0 >= 0 ? i - sel0 : i),
    state: { stopped: null, steps: 0, hops: 0, drops: 0, realPress: false },
  };
}

export async function drag(
  env: DragEnv,
  vid: string,
  to: number,
  shouldStop: StopCheck,
  ahead?: Span[] | null,
): Promise<MoveResult> {
  const doc = env.win.document;
  const from = idsOf(queueRows(doc)).indexOf(vid);
  if (from < 0) return { ok: false, reason: 'not_found' };
  if (from === to) return { ok: true, drops: 0, hops: 0, landed: from };
  const rows = queueRows(doc);
  if (!(rows[from] as Row | undefined) || !(rows[to] as Row | undefined)) return { ok: false, reason: 'not_found' };
  const run = startRun(env, rows, from, to, shouldStop);
  await scrollForHop(run, 'move', ahead);
  if (!run.geo.pressable() || !pressPoint(doc, run.row)) return { ok: false, reason: 'not_visible' };
  env.note()?.('drag', { phase: 'start', from: run.rel(from), to: run.rel(to) });
  run.deadline = Date.now() + env.o.moveTimeoutMs;
  await hopListening(run);
  const { state } = run;
  const byUser = state.stopped === 'not_visible' && state.realPress;
  const stopped = byUser ? 'user_input' : state.stopped;
  const after = idsOf(queueRows(doc));
  const landed = after.indexOf(vid);
  env.note()?.('drag', { phase: 'drop', drops: state.drops, hops: state.hops, landed: run.rel(landed) });

  return {
    ok: !stopped,
    stopped,
    by: byUser ? 'pointerdown' : undefined,
    drops: state.drops,
    hops: state.hops,
    landed,
    after,
  };
}
