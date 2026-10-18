import test from 'node:test';
import assert from 'node:assert';
import type { IndexEntry } from '../shared/types.mts';
import { createSim, entry, type Sim } from './helpers/player-sim.mts';

const D = 200;
const fades = (decay: number) =>
  Object.assign(entry(D, 'fades', 195), {
    en: { kind: 'fades', lastSoundSec: 195, silenceSec: 5, fadeSec: null, decaySec: decay, endRelLu: null },
  }) as IndexEntry;
const soft = { l: -10, c: 0.8, fs: 0.2, fx: true, h0: -25, d: 180 } as IndexEntry;

interface OvStatus {
  leadSec: number;
  rate: number;
}
const ovOf = (sim: Sim): OvStatus => (sim.status as { fade: { overlap: OvStatus } }).fade.overlap;
const cancels = (sim: Sim): [unknown, unknown][] =>
  sim.diag.filter((d) => d.kind === 'ov_cancel').map((d): [unknown, unknown] => [d.reason, d.was]);
const param = (sim: Sim, k: string) =>
  (sim.ov!.node as unknown as { parameters: { get: (k: string) => { value: number } } }).parameters.get(k).value;
const levels = (sim: Sim) => [
  +sim.gains[0].gain.value.toFixed(4),
  sim.fg(),
  +param(sim, 'gOld').toFixed(4),
  +param(sim, 'kB').toFixed(4),
];

const start = async (decay: number) => {
  const sim = createSim({
    queue: ['A', 'B'],
    tracks: { A: { d: D }, B: { d: 180 } },
    index: { A: fades(decay), B: soft },
    settings: { overlap: true, overlapStyle: 'simple', leadRate: 1.5, gainEnabled: true },
  });
  await sim.start(165);
  await sim.run(1);

  return sim;
};

// YTM sets the ad class first, then the rest follows
async function adFor(sim: Sim, sec: number) {
  const n = sim.rateLog.length;
  sim.setAd(true);
  sim.w.document.getElementById('movie_player')!.dispatchEvent(new sim.w.Event('x'));
  await sim.run(0.3);
  const rate0 = sim.rate(),
    pp0 = sim.pp(),
    lv0 = levels(sim);
  const seen: string[] = [];
  await sim.run(sec, (s) => {
    const lv = levels(s);
    if (s.rate() !== rate0 || s.pp() !== pp0 || lv.some((x, i) => x !== lv0[i]))
      seen.push(JSON.stringify([s.rate(), s.pp(), lv]));
  });
  assert.deepStrictEqual(seen, [], 'rate, preservesPitch and gains stay as they were while the ad shows');
  assert.ok(
    sim.rateLog.slice(n).every(([, , , ad]) => !ad),
    `no rate set while the ad shows ${JSON.stringify(sim.rateLog.slice(n))}`,
  );
  assert.ok(
    lv0.every((x) => x === 1),
    `unity during the ad ${JSON.stringify(lv0)}`,
  );
  sim.setAd(false);
  await sim.run(0.5);
}

