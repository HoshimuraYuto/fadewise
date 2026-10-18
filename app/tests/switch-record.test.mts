import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import { switchesText } from '../ui/common.mts';
import { createSim, entry } from './helpers/player-sim.mts';

const plan: A.SwitchPlan = {
  kind: 'stop_wait',
  overlap: true,
  leadSec: 2.59,
  planLeadSec: 2.59,
  rate: 1.25,
  shape: 'segue',
  adapt: 'tempo_far',
  waitSec: 2.09,
  headSec: 2.96,
};

test('dip: the next first sound after the later of the old last sound and the end of the remainder', () => {
  const r = A.switchRecord(plan, -0.4);
  assert.deepStrictEqual([r.by, r.dipSec], ['ext', null]);
  assert.strictEqual(A.finishSwitch(r, 2.2, 2.5, null).dipSec, 0, 'the remainder still sounds: no dip');
  assert.strictEqual(A.finishSwitch(r, 2.2, 0.45, null).dipSec, 1.75);
  assert.strictEqual(A.finishSwitch(r, 3.35, null, null).dipSec, 3.75, 'no remainder: from the old last sound');
  assert.strictEqual(A.finishSwitch(r, null, 0.45, 'ad').dipSec, null, 'no first sound yet');
  const p = A.switchRecord(null, -1.12);
  assert.deepStrictEqual([p.by, p.overlap, p.leadSec], ['player', false, null]);
});

test('copy text: only known numbers and codes; titles, ids and unknown fields are dropped', () => {
  const r = Object.assign(A.finishSwitch(A.switchRecord(plan, -0.4), 2.2, 2.5, null), {
    title: 'Song',
    videoId: 'abcdefghijk',
    shape: 'Some Title',
  });
  const s = switchesText([r], '0.1.0');
  const o = JSON.parse(s) as { fadewise: string; switches: Record<string, unknown>[] };
  assert.strictEqual(o.fadewise, '0.1.0');
  assert.ok(!s.includes('Song') && !s.includes('abcdefghijk') && !s.includes('Title'), s);
  assert.deepStrictEqual([o.switches[0].shape, o.switches[0].dipSec, o.switches[0].waitSec], [null, 0, 2.09]);
  assert.strictEqual(switchesText([], '0.1.0'), '');
  assert.strictEqual(switchesText(null, '0.1.0'), '');
  const many = JSON.parse(switchesText(new Array(8).fill(r), 'x')) as { switches: unknown[] };
  assert.strictEqual(many.switches.length, 5);
});

test('sim: an overlapped switch leaves one record with the plan and the timing, numbers only', async () => {
  const sim = createSim({
    queue: ['A', 'B'],
    tracks: { A: { d: 200 }, B: { d: 120 } },
    settings: { overlap: true, overlapStyle: 'simple', leadRate: 1.25 },
    index: { A: entry(200, 'stop', 190), B: entry(120, 'fades', 110, { fs: 0.5, fx: true }) },
  });
  await sim.start(170);
  await sim.run(36);
  assert.strictEqual(sim.vid(), 'B');
  const list = (sim.status as { switches?: A.SwitchRecord[] }).switches;
  assert.ok(list && list.length === 1, JSON.stringify(list));
  const r = list[0];
  assert.deepStrictEqual([r.by, r.overlap, r.kind, r.shape], ['ext', true, 'stop_wait', 'segue']);
  assert.ok(r.leadSec! >= 2 && r.waitSec! > 0.9, JSON.stringify(r));
  assert.ok(!JSON.stringify(list).includes('"A"') && !JSON.stringify(list).includes('"B"'), 'no ids');
});
