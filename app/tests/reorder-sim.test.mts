import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../shared/reorder.mts';
import * as RP from '../page/reorder-page.mts';
import { createQueueSim, tk, type QueueSim, type QueueSimOptions, type SimTrack } from './helpers/queue-sim.mts';

const KEYS: Record<string, ReturnType<typeof tk>> = {
  a: tk(150, '2B'),
  b: tk(95, '4B'),
  c: tk(121, '9A'),
  d: tk(122, '10A'),
  f: tk(120, '8B'),
  g: tk(140, '5A'),
  h: tk(119, '7A'),
};

function radio(over?: Partial<QueueSimOptions>) {
  const tracks: Record<string, SimTrack> = { cur: { tk: tk(120, '8A') }, e: {} };
  for (const [id, k] of Object.entries(KEYS)) tracks[id] = { tk: k };

  return createQueueSim(Object.assign({ ids: ['cur', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], tracks }, over));
}

const lastRun = (sim: QueueSim) => sim.runs[sim.runs.length - 1];

test('sim: after the settle time the planned order is applied by drags; panel, store and playing track agree', async () => {
  const sim = radio();
  const before = sim.upcoming();
  const plan = R.planReorder(
    R.summaryOf('cur', { bpm: 120, bc: 1, cam: '8A', kc: 1, fc: 1, rel: [] }),
    before.map((id) => R.summaryOf(id, KEYS[id] as (typeof KEYS)[string] | undefined)),
  );
  assert.equal(plan.changed, true);
  await sim.run(2.5);
  assert.equal(sim.runs.length, 0, 'waits for the queue to settle');
  await sim.run(1);
  await sim.settle();
  const run = lastRun(sim);
  assert.equal(run.result, 'done', JSON.stringify(run));
  assert.equal(run.method, 'drag');
  assert.ok(run.moved >= 1 && run.moved <= 6);
  assert.deepEqual(sim.upcoming(), plan.order);
  assert.deepEqual(sim.store, sim.ids(), 'store = panel');
  assert.equal(sim.ids()[sim.sel], 'cur');
  assert.equal(new Set(sim.ids()).size, sim.ids().length, 'no duplicates');
  assert.equal(sim.events.filter((e) => e[0] === 'drop').length, run.moved, 'one drop per move');
  assert.ok(
    sim.events.filter((e) => e[0] === 'down').every((e) => e[2] === false),
    'synthetic events are untrusted',
  );
});

test('sim: once per track; the same queue on the next track is not touched again (plan is anchored)', async () => {
  const sim = radio();
  await sim.run(4);
  await sim.settle();
  const moved1 = sim.events.length;
  await sim.run(10);
  await sim.settle();
  assert.equal(sim.runs.length, 1, 'one run per track');
  assert.equal(sim.events.length, moved1);
});

test('sim: off by default does nothing; turning it on starts on the current track', async () => {
  const sim = radio({ settings: { reorder: false } });
  await sim.run(6);
  assert.equal(sim.runs.length, 0);
  assert.equal(sim.events.length, 0);
  sim.settings.reorder = true;
  await sim.run(4);
  await sim.settle();
  assert.equal(lastRun(sim).result, 'done');
});

test('sim: real input waits (activity); a real press during a run does not stop it; synthetic input does not count', async () => {
  const sim = radio();

  for (let i = 0; i < 6; i++) {
    sim.trusted('keydown', { key: 'a' });
    await sim.run(1);
  }

  assert.equal(sim.runs.length, 0);
  assert.equal(sim.ro.status().wait, 'user_input');
  await sim.run(2.5);
  sim.w.dispatchEvent(new sim.w.MouseEvent('mousemove', { bubbles: true }));
  let pressed = false;
  const orig = sim.qdom.drag;

  sim.qdom.drag = async (...a) => {
    if (!pressed) {
      pressed = true;
      sim.trusted('pointerdown');
    }

    return orig(...a);
  };

  await sim.run(0.5);
  await sim.settle();
  const run = lastRun(sim);
  assert.equal(run.result, 'done', JSON.stringify(run));
  assert.equal(sim.ids()[sim.sel], 'cur');
  assert.deepEqual(sim.store, sim.ids());
});

test('sim: presses repeated before the start postpone it until 2 s after the last one', async () => {
  const sim = radio();

  for (let i = 0; i < 8; i++) {
    sim.trusted('pointerdown');
    sim.trusted('pointerup');
    await sim.run(1);
  }

  assert.equal(sim.runs.length, 0);
  assert.equal(sim.ro.status().wait, 'user_input');
  await sim.run(2.5);
  await sim.settle();
  assert.equal(lastRun(sim).result, 'done');
});

test('sim: ads — nothing starts during an ad, and an ad starting mid-run stops it with the row put back', async () => {
  const sim = radio();
  const playing = sim.playing!;
  playing.ad = true;
  await sim.run(6);
  assert.equal(sim.runs.length, 0);
  playing.ad = false;
  let n = 0;
  const orig = sim.qdom.drag;
  sim.qdom.drag = async (vid, to, stop) =>
    orig(vid, to, () => {
      if (++n === 3) playing.ad = true;

      return stop();
    });
  const before = sim.ids();
  await sim.run(3.5);
  await sim.settle();
  const run = lastRun(sim);
  assert.equal(run.reason, 'ad', JSON.stringify(run));
  assert.equal(run.moved, 0);
  assert.deepEqual(sim.ids(), before, 'the dragged row went back');
  assert.deepEqual(sim.store, sim.ids());
});

