import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../shared/reorder.mts';
import * as A from '../shared/analysis.mts';
import * as TK from '../shared/tempo-key.mts';

const T = (id: string, bpm: number | null, cam: string | null, conf = 1, extra?: Partial<R.Summary>): R.Summary =>
  Object.assign(
    {
      id,
      bpm,
      bpmConf: conf,
      camelot: cam,
      keyConf: conf,
      famConf: conf,
      related: [],
      head: null,
      tail: null,
      en: null,
      fx: false,
    },
    extra || {},
  );

test('camelot parsing and the wheel used by shared/tempo-key.mts agree', () => {
  assert.deepEqual(R.parseCamelot('8A'), { n: 8, l: 'A' });
  assert.equal(R.parseCamelot('13A'), null);
  assert.equal(TK.camelot(0, 'major'), '8B');
  assert.equal(TK.camelot(9, 'minor'), '8A');
  assert.equal(TK.camelot(7, 'major'), '9B');
});

test('camelot compatibility: same, ±1, relative, diagonal, energy step, semitone, clash; symmetric', () => {
  assert.equal(R.camelotCompat('8A', '8A'), 1);
  assert.equal(R.camelotCompat('12B', '1B'), 0.9);
  assert.equal(R.camelotCompat('8A', '8B'), 0.85);
  assert.equal(R.camelotCompat('8A', '9B'), 0.55);
  assert.equal(R.camelotCompat('8A', '10A'), 0.45);
  assert.equal(R.camelotCompat('8A', '3A'), 0.3);
  assert.equal(R.camelotCompat('8A', '2B'), 0);
  assert.equal(R.camelotCompat('8A', null), null);
  for (const a of ['1A', '5B', '12A'])
    for (const b of ['3B', '12B', '6A']) assert.equal(R.camelotCompat(a, b), R.camelotCompat(b, a));
});

test('tempo distance treats double and half time as the same pulse', () => {
  assert.ok(R.tempoDistance(120, 240)! < 1e-12);
  assert.ok(Math.abs(R.tempoDistance(120, 126)! - 0.05) < 1e-9);
  assert.ok(R.tempoDistance(100, 150)! > 0.3);
  assert.equal(R.tempoCompat(120, 130), 0);
  assert.equal(R.tempoDistance(null, 120), null);
});

test('summaryOf reads the index entry numbers written by analysis.orderKeyOf (current key logic only)', () => {
  const tk = {
    logicVersion: 1,
    tempo: { bpm: 128, confidence: 0.8 },
    key: {
      v: 2,
      camelot: '5A',
      confidence: 0.4,
      familyConfidence: 0.7,
      related: [{ camelot: '6A' }, { camelot: '5B' }],
    },
  };
  const e = A.indexEntryOf({ durationSec: 200, tempoKey: tk });
  assert.deepEqual(e!.tk, { bpm: 128, bc: 0.8, cam: '5A', kc: 0.4, fc: 0.7, rel: ['6A', '5B'] });
  const s = R.summaryOf('x', e!.tk);
  assert.deepEqual(
    {
      id: s.id,
      bpm: s.bpm,
      bpmConf: s.bpmConf,
      camelot: s.camelot,
      keyConf: s.keyConf,
      famConf: s.famConf,
      related: s.related,
    },
    { id: 'x', bpm: 128, bpmConf: 0.8, camelot: '5A', keyConf: 0.4, famConf: 0.7, related: ['6A', '5B'] },
  );
  assert.equal(s.head, null, 'a record without segments has no edges (the whole-track values stand in)');
  assert.equal(s.tail, null);
  assert.equal(
    A.orderKeyOf({ logicVersion: 1, tempo: null, key: { camelot: '5A', confidence: 1 } }),
    null,
    'a v1 key is not used',
  );
  assert.equal(A.orderKeyOf(null), null);
  assert.equal(R.summaryOf('y', null).bpm, null);
});

test('movable: tempo sure, and the exact key sure or (family mode) its Camelot neighbourhood sure', () => {
  assert.equal(R.isMovable(T('a', 120, '8A', 0.6)), true);
  const fam = T('b', 120, '8A', 0.9, { keyConf: 0.3, famConf: 0.8, related: ['9A'] });
  assert.equal(R.isMovable(fam), true);
  assert.equal(R.isMovable(fam, { keyMode: 'exact' }), false);
  assert.equal(R.isMovable(T('c', 120, '8A', 0.9, { keyConf: 0.3, famConf: 0.4 })), false);
  assert.equal(R.isMovable(T('d', 120, '8A', 0.9, { bpmConf: 0.4 })), false);
  assert.equal(R.isMovable(R.summaryOf('e', null)), false);
});

