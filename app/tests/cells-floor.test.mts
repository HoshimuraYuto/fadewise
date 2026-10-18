import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import type { Cell, IndexEntry } from '../shared/types.mts';

const eOf = (lufs: number) => A.lufsToEnergy(lufs);

function feed(s: A.Session, from: number, to: number, lufs: number, peak: number) {
  for (let pos = from + 0.1; pos <= to + 1e-9; pos += 0.1) A.addFrame(s, Math.round(pos * 10) / 10, eOf(lufs), peak);
}

function oldRecord() {
  const cells: Cell[] = [];
  for (let i = 0; i < 170; i++) cells.push([i, 10, -9 - (i % 7) * 0.3, -1.5]);
  for (let i = 170; i < 175; i++) cells.push([i, 10, -40 - (i - 170) * 10, -30]);
  for (let i = 175; i < 180; i++) cells.push([i, 10, -750 + i, -380.2]);
  const r = Object.assign(A.emptyRecord('abcdefghijk'), {
    durationSec: 180,
    cells,
    lastSoundSec: 174.5,
    tail: { endPos: 180, lufs: Array.from({ length: 200 }, (_, k) => (k < 150 ? -9 : -99)) },
  });
  Object.assign(r, A.deriveSummary(r));
  r.ending = A.classifyEnding(r.tail, r.integratedLufs, r.lastSoundSec, r.durationSec);

  return r;
}

test('floorCells: only values below -99 change, null and the other fields are kept', () => {
  const out = A.floorCells([
    [0, 10, -750, -380.2],
    [1, 3, -20.5, -3],
    [2, 5, null, null],
    [3, 1, -99, -99.4, 'x'],
  ]);
  assert.deepStrictEqual(out, [
    [0, 10, -99, -99],
    [1, 3, -20.5, -3],
    [2, 5, null, null],
    [3, 1, -99, -99, 'x'],
  ]);
  assert.strictEqual(A.floorCells<Cell[] | undefined>(undefined), undefined);
  assert.strictEqual(A.FRAME_FLOOR_LUFS, -99);
});

test('snapshot: a near-silent cell is stored at -99, not at its raw value', () => {
  const s = A.createSession('abcdefghijk', 20);
  feed(s, 0, 10, -12, 0.5);
  feed(s, 10, 12, -700, Math.pow(10, -400 / 20));
  const cells = A.sessionSnapshot(s).cells;
  const low = cells.filter((c) => c[0] >= 11);
  assert.ok(low.length >= 1);

  for (const c of low) {
    assert.strictEqual(c[2], -99);
    assert.strictEqual(c[3], -99);
  }

  assert.ok(cells.every((c) => c[2] === null || c[2] >= -99));
});

test('merge of an old record with -750 cells: floored, and every decision is the same as before', () => {
  const r = oldRecord();
  const floored = Object.assign({}, r, { cells: A.floorCells(r.cells) });
  assert.ok(r.cells.some((c) => c[2]! < -99));
  assert.ok(floored.cells.every((c) => c[2]! >= -99 && c[3]! >= -99));
  const a = A.deriveSummary(r),
    b = A.deriveSummary(floored);
  assert.deepStrictEqual(b, a);
  const ia = A.indexEntryOf(r),
    ib = A.indexEntryOf(floored);
  assert.deepStrictEqual(ib, ia);
  assert.deepStrictEqual(A.planFades(ib, {}), A.planFades(ia, {}));
  const g = (e: IndexEntry | null) =>
    A.computeGain({
      ownLufs: e!.l,
      ownCoverage: e!.c,
      peakDb: e!.p,
      pLd: -8,
      ytTarget: -7,
      targetLufs: -10,
      maxBoostDb: 6,
    });
  assert.deepStrictEqual(g(ib), g(ia));
  const s = A.createSession('abcdefghijk', 180);
  feed(s, 0, 30, -11, 0.6);
  const m1 = A.mergeRecord(r, A.sessionSnapshot(s), 5);
  const m2 = A.mergeRecord(floored, A.sessionSnapshot(s), 5);
  assert.ok(m1.cells.every((c) => c[2]! >= -99 && (c[3] === null || c[3] >= -99)));
  assert.deepStrictEqual(m1, m2);
});
