import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import type { IndexEntry } from '../shared/types.mts';
import fixtures from './fixtures/real-tracks.json' with { type: 'json' };
import { createSim, entry } from './helpers/player-sim.mts';

const e = (fs: number, hq: number, d = 200): IndexEntry => ({ fs, fx: true, hq, d, l: -17 });

test('quietHeadSec: whole silent cells from 0, below both -70 LUFS and I - 42 LU', () => {
  assert.strictEqual(A.quietHeadSec([-99, -99, -30], -17), 2);
  assert.strictEqual(A.quietHeadSec([-99, null, -99], -17), 1);
  assert.strictEqual(A.quietHeadSec([-75, -99], -17), 2);
  assert.strictEqual(A.quietHeadSec([-69, -99], -17), 0);
  assert.strictEqual(A.quietHeadSec([-75, -99], -35), 0);
  assert.strictEqual(A.quietHeadSec([-80, -99], -35), 2);
  assert.strictEqual(A.quietHeadSec([-99], null), 0);
  assert.strictEqual(A.quietHeadSec([], -10), 0);
});

test('planHeadTrim: up to 6 s when the cells before the first sound are silent', () => {
  assert.deepStrictEqual(A.planHeadTrim(e(2.96, 2), 200.5), { seekTo: 2.71, why: 'exact_quiet' });
  assert.deepStrictEqual(A.planHeadTrim(e(4.57, 4), 200), { seekTo: 4.32, why: 'exact_quiet' });
  assert.deepStrictEqual(A.planHeadTrim(e(6, 6), 200), { seekTo: 5.75, why: 'exact_quiet' });
  assert.strictEqual(A.planHeadTrim(e(6.01, 6), 200).why, 'long');
  assert.strictEqual(A.planHeadTrim(e(2.96, 1), 200).why, 'long');
  assert.strictEqual(A.planHeadTrim({ fs: 2.96, fx: true, d: 200 }, 200).why, 'long');
  assert.strictEqual(A.planHeadTrim({ ...e(2.96, 2), fx: false }, 200).why, 'not_exact');
  assert.strictEqual(A.planHeadTrim(e(2.96, 2), 215).why, 'duration');
  assert.deepStrictEqual(A.planHeadTrim(e(2, 0), 200), { seekTo: 1.95, why: 'exact' });
  assert.deepStrictEqual(A.planHeadTrim(e(1.2, 0), 200), { seekTo: 1.15, why: 'exact' });
});

test('indexEntryOf carries hq from the stored head profile and loudness', () => {
  const rec = { firstSoundSec: 2.96, firstSoundExact: true, durationSec: 200, integratedLufs: -17.4 };
  assert.strictEqual(A.indexEntryOf({ ...rec, headProfile: [-99, -99, -99, -20] })!.hq, 3);
  assert.strictEqual(A.indexEntryOf({ ...rec, headProfile: [-99, -40] })!.hq, 1);
  assert.strictEqual(A.indexEntryOf(rec)!.hq, 0);
});

test('real fixtures: the long heads that are skipped land before their first sound', () => {
  const long: string[] = [];

  for (const t of fixtures.tracks) {
    const r = { ...t.head, durationSec: t.durationSec, integratedLufs: t.integratedLufs };
    const h = A.planHeadTrim(A.indexEntryOf(r), t.durationSec);
    if (h.seekTo === null) continue;
    assert.ok(h.seekTo < t.head.firstSoundSec - 0.04, t.label);
    if (h.why === 'exact_quiet') long.push(t.label);
  }

  assert.deepStrictEqual(long.sort(), ['ambient-1', 'classical-2']);
});

test('sim: an exact 2.96 s head over silent cells is sought to 2.71 s and faded in', async () => {
  const B = entry(120, 'fades', 110, { fs: 2.96, fx: true, hq: 2 });
  const sim = createSim({
    queue: ['A', 'B'],
    tracks: { A: { d: 100 }, B: { d: 120 } },
    index: { A: entry(100, 'decays', 95), B },
  });
  await sim.start(90);
  await sim.run(6);
  assert.strictEqual(sim.vid(), 'B');
  const trim = sim.diag.find((d) => d.kind === 'tr_head_trim');
  assert.ok(trim && trim.to === 2.71, JSON.stringify(trim));
  const fi = sim.diag.find((d) => d.kind === 'tr_fade_in');
  assert.ok(fi && fi.why === 'seeked' && Math.abs(fi.ct - 2.71) < 0.02, JSON.stringify(fi));
  const fade = sim.status.fade as { transition: { incoming: { headReason: string } } };
  assert.strictEqual(fade.transition.incoming.headReason, 'exact_quiet');
  assert.strictEqual(sim.fg(), 1);
});