for (const decay of [12, 16, 30]) {
  const lead = Math.min(10, decay / 2);
  test(`ad while running ahead at 1.5x (lead ${lead} s): cancelled, untouched during the ad, rate 1 after`, async () => {
    const sim = await start(decay);
    assert.deepStrictEqual([ovOf(sim).leadSec, ovOf(sim).rate], [lead, 1.5]);
    while (!(sim.ov!.mode === 'capture' && sim.ov!.lead >= lead / 2) && sim.ct() < 195) await sim.run(0.1);
    assert.strictEqual(sim.rate(), 1.5, 'running ahead');
    assert.strictEqual(sim.ov!.mode, 'capture');
    await adFor(sim, 3);
    assert.deepStrictEqual(cancels(sim), [['ad', 'capture']]);
    assert.strictEqual(sim.ov!.mode, 'pass');
    assert.deepStrictEqual(
      [sim.rate(), sim.pp()],
      [1, false],
      'rate 1, preservesPitch prearmed as before running ahead',
    );
    assert.ok(
      levels(sim).every((x) => x === 1),
      `gains back at unity ${JSON.stringify(levels(sim))}`,
    );
    const t0 = sim.ct();
    await sim.run(2);
    assert.ok(sim.ct() - t0 > 1.9 && sim.ct() - t0 < 2.1, `plays on at 1 (${sim.ct() - t0})`);
    await sim.run(Math.max(0, D - sim.ct()) + 3);
    assert.strictEqual(sim.vid(), 'B');
    assert.strictEqual(sim.rate(), 1);
    assert.strictEqual(sim.status.errors, 0);
  });

  test(`ad while the old remainder (${lead} s at 1.5x) plays over the next track: cancelled, untouched, rate 1 after`, async () => {
    const sim = await start(decay);
    while (sim.vid() === 'A' && sim.ct() < D) await sim.run(0.1);
    await sim.run(0.3);
    assert.strictEqual(sim.vid(), 'B');
    assert.strictEqual(sim.ov!.mode, 'drain');
    await sim.run(lead / 2);
    assert.strictEqual(sim.ov!.mode, 'drain', 'still overlapping');
    assert.ok(sim.ov!.lead > 1, `remainder left ${sim.ov!.lead}`);
    await adFor(sim, 3);
    assert.deepStrictEqual(cancels(sim), [['ad', 'drain']]);
    assert.strictEqual(sim.ov!.mode, 'pass');
    assert.deepStrictEqual([sim.rate(), sim.pp()], [1, false]);
    assert.ok(
      levels(sim).every((x) => x === 1),
      `gains back at unity ${JSON.stringify(levels(sim))}`,
    );
    const t0 = sim.ct();
    await sim.run(2);
    assert.ok(sim.ct() - t0 > 1.9 && sim.ct() - t0 < 2.1, `the next track plays at 1 (${sim.ct() - t0})`);
    assert.strictEqual(sim.status.errors, 0);
  });
}

for (const where of ['capture', 'drain'] as const)
  test(`ad while ${where === 'capture' ? 'running ahead' : 'the remainder plays'} with leveled tracks: the gain is 1 at once`, async () => {
    const sim = createSim({
      queue: ['A', 'B'],
      tracks: { A: { d: D }, B: { d: 180 } },
      index: { A: Object.assign({}, fades(16), { l: -6 }) as IndexEntry, B: Object.assign({}, soft, { l: -7 }) },
      settings: { overlap: true, overlapStyle: 'simple', leadRate: 1.5, gainEnabled: true },
    });
    await sim.start(165);
    await sim.run(1);

    if (where === 'capture')
      while (!(sim.ov!.mode === 'capture' && sim.ov!.lead >= 3) && sim.ct() < 195) await sim.run(0.1);
    else {
      while (sim.vid() === 'A' && sim.ct() < D) await sim.run(0.1);
      await sim.run(2);
    }

    assert.strictEqual(sim.ov!.mode, where);
    const g = () => +sim.gains[0].gain.value.toFixed(4);
    assert.ok(g() < 0.9, `leveled before the ad (${g()})`);
    sim.setAd(true);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // lets the class observer run without a clock step
    assert.strictEqual(g(), 1, 'unity at the ad start');
    const seen: number[] = [];
    await sim.run(1, () => seen.push(g()));
    assert.ok(
      seen.every((x) => x === 1),
      `unity through the ad ${JSON.stringify(seen)}`,
    );
    assert.deepStrictEqual(cancels(sim), [['ad', where]]);
    sim.setAd(false);
    await sim.run(1);
    assert.strictEqual(sim.rate(), 1);
  });

// YTM can load the ad as its own source, and the player itself resets the rate to 1
test('ad loaded as a source change while running ahead at 1.5x: no rate or preservesPitch set by the page during the ad', async () => {
  const sim = await start(20);
  while (!(sim.ov!.mode === 'capture' && sim.ov!.lead >= 3) && sim.ct() < 195) await sim.run(0.1);
  assert.strictEqual(sim.rate(), 1.5);
  const n = sim.rateLog.length;
  const ppBefore = sim.pp();
  sim.setAd(true);
  sim.reload();
  sim.setRate(1);
  const own = sim.rateLog.length;
  await sim.run(3);
  assert.deepStrictEqual(cancels(sim), [['ad', 'capture']]);
  assert.strictEqual(
    sim.rateLog.length,
    own,
    `the page set no rate during the ad ${JSON.stringify(sim.rateLog.slice(n))}`,
  );
  assert.strictEqual(sim.pp(), ppBefore, 'preservesPitch not touched during the ad');
  assert.ok(levels(sim).every((x) => x === 1));
  sim.setAd(false);
  await sim.run(0.5);
  assert.deepStrictEqual([sim.rate(), sim.ov!.mode], [1, 'pass']);
});