test('family keys are scored by the worst pair of candidates (a neighbour must fit every plausible key)', () => {
  const cur = T('cur', 120, '8A');
  const famNear = T('f', 120, '8A', 1, { keyConf: 0.3, famConf: 1, related: ['9A'] });
  const famFar = T('g', 120, '8A', 1, { keyConf: 0.3, famConf: 1, related: ['3A'] });
  assert.ok(R.transitionScore(cur, famNear) > R.transitionScore(cur, famFar));
  assert.ok(Math.abs(R.transitionScore(cur, famNear) - (0.5 * 0.9 + 0.4 + 0.1 * 0.5)) < 1e-9);
  const ex = R.transitionScore(cur, famFar, { keyMode: 'exact' });
  assert.ok(Math.abs(ex - (0.5 * (0.3 * 1 + 0.7 * 0.5) + 0.4 + 0.05)) < 1e-9);
});

test('planReorder brings the harmonic / tempo neighbour forward and improves the chain', () => {
  const cur = T('cur', 120, '8A');
  const up = [T('far', 150, '2B'), T('x', 95, '4B'), T('near', 121, '9A'), T('y', 122, '10A')];
  const r = R.planReorder(cur, up);
  assert.equal(r.changed, true);
  assert.equal(r.order[0], 'near');
  assert.deepEqual([...r.order].sort(), up.map((t) => t.id).sort());
  assert.ok(
    R.chainScore(
      cur,
      r.order.map((id) => up.find((t) => t.id === id)!),
    ) > R.chainScore(cur, up),
  );
});

test('unanalysed, low-confidence and fixed (user-moved) tracks keep their slots', () => {
  const cur = T('cur', 120, '8A');
  const up = [
    T('bad', 150, '2B'),
    R.summaryOf('u1', null),
    T('good', 120, '8A'),
    T('weak', 120, '8A', 0.3),
    T('ok2', 121, '9A'),
    T('mine', 120, '8A'),
  ];
  const r = R.planReorder(cur, up, { fixed: new Set(['mine']) });
  assert.equal(r.order[1], 'u1');
  assert.equal(r.order[3], 'weak');
  assert.equal(r.order[5], 'mine');
  assert.equal(r.changed, true);
});

test('no change: fewer than two movable, already best, duplicates, small gain', () => {
  const cur = T('cur', 120, '8A');
  assert.equal(R.planReorder(cur, [T('a', 120, '8A'), { id: 'u' } as R.Summary]).reason, 'few_movable');
  assert.equal(R.planReorder(cur, [T('a', 120, '8A'), T('b', 121, '9A'), T('c', 122, '10A')]).reason, 'same');
  assert.equal(R.planReorder(cur, [T('a', 120, '8A'), T('a', 150, '2B'), T('b', 121, '9A')]).reason, 'duplicate');
  const r = R.planReorder(cur, [T('a', 120, '9A'), T('b', 120, '8A', 0.55)]);
  assert.ok(!r.changed);
});

test('lockNext keeps the next slot; displacement stays within maxShift; window limits the range', () => {
  const cur = T('cur', 120, '8A');
  assert.equal(
    R.planReorder(cur, [T('far', 150, '2B'), T('x', 95, '4B'), T('near', 121, '9A')], { lockNext: true }).order[0],
    'far',
  );
  const keys = ['1A', '7B', '3A', '9B', '5A', '11B', '2A', '8B', '4A', '10B', '6A', '12B'];
  const up = keys.map((k, i) => T('t' + i, 90 + ((i * 37) % 60), k));
  const r = R.planReorder(cur, up, { maxShift: 3, minGain: 0, minTotalGain: 0 });
  r.order.forEach((id, slot) => {
    assert.ok(Math.abs(+id.slice(1) - slot) <= 3, `${id} at ${slot}`);
  });
  const long = Array.from({ length: 30 }, (_, i) => T('t' + i, 100 + i, (i % 12) + 1 + 'A'));
  assert.equal(R.planReorder(cur, long, { window: 8 }).order.length, 8);
});