test('sim: albums are left alone unless "albums too" is on', async () => {
  const off = radio({ list: 'OLAK5uy_abc', infinite: false });
  await off.run(4);
  await off.settle();
  assert.equal(lastRun(off).reason, 'kind');
  assert.equal(off.events.length, 0);
  const on = radio({ list: 'OLAK5uy_abc', infinite: false, settings: { reorder: true, reorderAlbums: true } });
  await on.run(4);
  await on.settle();
  assert.equal(lastRun(on).kind, 'album');
  assert.equal(lastRun(on).result, 'done');
  const pl = radio({ list: 'PLxyz', infinite: false });
  await pl.run(4);
  await pl.settle();
  assert.equal(lastRun(pl).kind, 'playlist');
  assert.equal(lastRun(pl).result, 'done');
});

test('sim: not within the last 20 s, and not once the transition is armed (or about to be)', async () => {
  const sim = radio();
  sim.playing!.duration = 30;
  sim.playing!.ct = 5;
  await sim.run(6);
  assert.equal(lastRun(sim).reason, 'near_end');
  assert.equal(sim.events.length, 0);
  const s2 = radio();
  s2.tr.state = 'armed';
  await s2.run(4);
  assert.equal(lastRun(s2).reason, 'transition');
  const s3 = radio();
  s3.tr.armAt = 10;
  await s3.run(4);
  assert.equal(lastRun(s3).reason, 'transition');
  assert.equal(s3.events.length, 0);
});

test('sim: the end of the track approaching during a run stops before the next move', async () => {
  const sim = radio();
  sim.playing!.duration = 40;
  sim.playing!.ct = 5;
  const orig = sim.qdom.drag;

  sim.qdom.drag = async (...a) => {
    const r = await orig(...a);
    sim.playing!.ct += 6;

    return r;
  };

  await sim.run(3.5);
  await sim.settle();
  const run = lastRun(sim);
  assert.equal(run.reason, 'near_end', JSON.stringify(run));
  assert.ok(run.moved >= 1 && run.moved < run.planned);
  assert.equal(run.result, 'partial');
});

test('sim: a drop that the store did not take, a double drop, and a store that lags are all caught', async () => {
  for (const [flag, reason] of [
    ['noDrop', 'drop'],
    ['dropTwice', 'drop'],
    ['storeLags', 'store'],
  ]) {
    const sim = radio({ flags: { [flag]: true } });
    await sim.run(4);
    await sim.settle();
    const run = lastRun(sim);
    assert.equal(run.reason, reason, `${flag}: ${JSON.stringify(run)}`);
    assert.equal(run.moved, 0, flag);
    assert.equal(sim.events.filter((e) => e[0] === 'down').length, 1, `${flag}: stopped after the first move`);
  }
});

test('sim: a user move between runs is respected (that track is not moved again for a while)', async () => {
  const sim = radio();
  await sim.run(4);
  await sim.settle();
  const up = sim.upcoming();
  const pick = up[up.length - 1];
  sim.userMove(pick, sim.sel + 2);
  sim.next();
  assert.equal(sim.upcoming()[0], pick);
  await sim.run(4);
  await sim.settle();
  const planDiag = sim.diag.filter((d) => d.kind === 'ro_plan').pop()!;
  assert.ok((planDiag.fixed as string[]).includes(pick), JSON.stringify(planDiag));
  assert.equal(sim.ro.status().userMoved, 1);
  assert.equal(sim.upcoming()[0], pick, 'stays where the user put it');
  assert.equal(sim.diag.filter((d) => d.kind === 'ro_user_moved').length, 1);
});

test('sim: the playing track changing mid-run stops the run', async () => {
  const sim = radio();
  const orig = sim.qdom.drag;

  sim.qdom.drag = async (...a) => {
    const r = await orig(...a);
    sim.playing!.vid = 'zzz';

    return r;
  };

  await sim.run(4);
  await sim.settle();
  const run = lastRun(sim);
  assert.ok(['playing', 'track_change'].includes(run.reason!), JSON.stringify(run));
});

test('sim: queue panel closed -> only the next slot, by "Play next" + "Remove from queue", no duplicate', async () => {
  const sim = radio();
  sim.setPanel(false);
  const before = sim.upcoming();
  await sim.run(4);
  await sim.settle();
  const run = lastRun(sim);
  assert.equal(run.method, 'menu', JSON.stringify(run));
  assert.equal(run.result, 'done');
  assert.equal(run.moved, 1);
  assert.equal(sim.menuOps, 2);
  assert.notEqual(sim.upcoming()[0], before[0]);
  assert.equal(new Set(sim.ids()).size, sim.ids().length);
  assert.equal(sim.ids().length, before.length + 1);
  assert.equal(sim.ids()[sim.sel], 'cur');
  const moved = sim.upcoming()[0];
  assert.deepEqual(
    sim.upcoming().slice(1),
    before.filter((x) => x !== moved),
  );
});

