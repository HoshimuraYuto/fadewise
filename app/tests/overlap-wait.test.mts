import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import * as R from '../shared/reorder.mts';
import type { IndexEntry } from '../shared/types.mts';
import { createSim, entry, type Loose } from './helpers/player-sim.mts';

const D = 200;
const next = (fs: number, fx = true) => ({ l: -10, c: 0.8, fs, fx, h0: -14, d: 180 }) as IndexEntry;
const tp = (e: IndexEntry, pair?: Loose | null) =>
  A.planTransition(e, { enabled: true, fadeOut: A.planFades(e).fadeOut, pair: pair || null, overlap: true });
const plan = (e: IndexEntry, n: IndexEntry | null, pair?: Loose | null) =>
  A.planOverlap(e, tp(e, pair), { enabled: true, next: n });

const tempoFar = () => {
  const edge = (bpm: number) => ({ bpm, bc: 0.9, cam: '8A', kc: 0.9, fc: 0.9, rel: [], src: {}, chg: {} });
  const ta = { bpm: 181, bc: 0.9, cam: '8A', kc: 0.9, fc: 0.9, rel: [], tail: edge(181) };
  const tb = { bpm: 120, bc: 0.9, cam: '8A', kc: 0.9, fc: 0.9, rel: [], head: edge(120) };
  const a = entry(D, 'stop', 190, { tk: ta }) as unknown as IndexEntry;
  const b = Object.assign(next(0.2), { tk: tb }) as unknown as IndexEntry;

  return R.chooseTransition(R.summaryOf('a', a.tk, a), R.summaryOf('b', b.tk, b), {});
};

test('wait: the load, a rushed head silence, and the silence the old track leaves before the advance', () => {
  const stop = entry(D, 'stop', 190) as IndexEntry;
  const p = tp(stop);
  assert.strictEqual(A.OVERLAP.loadSec, 0.8);
  assert.strictEqual(A.overlapWaitSec(next(0), p), 1.1);
  assert.strictEqual(A.overlapWaitSec(next(0.2), p), 1.3, 'under 0.25 s the head is played as it is');
  assert.strictEqual(A.overlapWaitSec(next(2.96), p), 2.29);
  assert.strictEqual(A.overlapWaitSec(next(1.2, false), p), 1.54, 'inexact: 0.4 s at 3x up to the sound, the gate');
  assert.strictEqual(A.overlapWaitSec(next(9.25), p), 5.39);
  assert.strictEqual(A.overlapWaitSec(next(2.96), p, true), 1.1, 'a planned entry is sought: no head');
  assert.strictEqual(A.overlapWaitSec(null, p), 1.1);
  const cut = entry(D, 'abrupt', 199.5) as IndexEntry;
  assert.strictEqual(A.overlapWaitSec(next(0), tp(cut)), 0.8);
});

test('halved pair: the lead is not cut below the wait plus half a second together', () => {
  const stop = entry(D, 'stop', 190) as IndexEntry;
  const far = tempoFar();
  const p = plan(stop, next(0.2), far);
  assert.deepStrictEqual([p.adapt!.why, p.adapt!.baseLeadSec, p.shape], ['tempo_far', 2, 'segue']);
  assert.deepStrictEqual([p.leadSec, p.basis!.waitSec, p.basis!.covered], [1.8, 1.3, true]);
  const q = plan(stop, next(2.96), far);
  assert.deepStrictEqual([q.leadSec, q.basis!.waitSec], [2.79, 2.29]);
  assert.ok(Math.abs(q.captureStartPos! - (q.advanceAtPos! - 2.79 * 5)) < 1e-9);
});

test('a lead already longer than the wait is left as it is', () => {
  const dec = entry(D, 'decays', 190) as IndexEntry;
  const p = plan(dec, next(0.5));
  assert.deepStrictEqual([p.leadSec, p.basis!.covered], [3, undefined]);
  assert.ok(p.basis!.waitSec! < 2.5);
  const shortT = Object.assign(entry(14, 'stop', 12), {}) as IndexEntry;
  const s = plan(shortT, next(9.25));
  assert.ok(!s.on || s.leadSec! <= A.overlapLeadFrom(A.OVERLAP.minStartSec, s.advanceAtPos, 1.25) + 1e-9);
});

test('sim: a stop with a long head silence on the next track runs ahead long enough and blends', async () => {
  const sim = createSim({
    queue: ['A', 'B'],
    tracks: { A: { d: D }, B: { d: 120 } },
    settings: { overlap: true, overlapStyle: 'simple', leadRate: 1.25 },
    index: { A: entry(D, 'stop', 190), B: entry(120, 'fades', 110, { fs: 2.96, fx: true }) },
  });
  await sim.start(170);
  await sim.run(2);
  const ov = (sim.status as { fade: { overlap: { leadSec: number; basis: A.OverlapBasis } } }).fade.overlap;
  assert.deepStrictEqual([ov.leadSec, ov.basis.waitSec, ov.basis.covered], [2.79, 2.29, true]);
  await sim.run(30);
  assert.strictEqual(sim.vid(), 'B');
  const dr = sim.ov!.posted.find((d) => d.ev === 'drain');
  assert.ok(dr && dr.leadOutSec > 2.6, `lead at the switch ${dr?.leadOutSec}`);
});
