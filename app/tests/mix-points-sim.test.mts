import test from 'node:test';
import * as A from '../shared/analysis.mts';
import assert from 'node:assert';
import { createSim, entry, type Loose, type Sim, type SimOptions } from './helpers/player-sim.mts';

const mixA = {
  v: 1,
  g: [120, 1, 0.5],
  x: [
    [178, 4, 0.9, -1, 120, '8A'],
    [198, 3, 1, -14, 120, '8A'],
  ],
  n: [[0.5, 0, 1, -14, 120, '8A']],
  h: [1, 1, 0],
};
const mixB = {
  v: 1,
  g: [120, 1, 0.5],
  x: [[178, 3, 1, -14]],
  n: [
    [0.5, 0, 1, -14, 120, '8A'],
    [12, 1, 0.9, -1, 120, '8A'],
    [40, 2, 0.9, 1, 120, '8A'],
  ],
  h: [1, 1, 1],
};
const mixC = { v: 1, g: [120, 1, 0.5], x: [[178, 3, 1, -14]], n: [[0.5, 0, 1, -14, 120, '8A']], h: [1, 1, 0] };

const withMix = (e: Loose, m: Loose) => Object.assign(e, { mx: A.mixOf(m) });
const base = (over?: Partial<SimOptions>, settings?: Loose) =>
  Object.assign(
    {
      queue: ['A', 'B', 'C'],
      tracks: { A: { d: 200 }, B: { d: 180 }, C: { d: 180 } },
      index: {
        A: withMix(entry(200, 'fades', 198), mixA),
        B: withMix(entry(180, 'decays', 178), mixB),
        C: withMix(entry(180, 'decays', 178), mixC),
      },
      settings: Object.assign({ mixPoints: 'gentle' }, settings || {}),
    },
    over || {},
  );
const kinds = (sim: Sim, k: string) => sim.diag.filter((d) => d.kind === k);

test('sim gentle: "next" at the quiet-outro exit (faded), then a seek to the end of B\'s thin intro', async () => {
  const sim = createSim(base());
  await sim.start(125);
  await sim.run(45);
  const f = sim.status.fade;
  assert.strictEqual(f.transition.atSec, 178, 'advance moved to the exit');
  assert.deepStrictEqual([f.fadeOutStart, f.fadeOutEnd], [176, 178]);
  assert.deepStrictEqual([f.transition.mix.x.k, f.transition.mix.n.k, f.transition.mix.entry], ['fade', 'thin', true]);
  await sim.run(9);
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.vid(), 'B');
  const adv = kinds(sim, 'tr_advance')[0];
  assert.ok(Math.abs(adv.ct - 178) < 0.15, `advance at ${adv.ct}`);
  const me = kinds(sim, 'tr_mix_entry')[0];
  assert.ok(me && me.to === 12, 'seek to the entry');
  assert.ok(sim.ct() >= 12 && sim.ct() < 13.5, `B at ${sim.ct()}`);
  await sim.run(1);
  assert.strictEqual(sim.fg(), 1, 'faded in from the entry');
  const inc = sim.status.fade.transition.incoming;
  assert.deepStrictEqual([inc.headTrimTo, inc.headReason, inc.mix.k], [12, 'mix_thin', 'thin']);
  const snapA = sim.snapshots.filter((s) => s.videoId === 'A').pop();
  assert.deepStrictEqual(A.sanitizeApplied(snapA!.applied)!.transition!.mix, {
    mode: 'gentle',
    x: 'fade',
    n: 'thin',
    xSec: 178,
    nSec: 12,
  });
});

test('sim gentle never takes the lift; aggressive takes it (B entered at 40)', async () => {
  const sim = createSim(base(undefined, { mixPoints: 'aggressive' }));
  await sim.start(140);
  await sim.run(30);
  assert.ok(['thin', 'lift'].includes(sim.status.fade.transition.mix.n.k));
  const g = createSim(base());
  await g.start(140);
  await g.run(30);
  assert.notStrictEqual(g.status.fade.transition.mix.n.k, 'lift');
  const onlyLift = {
    v: 1,
    g: [120, 1, 0.5],
    x: [],
    n: [
      [0.5, 0, 1, -14, 120, '8A'],
      [40, 2, 0.9, -8, 120, '8A'],
    ],
    h: [1, 1, 1],
  };

  for (const [mode, want] of [
    ['aggressive', 'lift'],
    ['auto', 'lift'],
    ['gentle', 'first'],
  ]) {
    const s = createSim(
      base(
        { index: { A: withMix(entry(200, 'fades', 198), mixA), B: withMix(entry(180, 'decays', 178), onlyLift) } },
        { mixPoints: mode },
      ),
    );
    await s.start(140);
    await s.run(30);
    assert.strictEqual(s.status.fade.transition.mix.n.k, want, mode);
  }
});

