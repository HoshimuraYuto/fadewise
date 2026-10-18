import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../shared/reorder.mts';
import * as RP from '../page/reorder-page.mts';
import { createQueueSim, tk, type QueueSim, type QueueSimOptions, type SimTrack } from './helpers/queue-sim.mts';

const TRACKS: Record<string, SimTrack> = {
  cur: { tk: tk(120, '8A') },
  a: { tk: tk(150, '2B') },
  b: { tk: tk(95, '4B') },
  c: { tk: tk(121, '9A') },
  d: { tk: tk(122, '10A') },
  e: {},
  f: { tk: tk(120, '8B') },
  g: { tk: tk(140, '5A') },
  h: { tk: tk(119, '7A') },
};
const IDS = ['cur', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const mk = (over?: Partial<QueueSimOptions>) =>
  createQueueSim(Object.assign({ ids: IDS.slice(), tracks: TRACKS, timing: {} }, over));
const lastRun = (sim: QueueSim) => sim.runs[sim.runs.length - 1] as RP.RunRecord | undefined;

function during(sim: QueueSim, n: number, fn: (vid: string) => void) {
  let k = 0;
  const orig = sim.qdom.drag;
  sim.qdom.drag = async (vid, to, stop) =>
    orig(vid, to, () => {
      if (++k === n) fn(vid);

      return stop();
    });
}

async function runOnce(sim: QueueSim) {
  await sim.run(7.5);
  await sim.settle();

  return lastRun(sim)!;
}

test('abort: rows added at the end during a drag (the list loading more as it scrolls) do not stop it', async () => {
  const sim = mk();
  during(sim, 2, () => {
    sim.appendRows(['x1', 'x2', 'x3']);
  });
  const run = await runOnce(sim);
  assert.equal(run.result, 'done', JSON.stringify(run));
  assert.deepEqual(sim.store, sim.ids());
  assert.equal(sim.ids()[sim.sel], 'cur');
});

test('abort: the same rows re-rendered in the same order during a drag do not stop it', async () => {
  const sim = mk();
  during(sim, 2, (vid) => {
    sim.rerender(sim.doc.querySelectorAll('#contents > *')[sim.ids().indexOf(vid)]);
  });
  const run = await runOnce(sim);
  assert.equal(run.result, 'done', JSON.stringify(run));
  assert.equal(sim.ids()[sim.sel], 'cur');
});

test('abort: the list scrolling under a resting pointer (trusted move, same screen position) is not input', async () => {
  const sim = mk();
  sim.trusted('pointermove', { screenX: 300, screenY: 400, clientX: 300, clientY: 400 });
  await sim.run(3);
  during(sim, 2, () => {
    sim.scrollUnderPointer(300, 400);
  });
  const run = await runOnce(sim);
  assert.equal(run.result, 'done', JSON.stringify(run));
  assert.ok(sim.diag.some((d) => d.kind === 'ro_run'));
});

test('abort: a scroll under a resting pointer before the start is not input (the start waits for the scroll only)', async () => {
  const sim = mk();
  sim.trusted('pointermove', { screenX: 300, screenY: 400, clientX: 300, clientY: 400 });
  // Chrome fires trusted moves at the same point when the list scrolls under a resting pointer
  await sim.run(5, (s) => {
    if (Math.round(s.clock * 10) % 5 === 0) s.scrollUnderPointer(300, 400);
  });
  await sim.run(3);
  await sim.settle();
  assert.equal(lastRun(sim)?.result, 'done', JSON.stringify(sim.ro.status()));
  assert.ok(!sim.diag.some((d) => d.kind === 'ro_input' && d.use === 'activity'));
});

test('abort: no input stops a run — trusted presses, keys, wheels, touches and clicks with focus', async () => {
  for (const [type, init] of [
    ['pointerdown', {}],
    ['mousedown', {}],
    ['keydown', {}],
    ['wheel', { deltaY: 60 }],
    ['click', {}],
  ] as const) {
    const sim = mk();
    during(sim, 2, () => {
      sim.trusted(type, init);
    });
    const run = await runOnce(sim);
    assert.equal(run.result, 'done', `${type} ${JSON.stringify(run)}`);
    assert.equal(sim.runs.length, 1, type);
  }
});

test("abort: our own synthetic press arriving as trusted (seen on the user's Chrome) is not recorded at all", async () => {
  const sim = mk();
  sim.ro.destroy();
  const ro = RP.createReorderer({
    R,
    win: sim.w,
    dom: sim.qdom,
    isTrusted: () => true,
    hasFocus: () => true,
    timing: {},
    now: () => sim.clock,
    wall: () => sim.wall,
    playing: () => sim.playing,
    trState: () => 'idle',
    trArmAt: () => null,
    settings: () => sim.settings,
    entry: (vid) => ((TRACKS[vid] as SimTrack | undefined)?.tk ? { tk: TRACKS[vid].tk } : null),
    onRun: (r) => sim.runs.push(r),
    onDiag: (d) => sim.diag.push(d),
  });
  sim.ro = ro;
  await sim.run(7.5);
  await sim.settle();
  assert.equal(lastRun(sim)?.result, 'done', JSON.stringify(sim.runs));
  assert.equal(sim.diag.filter((d) => d.kind === 'ro_input').length, 0, 'nothing recorded during the run');
  assert.equal(ro._st.lastInput, -Infinity);
  sim.trusted('pointerdown');
  assert.equal(ro._st.lastInput, -Infinity);
  sim.wall += 1100;
  sim.trusted('keydown');
  assert.notEqual(ro._st.lastInput, -Infinity, 'recorded again after 1 s');
});

test('abort: before the start, a focused press, key or moving wheel postpones it by 2 s and is shown', async () => {
  for (const [type, init] of [
    ['pointerdown', { clientX: 120, clientY: 300 }],
    ['keydown', {}],
    ['wheel', { deltaY: 40 }],
  ] as const) {
    const sim = mk();
    await sim.run(4.5);
    sim.trusted(type, init);
    await sim.run(1);
    assert.equal(sim.runs.length, 0, type);
    assert.equal(sim.ro.status().wait, 'user_input', type);
    const d = sim.debug.find((v) => v.ev === 'input');
    assert.ok(d && d.type === type, type);
    await sim.run(2);
    await sim.settle();
    assert.equal(lastRun(sim)?.result, 'done', type);
  }
});

test('abort: before the start, no-focus input, wheels without movement, moves and our panel do not postpone', async () => {
  const sim = mk();
  const host = sim.doc.createElement('fadewise-debug');
  sim.doc.body.appendChild(host);
  await sim.run(4.5);
  sim.focus = false;
  sim.trusted('pointerdown');
  sim.trusted('wheel', { deltaY: 40 });
  sim.focus = true;
  sim.trusted('wheel', { deltaY: 0 });
  sim.trusted('pointermove', { screenX: 5, screenY: 5 });
  sim.trusted('mousemove', { screenX: 9, screenY: 9 });
  const e = Object.assign(new sim.w.MouseEvent('pointerdown', { bubbles: true }), { __trusted: true });
  host.dispatchEvent(e);
  await sim.run(1);
  await sim.settle();
  assert.equal(lastRun(sim)?.result, 'done', JSON.stringify(sim.ro.status()));
  assert.equal(sim.debug.filter((v) => v.ev === 'input').length, 0);
});

test('abort: the result check stops a run — a move that does not land (no drop) ends it', async () => {
  const sim = mk({ flags: { noDrop: true } });
  const run = await runOnce(sim);
  assert.equal(run.result, 'aborted');
  assert.equal(run.reason, 'drop');
  assert.equal(sim.runs.length, 1, 'not retried');
});

test('abort: the result check stops a run — the playing track changing mid-run ends it', async () => {
  const sim = mk();
  let k = 0;
  const orig = sim.qdom.drag;

  sim.qdom.drag = async (...a) => {
    const r = await orig(...a);
    if (++k === 1) sim.playing!.vid = 'zzz';

    return r;
  };

  const run = await runOnce(sim);
  assert.ok(['playing', 'track_change'].includes(run.reason!), JSON.stringify(run));
  assert.equal(run.moved, 0);
});

test('abort: a drag that needs no scroll leaves the list where it is', async () => {
  const sim = mk();
  sim.scroll = 0;
  await runOnce(sim);
  assert.equal(lastRun(sim)?.result, 'done');
  assert.equal(sim.scroll, 0);
});

test('abort: the list still scrolling (YTM bringing the playing row into view) postpones the start', async () => {
  const sim = mk();
  await sim.run(8, (s) => {
    if (Math.round(s.clock * 10) % 3 === 0) s.scroll = (s.scroll + 7) % 80;
  });
  assert.equal(sim.runs.length, 0, JSON.stringify(sim.ro.status()));
  assert.equal(sim.ro.status().wait, 'queue_changed');
  await sim.run(2.5);
  await sim.settle();
  assert.equal(lastRun(sim)?.result, 'done');
});

test('abort: stored runs of older versions keep which input stopped them', () => {
  assert.equal(R.sanitizeRun({ at: 1, result: 'aborted', reason: 'user_input', by: 'wheel' })?.by, 'wheel');
  assert.equal(R.sanitizeRun({ at: 1, result: 'aborted', reason: 'timeout', by: 'wheel' })?.by, undefined);
});