test('anchored to the source order: planning again on the reordered queue gives the same order (no drift)', () => {
  const keys = ['2B', '4B', '9A', '10A', '3A', '8B', '11A', '6B', '7A', '12B', '1A', '5B'];
  const up = keys.map((k, i) => T('t' + i, 100 + ((i * 13) % 40), k));
  const base = Object.fromEntries(up.map((t, i) => [t.id, i]));
  const cur = T('cur', 120, '8A');
  const r1 = R.planReorder(cur, up, { base });
  assert.equal(r1.changed, true);
  const re = r1.order.map((id) => up.find((t) => t.id === id)!);
  const r2 = R.planReorder(cur, re, { base });
  assert.equal(r2.changed, false);
  assert.equal(r2.reason, 'same');
  for (const [slot, id] of r1.order.entries()) assert.ok(Math.abs(base[id] - slot) <= R.DEFAULTS.maxShift);
});

test('movesFor reproduces the target with the minimum number of drags; applyMove follows it', () => {
  const from = ['a', 'b', 'c', 'd', 'e'];

  for (const to of [
    ['a', 'b', 'c', 'd', 'e'],
    ['b', 'a', 'c', 'd', 'e'],
    ['e', 'a', 'b', 'c', 'd'],
    ['a', 'c', 'e', 'b', 'd'],
    ['e', 'd', 'c', 'b', 'a'],
  ]) {
    let cur = from.slice();
    for (const m of R.movesFor(from, to)) cur = R.applyMove(cur, m);
    assert.deepEqual(cur, to);
  }

  assert.equal(R.movesFor(from, ['e', 'a', 'b', 'c', 'd']).length, 1);
  assert.equal(R.movesFor(from, ['e', 'd', 'c', 'b', 'a']).length, 4);
  assert.throws(() => R.movesFor(['a', 'b'], ['a', 'c']));
});

test('movedBetween: a track change or appended tracks are not moves; a dragged row and a "play next" copy are', () => {
  const q = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(R.movedBetween(q, q), []);
  assert.deepEqual(R.movedBetween(q, q.concat(['g', 'h'])), []);
  assert.deepEqual(R.movedBetween(q, ['b', 'c', 'd', 'e', 'f']), []); // radio drops played tracks
  assert.deepEqual(R.movedBetween(q, ['a', 'e', 'b', 'c', 'd', 'f']), ['e']);
  assert.deepEqual(R.movedBetween(q, ['a', 'b', 'f', 'c', 'd', 'e', 'f']).sort(), ['f']);
});

test('queue kind; albums only with their own setting', () => {
  assert.equal(R.queueKind('RDAMVMabcdefghijk', true), 'radio');
  assert.equal(R.queueKind('OLAK5uy_abcdefghijk', false), 'album');
  assert.equal(R.queueKind('PLabc', false), 'playlist');
  assert.equal(R.queueKind(null, false), 'unknown');
  assert.equal(R.kindAllowed('album', { reorderAlbums: false }), false);
  assert.equal(R.kindAllowed('album', { reorderAlbums: true }), true);
  assert.equal(R.kindAllowed('radio', {}), true);
  assert.equal(R.kindAllowed('unknown', { reorderAlbums: true }), false);
});

test('run record keeps numbers and known codes only, last 20', () => {
  const r = R.sanitizeRun({
    at: 5.4,
    kind: 'radio',
    result: 'done',
    reason: 'ok',
    method: 'drag',
    moved: 3,
    planned: 3,
    movable: 7,
    window: 12,
    gain: 0.41234,
    ms: 9000.4,
    title: 'secret',
    ids: ['abc'],
  });
  assert.deepEqual(r, {
    at: 5,
    kind: 'radio',
    result: 'done',
    reason: 'ok',
    method: 'drag',
    moved: 3,
    planned: 3,
    movable: 7,
    window: 12,
    gain: 0.412,
    ms: 9000,
  });
  assert.equal(R.sanitizeRun({ at: 1, reason: '<b>' })!.reason, null);
  assert.equal(R.sanitizeRun({}), null);
  let log: R.RunLogEntry[] | null = null;
  for (let i = 0; i < 25; i++) log = R.mergeRunLog(log, { at: i, result: 'skipped', reason: 'same' });
  assert.equal(log!.length, R.RUN_LOG_KEEP);
  assert.equal(log![0].at, 5);
});

test('defaults: threshold 0.5 (not lowered), family mode, at most 6 moves, frozen', () => {
  assert.ok(Object.isFrozen(R.DEFAULTS));
  assert.equal(R.DEFAULTS.minConf, 0.5);
  assert.equal(R.DEFAULTS.keyMode, 'family');
  assert.equal(R.DEFAULTS.maxMoves, 6);
  assert.equal(R.DEFAULTS.window, 12);
});
