import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import { createSim, entry, type Sim, type SimOptions } from './helpers/player-sim.mts';

const LOUD = 1e-3,
  SILENT = 1e-9;

function energy(opts: { lastSound: number; breakAt?: [number, number] }) {
  return (vid: string, ct: number) => {
    if (vid !== 'A') return LOUD;
    if (opts.breakAt && ct >= opts.breakAt[0] && ct < opts.breakAt[1]) return SILENT;

    return ct < opts.lastSound ? LOUD : SILENT;
  };
}

const base = (over?: Partial<SimOptions>) =>
  Object.assign(
    {
      queue: ['A', 'B', 'C'],
      tracks: { A: { d: 100 }, B: { d: 120 }, C: { d: 90 } },
      index: { B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) },
    },
    over || {},
  );

function watch() {
  const seen = { minA: 1, minB: 1 };

  return {
    seen,
    fn: (s: Sim) => {
      const g = s.fg();
      if (s.vid() === 'A') seen.minA = Math.min(seen.minA, g);
      if (s.vid() === 'B') seen.minB = Math.min(seen.minB, g);
    },
  };
}

test('first play: trailing silence of 4 s -> next once 1.0 s of it is heard within the last 3 s, no fade on either side', async () => {
  const sim = createSim(base({ energyAt: energy({ lastSound: 96 }) }));
  const w = watch();
  await sim.start(85);
  await sim.run(11.6, w.fn);
  assert.strictEqual(sim.clicks, 0);
  await sim.run(0.4, w.fn);
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.vid(), 'B');
  await sim.run(1, w.fn);
  assert.strictEqual(w.seen.minA, 1, 'the outgoing track is never lowered');
  assert.strictEqual(w.seen.minB, 1, 'the incoming track is not faded in by the transition');
  const snapA = sim.snapshots.filter((s) => s.videoId === 'A').pop();
  const tr = A.sanitizeApplied(snapA!.applied)!.transition;
  assert.deepStrictEqual([tr!.kind, tr!.reason, tr!.state], ['live_trim', 'live_silence', 'advanced']);
  assert.ok(tr!.atSec! >= 97 && tr!.atSec! <= 97.2, `at ${tr!.atSec}`);
  assert.ok(Math.abs(tr!.skipSec! - (100 - tr!.atSec!)) < 0.05);
  assert.strictEqual(sim.status.fade.transition.incoming.headReason, 'live');
  assert.ok(snapA!.lastSound && Math.abs(snapA!.lastSound.pos - 96) < 0.15, JSON.stringify(snapA!.lastSound));
  assert.ok(snapA!.tailFrames && snapA!.tailFrames.lufs.length >= 100);
  const rec = A.mergeRecord(null, snapA as A.Snapshot, 1);
  assert.ok(['decays', 'fades', 'stop'].includes(rec.ending!.kind), rec.ending!.kind);
  const plan = A.planTransition(A.indexEntryOf(rec), { enabled: true });
  assert.notStrictEqual(plan.kind, 'none', JSON.stringify(plan));
});

test('first play: a long silence that starts early waits until 3 s before the end', async () => {
  const sim = createSim(base({ energyAt: energy({ lastSound: 90 }) }));
  await sim.start(80);
  await sim.run(16.6);
  assert.strictEqual(sim.clicks, 0);
  await sim.run(0.4);
  assert.strictEqual(sim.clicks, 1);
});

test('first play: a break in the last seconds (sound comes back) never presses; it cancels the armed state', async () => {
  const e = (vid: string, ct: number) =>
    vid !== 'A' ? LOUD : (ct >= 94 && ct < 95.6) || (ct >= 96.3 && ct < 97) || ct >= 99.6 ? SILENT : LOUD;
  const sim = createSim(base({ energyAt: e }));
  await sim.start(85);
  await sim.run(12);
  assert.ok(
    sim.diag.some((d) => d.kind === 'tr_end' && d.reason === 'sound'),
    'armed, then cancelled by the sound',
  );
  await sim.run(4);
  assert.strictEqual(sim.clicks, 0, 'the player advanced by itself');
  assert.strictEqual(sim.vid(), 'B');
});

test('first play: silence with less than the 1.0 s minimum before the end of the file does nothing', async () => {
  const sim = createSim(base({ energyAt: energy({ lastSound: 99.3 }) }));
  await sim.start(85);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 0);
});

test('first play: a quiet intro or a silence early in the track never presses', async () => {
  const e = (vid: string, ct: number) => (vid !== 'A' ? LOUD : ct < 4 || (ct >= 40 && ct < 50) ? SILENT : LOUD);
  const sim = createSim(base({ energyAt: e }));
  await sim.start(0);
  await sim.run(55);
  assert.strictEqual(sim.clicks, 0);
});

test("first play: pause, seek, ad, off and the user's next cancel it; nothing is lowered", async () => {
  for (const act of ['pause', 'seek', 'ad', 'off', 'user_next']) {
    const sim = createSim(base({ energyAt: energy({ lastSound: 96 }) }));
    const w = watch();
    await sim.start(85);
    await sim.run(11.5, w.fn);
    assert.strictEqual(sim.status.fade.transition.state, 'armed', act);

    if (act === 'pause') {
      sim.pause();
      await sim.run(2, w.fn);
      void sim.play();
    } else if (act === 'seek') {
      sim.seek(60);
      await sim.run(2, w.fn);
    } else if (act === 'ad') {
      sim.setAd(true);
      await sim.run(2, w.fn);
      sim.setAd(false);
    } else if (act === 'off') {
      sim.send('settings', { transitions: false });
      await sim.run(2, w.fn);
    } else if (act === 'user_next') {
      sim.w.document.getElementById('next')!.click();
      await sim.run(0.5, w.fn);
    }

    const clicks = act === 'user_next' ? 1 : 0;
    assert.strictEqual(sim.clicks, clicks, `${act}: no click of ours`);
    assert.strictEqual(w.seen.minA, 1, act);

    if (act !== 'user_next' && act !== 'seek') {
      const status = sim.status.fade && sim.status.fade.transition;
      assert.ok(status && status.result !== 'advanced', act);
    }
  }
});

test('first play: "close the gap" off -> no watch at all', async () => {
  const sim = createSim(base({ energyAt: energy({ lastSound: 96 }), settings: { transitions: false } }));
  await sim.start(85);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 0);
});

test('first play: an analysed track keeps its planned transition (and its fade-in), not the live one', async () => {
  const sim = createSim(
    base({
      energyAt: energy({ lastSound: 95 }),
      index: { A: entry(100, 'decays', 95), B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) },
    }),
  );
  await sim.start(85);
  await sim.run(10.4);
  assert.strictEqual(sim.clicks, 1);
  const snapA = sim.snapshots.filter((s) => s.videoId === 'A').pop();
  assert.strictEqual(A.sanitizeApplied(snapA!.applied)!.transition!.kind, 'trim');
});

test('first play: 10 unanalysed tracks in a row, one click each, gain never lowered', async () => {
  const queue = Array.from({ length: 11 }, (_, i) => 'T' + i);
  const tracks = Object.fromEntries(queue.map((v) => [v, { d: 60 }]));
  const sim = createSim({ queue, tracks, index: {}, energyAt: (vid, ct) => (ct < 57 ? LOUD : SILENT) });
  let min = 1;
  await sim.start(40);

  for (let i = 0; i < 10; i++) {
    await sim.run(0.2);
    sim.seek(45);
    await sim.run(16, (s) => {
      min = Math.min(min, s.fg());
    });
  }

  assert.strictEqual(sim.clicks, 10);
  assert.strictEqual(min, 1);
});
