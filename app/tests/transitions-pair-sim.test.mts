import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import { createSim, entry, type SimOptions } from './helpers/player-sim.mts';

interface TransitionStatus {
  transition: { atSec: number; pair: { extraWaitSec: number } };
}

const D = 100;
const base = (over?: Partial<SimOptions>) =>
  Object.assign(
    {
      queue: ['A', 'B', 'C'],
      tracks: { A: { d: D }, B: { d: 120 }, C: { d: 90 } },
      index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) },
    },
    over || {},
  );

const tkOf = (cam: string, bpm: number) => {
  const e = {
    bpm,
    bc: 0.9,
    cam,
    kc: 0.9,
    fc: 0.9,
    rel: [],
    src: { key: 'segment', tempo: 'segment' },
    chg: { key: false, tempo: false },
  };

  return { bpm, bc: 0.9, cam, kc: 0.9, fc: 0.9, rel: [], head: e, tail: e };
};

test('sim: wash on adds one reverb send that is closed again after the switch (keys agree)', async () => {
  const sim = createSim(
    base({
      settings: { transitionWash: true },
      index: {
        A: entry(D, 'decays', 95, { tk: tkOf('8B', 120) }),
        B: entry(120, 'fades', 110, { tk: tkOf('9B', 90), h0: -40 }),
        C: entry(90, 'decays', 85),
      },
    }),
  );
  const n0 = sim.gains.length;
  await sim.start(90);
  await sim.run(5.3);
  assert.strictEqual(sim.clicks, 1);
  assert.ok(sim.gains.length > n0, 'wash nodes created');
  await sim.run(1);
  const send = sim.gains[sim.gains.length - 2];
  assert.strictEqual(+send.gain.value.toFixed(3), 0);
});

test('sim: wash allowed but the keys clash or are unknown -> no reverb', async () => {
  for (const tkB of [tkOf('3B', 90), undefined]) {
    const sim = createSim(
      base({
        settings: { transitionWash: true },
        index: {
          A: entry(D, 'decays', 95, { tk: tkOf('8B', 120) }),
          B: entry(120, 'fades', 110, { tk: tkB, h0: -40 }),
          C: entry(90, 'decays', 85),
        },
      }),
    );
    await sim.start(90);
    const n0 = sim.gains.length;
    await sim.run(6);
    assert.strictEqual(sim.clicks, 1);
    assert.strictEqual(sim.gains.length, n0, 'no wash nodes');
  }
});

test('sim: the pair sets the modifiers — tempo far and keys clash: 0.6 s later, the next track fades in over 0.3 s', async () => {
  const sim = createSim(
    base({
      index: {
        A: entry(D, 'decays', 95, { tk: tkOf('8B', 120) }),
        B: entry(120, 'fades', 110, { tk: tkOf('3B', 90) }),
        C: entry(90, 'decays', 85),
      },
    }),
  );
  await sim.start(90);
  await sim.run(5.15);
  assert.strictEqual(sim.clicks, 0);
  await sim.run(0.25);
  assert.strictEqual(sim.clicks, 0, 'no click at the plain point');
  await sim.run(0.5);
  assert.strictEqual(sim.clicks, 1);
  const snapA = sim.snapshots.filter((s) => s.videoId === 'A').pop();
  const p = A.sanitizeApplied(snapA!.applied)!.transition!.pair;
  assert.deepStrictEqual([p!.tempo, p!.key, p!.extraWaitSec], ['far', 'clash', 0.6]);
  assert.ok(p!.reasons.includes('contrast_pause'));
});

test('sim: a loud stop into a loud cut-in at the same tempo fades in over 0.1 s', async () => {
  const loudStop = entry(D, 'stop', 95, { tk: tkOf('8B', 120) });
  (loudStop.en as { endRelLu: number }).endRelLu = -1;
  const cutIn = entry(120, 'fades', 110, { tk: tkOf('8B', 120), fs: 0, fx: true, h0: -9, l: -10 });
  const sim = createSim(base({ index: { A: loudStop, B: cutIn, C: entry(90, 'decays', 85) } }));
  await sim.start(90);
  await sim.run(5.6);
  assert.strictEqual(sim.clicks, 1);
  const fi = sim.diag.filter((d) => d.kind === 'tr_fade_in').pop();
  assert.strictEqual(fi!.durSec, 0.1);
});

test('sim: abrupt ending into a contrasting next track gets a longer fade-out (within 2–4 s)', async () => {
  const cut = Object.assign(entry(D, 'abrupt', 99.0, { tk: tkOf('8B', 120) }), {});
  cut.en = { kind: 'abrupt', lastSoundSec: 99, silenceSec: 1, fadeSec: 2.5, endRelLu: -4 };
  const sim = createSim(
    base({ index: { A: cut, B: entry(120, 'fades', 110, { tk: tkOf('8B', 90) }), C: entry(90, 'decays', 85) } }),
  );
  await sim.start(85);
  await sim.run(1);
  const fo = sim.status.fade as { fadeOutStart: number; fadeOutEnd: number };
  assert.strictEqual(+(fo.fadeOutEnd - fo.fadeOutStart).toFixed(2), 3, 'tempo far: 2 + 1 s');
});

test('sim: the plan follows a change of the next track (reorder or the user) before anything is scheduled', async () => {
  const sim = createSim(
    base({
      index: {
        A: entry(D, 'decays', 95, { tk: tkOf('8B', 120) }),
        B: entry(120, 'fades', 110, { tk: tkOf('8B', 121) }),
        C: entry(90, 'decays', 85, { tk: tkOf('3B', 90) }),
      },
    }),
  );
  await sim.start(60);
  const transition = () => (sim.status.fade as TransitionStatus).transition;
  await sim.run(1);
  assert.strictEqual(transition().pair.extraWaitSec, 0);
  sim.queue = ['A', 'C', 'B'];
  sim.renderQueue();
  await sim.run(1.5);
  assert.strictEqual(transition().pair.extraWaitSec, 0.6);
  assert.strictEqual(transition().atSec, 95.8);
});