test('sim: hidden tab -> rows are not dragged; the next slot only, by the row menu', async () => {
  const sim = radio();
  Object.defineProperty(sim.doc, 'hidden', { value: true, configurable: true });
  await sim.run(4);
  await sim.settle();
  const run = lastRun(sim);
  assert.equal(run.method, 'menu', JSON.stringify(run));
  assert.equal(sim.events.filter((e) => e[0] === 'down').length, 0, 'no drag in a hidden tab');
  assert.equal(new Set(sim.ids()).size, sim.ids().length);
});

test('sim: hidden tab -> the menu items are found without layout, by icon and the endpoint naming the row', async () => {
  const sim = radio();
  Object.defineProperty(sim.doc, 'hidden', { value: true, configurable: true });
  const before = sim.upcoming();
  await sim.run(4);
  await sim.settle();
  const run = lastRun(sim);
  assert.equal(run.result, 'done', JSON.stringify(run));
  assert.deepEqual(sim.menuClicks, ['QUEUE_PLAY_NEXT', 'REMOVE']);
  const moved = sim.upcoming()[0];
  assert.notEqual(moved, before[0]);
  assert.deepEqual(
    sim.upcoming().slice(1),
    before.filter((x) => x !== moved),
  );
  assert.equal(sim.menuOpen(), false);
});

test('sim: menu items without the expected endpoint are never clicked; the menu is closed and the queue unchanged', async () => {
  for (const flag of ['menuNoEndpoint', 'menuNeverOpens']) {
    const sim = radio({ flags: { [flag]: true } });
    sim.setPanel(false);
    const before = sim.ids();
    await sim.run(4);
    await sim.settle();
    const run = lastRun(sim);
    assert.equal(run.result, 'aborted', flag + ' ' + JSON.stringify(run));
    assert.equal(run.reason, 'menu');
    assert.equal(sim.menuOps, 0, flag);
    assert.equal(sim.menuOpen(), false, flag);
    assert.deepEqual(sim.ids(), before, flag);
  }
});

test('sim: a drag that does not settle in time is stopped and put back (timeout)', async () => {
  const sim = radio();
  const slow = RP.createQueueDom(sim.w, {
    stepPx: 8,
    stepMs: 0,
    settleMs: 0,
    dropWaitMs: 0,
    scrollWaitMs: 0,
    moveTimeoutMs: -1,
    sleep: () =>
      new Promise<void>((r) => {
        setTimeout(r, 0);
      }),
  });
  const before = sim.ids();
  const r = await slow.drag('h', 1, () => null);
  assert.equal(r.ok, false);
  assert.equal(r.stopped, 'timeout');
  assert.deepEqual(sim.ids(), before);
});

test('sim: turning the setting off mid-run stops it', async () => {
  const sim = radio();
  const orig = sim.qdom.drag;
  sim.qdom.drag = async (vid, to, stop) =>
    orig(vid, to, () => {
      sim.settings.reorder = false;

      return stop();
    });
  await sim.run(4);
  await sim.settle();
  assert.equal(lastRun(sim).reason, 'off');
});

test('sim: 20 track changes in a row on a long radio queue: each run checked, no duplicates, playing track intact', async () => {
  const keys = Array.from({ length: 24 }, (_, i) => `${String((i % 12) + 1)}${i < 12 ? 'A' : 'B'}`);
  const ids = Array.from({ length: 40 }, (_, i) => 'v' + String(i).padStart(2, '0'));
  const tracks: Record<string, SimTrack> = {};
  ids.forEach((id, i) => {
    tracks[id] = i % 4 === 3 ? {} : { tk: tk(90 + ((i * 29) % 70), keys[(i * 7) % 24], i % 5 === 0 ? 0.4 : 0.9) };
  });
  const sim = createQueueSim({ ids, tracks });
  const results: RP.RunRecord[] = [];

  for (let k = 0; k < 20; k++) {
    await sim.run(4);
    await sim.settle();
    const run = lastRun(sim);
    results.push(run);
    assert.equal(sim.ids()[sim.sel], sim.playing!.vid, `track ${k}`);
    assert.equal(new Set(sim.ids()).size, ids.length, `no duplicates at ${k}`);
    assert.deepEqual(sim.store, sim.ids(), `store at ${k}`);
    assert.ok(run.moved <= 6);
    sim.next();
  }

  assert.equal(results.length, 20);
  assert.equal(sim.runs.length, 20, 'exactly one run per track');
  assert.ok(
    results.every((r) => ['done', 'skipped'].includes(r.result)),
    JSON.stringify(results.map((r) => `${r.result}:${String(r.reason)}`)),
  );
  assert.ok(results.some((r) => r.result === 'done'));
  const later = results
    .slice(1)
    .filter((r) => r.result === 'done')
    .reduce((s, r) => s + r.moved, 0);
  assert.ok(later <= 19 * 2, `moves after the first run: ${later}`);
});