test('sim: the pair follows the next track; a change before the window plans again, after it goes back to the plain end', async () => {
  const sim = createSim(base());
  await sim.start(100);
  assert.strictEqual(sim.status.fade.transition.mix.n.k, 'thin');
  sim.queue = ['A', 'C', 'B'];
  sim.renderQueue();
  await sim.run(1.5);
  assert.strictEqual(sim.status.fade.transition.mix.n.k, 'first', 'planned again for C');
  assert.strictEqual(sim.status.fade.transition.mix.entry, false);
  assert.ok(kinds(sim, 'mix_replan').length >= 1);
  const s2 = createSim(base());
  await s2.start(125);
  await s2.run(44);
  assert.strictEqual(s2.status.fade.transition.state, 'armed');
  s2.queue = ['A', 'C', 'B'];
  s2.renderQueue();
  await s2.run(1.5);
  assert.ok(kinds(s2, 'mix_cancel').length === 1, 'cancelled through the existing path');
  assert.strictEqual(s2.status.fade.transition.mix, null);
  assert.ok(Math.abs(s2.status.fade.transition.atSec - 198.2) < 0.01, 'back to the stored last sound');
  await s2.run(12);
  assert.strictEqual(s2.clicks, 0, 'not pressed at the old exit');
});

test('sim: an ad or a different track after the switch, a track left alone and first plays are not sought', async () => {
  const sim = createSim(base({ queue: ['A', 'C'] }));
  await sim.start(140);
  await sim.run(30);
  assert.deepStrictEqual([sim.status.fade.transition.mix.x.k, sim.status.fade.transition.mix.n.k], ['last', 'first']);
  await sim.run(30);
  assert.strictEqual(sim.vid(), 'C');
  assert.strictEqual(kinds(sim, 'tr_mix_entry').length, 0, 'C has no thin entry');
  const s2 = createSim(base());
  s2.send('excluded', ['B']);
  await s2.start(140);
  await s2.run(30);
  await s2.run(10);
  assert.strictEqual(kinds(s2, 'tr_mix_entry').length, 0, 'B left alone: no planned entry');
  const s3 = createSim(base({ index: { A: entry(200, 'fades', 198), B: withMix(entry(180, 'decays', 178), mixB) } }));
  await s3.start(140);
  await s3.run(30);
  assert.strictEqual(s3.status.fade.transition.mix, null, 'A has no stored candidates: as before');
  assert.ok(Math.abs(s3.status.fade.transition.atSec - 198.2) < 0.01);
  const s4 = createSim(base({ index: {} }));
  await s4.start(140);
  await s4.run(30);
  assert.ok(!s4.status.fade.transition.mix, 'first play: as before');
  assert.strictEqual(s4.status.fade.transition.kind, 'live_trim');
  const s5 = createSim(base());
  await s5.start(140);
  await s5.run(30);
  await s5.run(7.5);
  assert.strictEqual(s5.clicks, 0);
  s5.setAd(true);
  await s5.run(2);
  assert.strictEqual(kinds(s5, 'tr_mix_entry').length, 0, 'not during an ad');
});

test('sim: transitions off or fades off -> no mid-track exit without the overlap; overlap on -> exit with a 3 s equal-power lead', async () => {
  const off = createSim(base(undefined, { transitions: false }));
  await off.start(125);
  await off.run(45);
  assert.ok(!off.status.fade.transition || off.status.fade.transition.kind === 'none');
  const nf = createSim(base(undefined, { fadesEnabled: false }));
  await nf.start(125);
  await nf.run(45);
  assert.ok(
    Math.abs(nf.status.fade.transition.atSec - 198.2) < 0.01,
    'no cut inside the music without a fade or overlap',
  );
  const ov = createSim(base(undefined, { overlap: true }));
  await ov.start(125);
  await ov.run(35);
  assert.strictEqual(ov.status.fade.overlap.shape, 'equal');
  assert.strictEqual(ov.status.fade.overlap.overlapEndPos, 178);
  await ov.run(20);
  assert.strictEqual(ov.clicks, 1);
  const me = kinds(ov, 'tr_mix_entry')[0];
  assert.ok(me && me.overlap === true && me.to === 12, 'entry sought while the old remainder plays');
});

test('sim: the final snapshot carries the mix rows once (numbers only); frames at another rate are left out', async () => {
  const sim = createSim(base({ queue: ['C', 'B'], index: {} }));
  await sim.start(0);
  await sim.run(5);
  sim.setRate(2);
  await sim.run(1);
  sim.setRate(1);
  await sim.run(1);
  sim.load(1);
  await sim.run(0.5);
  const fin = sim.snapshots.filter((s) => s.videoId === 'C' && s.final);
  assert.strictEqual(fin.length >= 1, true);
  const withMx = sim.snapshots.filter((s) => s.mx);
  assert.strictEqual(withMx.length, 1);
  const rows = withMx[0].mx.f;
  assert.ok(rows.length > 40 && rows.every((r: number[]) => typeof r[0] === 'number' && typeof r[1] === 'number'));
  assert.ok(!rows.some((r: number[]) => r[0] > 5.3 && r[0] < 6.6), 'no rows while the rate was 2');
});
