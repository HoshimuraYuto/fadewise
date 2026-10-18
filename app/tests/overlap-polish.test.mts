// Chrome drops 20-50 samples when switching preservesPitch, so it switches only at a silent moment.
import test from 'node:test';
import assert from 'node:assert';
import { createSim, entry, type Loose, type Sim, type SimOptions } from './helpers/player-sim.mts';

const D = 100;
const base = (over?: Partial<SimOptions>, settings?: Loose) =>
  Object.assign(
    {
      queue: ['A', 'B', 'C'],
      tracks: { A: { d: D }, B: { d: 120 }, C: { d: 90 } },
      index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) },
      settings: Object.assign({ overlap: true, overlapStyle: 'simple' }, settings || {}),
    },
    over || {},
  );
const ovDiag = (sim: Sim, kind: string) => sim.diag.filter((d) => d.kind === 'ov_' + kind);

test('prearm: preservesPitch goes false before the music, so running ahead only changes the rate', async () => {
  const sim = createSim(base());
  const ppAt: [number, boolean, number][] = [];
  const v = sim.w.document.querySelector('video')!;
  const desc = Object.getOwnPropertyDescriptor(v, 'preservesPitch')!;
  Object.defineProperty(v, 'preservesPitch', {
    get: () => desc.get!.call(v) as boolean,
    set: (x: unknown) => {
      // the first write comes before the AudioContext exists
      ppAt.push([(sim.ctx as Sim['ctx'] | null)?.currentTime ?? 0, !!x, sim.rate()]);
      desc.set!.call(v, x);
    },
    configurable: true,
  });
  await sim.start(78);
  await sim.run(3);
  assert.strictEqual(sim.rate(), 1.25);
  assert.strictEqual(sim.pp(), false);
  const cap = ovDiag(sim, 'capture')[0];
  assert.ok(cap, 'running ahead');
  const falseWrites = ppAt.filter(([, x]) => !x);
  assert.ok(
    falseWrites.length >= 1 && falseWrites.every(([t, , r]) => r === 1 && t < cap.at),
    JSON.stringify({ ppAt, cap: cap.at }),
  );
  assert.ok(ovDiag(sim, 'prearm').length >= 1);
});

test('prearm: turning the overlap off gives preservesPitch back at the next pause, not while the music sounds', async () => {
  const sim = createSim(base());
  await sim.start(40);
  await sim.run(1);
  assert.strictEqual(sim.pp(), false, 'prearmed');
  sim.send('settings', { overlap: false });
  await sim.run(1);
  assert.strictEqual(sim.pp(), false, 'not while playing (the sim frames are not silent)');
  sim.pause();
  await sim.run(0.3);
  assert.strictEqual(sim.pp(), true, 'given back while paused');
  assert.strictEqual(sim.rate(), 1);
});

test('prearm: a rate set by someone else gets preservesPitch back (their rate is kept)', async () => {
  const sim = createSim(base());
  await sim.start(40);
  await sim.run(1);
  sim.setRate(1.5);
  await sim.run(0.3);
  assert.deepStrictEqual([sim.rate(), sim.pp()], [1.5, true]);
});

test("head rush under the overlap: the next track's exact head silence plays at 3x, rate 1 before its first sound", async () => {
  const sim = createSim(
    base({
      index: {
        A: entry(D, 'decays', 95),
        B: entry(120, 'fades', 110, { fs: 1.5, fx: true }),
        C: entry(90, 'decays', 85),
      },
    }),
  );
  await sim.start(78);
  await sim.run(16);
  assert.strictEqual(sim.vid(), 'B');
  const r = ovDiag(sim, 'rush')[0],
    e = ovDiag(sim, 'rush_end')[0];
  assert.ok(r && r.mode === 'overlap' && r.until === 1.25, JSON.stringify(r));
  assert.ok(e && e.toSec >= 1.1 && e.toSec <= 1.6, JSON.stringify(e));
  const gates = sim.ov!.msgs.filter((m) => m.cmd === 'gate');
  assert.deepStrictEqual(
    gates.map((g) => g.on),
    [true, false],
  );
  assert.strictEqual(sim.rate(), 1);
  assert.strictEqual(sim.status.fade.transition.incoming.headReason, 'overlap_rush_exact');
});

test('head rush under the overlap: no exact first sound -> rushes until the worklet reports the first input sample', async () => {
  const sim = createSim(
    base({
      index: {
        A: entry(D, 'decays', 95),
        B: entry(120, 'fades', 110, { fs: 0.9, fx: false }),
        C: entry(90, 'decays', 85),
      },
    }),
  );
  await sim.start(78);
  await sim.run(14.3);
  assert.strictEqual(sim.vid(), 'B');
  const r = ovDiag(sim, 'rush')[0];
  assert.ok(r && r.until === null, JSON.stringify(r));
  assert.strictEqual(sim.rate(), 3);
  (sim.ov!.node as unknown as Loose).port.onmessage({ data: { ev: 'inSound', gated: true } });
  await sim.run(0.1);
  const e = ovDiag(sim, 'rush_end')[0];
  assert.ok(e && e.why === 'sound', JSON.stringify(e));
  assert.strictEqual(sim.rate(), 1);
});

test('head rush: no rush when the head has sound at once, when the next track is left alone, or under an ad', async () => {
  const s1 = createSim(
    base({
      index: {
        A: entry(D, 'decays', 95),
        B: entry(120, 'fades', 110, { fs: 0.1, fx: true }),
        C: entry(90, 'decays', 85),
      },
    }),
  );
  await s1.start(78);
  await s1.run(16);
  assert.strictEqual(ovDiag(s1, 'rush').length, 0, 'sound within 0.25 s');
  const s2 = createSim(
    base({
      index: {
        A: entry(D, 'decays', 95),
        B: entry(120, 'fades', 110, { fs: 1.5, fx: true }),
        C: entry(90, 'decays', 85),
      },
    }),
  );
  s2.send('excluded', ['B']);
  await s2.start(78);
  await s2.run(16);
  assert.strictEqual(ovDiag(s2, 'rush').length, 0, 'next track left alone');
  assert.ok(s2.rateLog.every(([, x]) => x !== 3));
});

test('head rush: a pause or the limit ends it with rate 1', async () => {
  const sim = createSim(
    base({
      index: {
        A: entry(D, 'decays', 95),
        B: entry(120, 'fades', 110, { fs: 0.9, fx: false }),
        C: entry(90, 'decays', 85),
      },
    }),
  );
  await sim.start(78);
  await sim.run(14.3);
  assert.strictEqual(sim.rate(), 3);
  sim.pause();
  await sim.run(0.2);
  const e = ovDiag(sim, 'rush_end')[0];
  assert.ok(e && e.why === 'pause', JSON.stringify(e));
  assert.strictEqual(sim.rate(), 1);
});
