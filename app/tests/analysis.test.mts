import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';

const eOf = (lufs: number) => A.lufsToEnergy(lufs);
const SIL = { e: 0, p: 0 };

function feed(s: A.Session, from: number, to: number, lufs: number | null, peak = 0) {
  for (let pos = from + 0.1; pos <= to + 1e-9; pos += 0.1) {
    A.addFrame(s, Math.round(pos * 10) / 10, lufs === null ? SIL.e : eOf(lufs), lufs === null ? 0 : peak);
  }
}

test('silence detection: first/last sound are exact when silence was observed around them', () => {
  const s = A.createSession('abcdefghijk', 30);
  feed(s, 0, 2, null);
  feed(s, 2, 27, -10, 0.5);
  feed(s, 27, 29.9, null);
  A.markEnded(s, 30);
  const snap = A.sessionSnapshot(s);
  assert.deepStrictEqual(snap.firstSound, { pos: 2, exact: true });
  assert.deepStrictEqual(snap.lastSound, { pos: 27, exact: true });
});

test('silence detection: sound right at the start of a run (after a seek) is only an upper bound', () => {
  const s = A.createSession('abcdefghijk', 30);
  feed(s, 10, 12, -10, 0.5);
  const snap = A.sessionSnapshot(s);
  assert.strictEqual(snap.firstSound!.exact, false);
  assert.strictEqual(snap.lastSound, null);
});

test('-60 dBFS threshold: peaks below it count as silence', () => {
  const s = A.createSession('abcdefghijk', 10);
  feed(s, 0, 1, -80, Math.pow(10, -61 / 20));
  feed(s, 1, 3, -20, Math.pow(10, -59 / 20));
  assert.strictEqual(A.sessionSnapshot(s).firstSound!.pos, 1);
});

test('session integrated loudness is gated over contiguous runs only', () => {
  const s = A.createSession('abcdefghijk', 120);
  feed(s, 0, 30, -12, 0.5);
  feed(s, 60, 90, -12, 0.5);
  assert.ok(Math.abs(A.sessionIntegratedLufs(s)! - -12) < 0.01);
});

test('partial listens merge: missing cells are filled, coverage grows, count increments per listen', () => {
  const s1 = A.createSession('abcdefghijk', 100);
  feed(s1, 0, 40, -10, 0.5);
  const r1 = A.mergeRecord(null, A.sessionSnapshot(s1, { title: 'T', artist: 'X' }), 1);
  assert.ok(Math.abs(r1.coverage! - 0.4) < 0.02);
  assert.strictEqual(r1.analysisCount, 1);
  const s2 = A.createSession('abcdefghijk', 100);
  feed(s2, 30, 100, -16, 0.5);
  A.markEnded(s2, 100);
  const r2 = A.mergeRecord(r1, A.sessionSnapshot(s2), 2);
  assert.ok(r2.coverage! >= 0.99, `coverage ${String(r2.coverage)}`);
  assert.strictEqual(r2.analysisCount, 2);
  assert.strictEqual(r2.title, 'T');
  const c35 = r2.cells.find((c) => c[0] === 35);
  const expect = A.energyToLufs((eOf(-10) * 10 + eOf(-16) * 10) / 20);
  assert.ok(Math.abs(c35![2]! - expect) < 0.02);
  assert.strictEqual(r2.lastSoundSec, 100);
  assert.strictEqual(r2.headProfile.length, 15);
  assert.strictEqual(r2.tailProfile.length, 15);
});

test('re-snapshotting the same listen does not double count (merge is from the pre-listen base)', () => {
  const s = A.createSession('abcdefghijk', 60);
  feed(s, 0, 20, -10, 0.5);
  const a = A.mergeRecord(null, A.sessionSnapshot(s), 1);
  feed(s, 20, 40, -10, 0.5);
  const b = A.mergeRecord(null, A.sessionSnapshot(s), 2);
  assert.strictEqual(b.analysisCount, 1);
  assert.ok(b.coverage! > a.coverage!);
});

test('records from another logic version are discarded on merge', () => {
  const s = A.createSession('abcdefghijk', 10);
  feed(s, 0, 5, -10, 0.5);
  const old = Object.assign(A.emptyRecord('abcdefghijk'), {
    logicVersion: 0,
    analysisCount: 9,
    cells: [[0, 10, -40, -1]],
  });
  const r = A.mergeRecord(old, A.sessionSnapshot(s), 1);
  assert.strictEqual(r.analysisCount, 1);
  assert.ok(Math.abs(r.cells[0][2]! - -10) < 0.01);
});

test('gain: loud track (YouTube already attenuates) is not cut twice', () => {
  const g = A.computeGain({ pLd: -5.4, ytTarget: -7, targetLufs: -10 });
  assert.strictEqual(g.source, 'youtube');
  assert.strictEqual(g.gainDb, -3);
});

test('gain: quiet track gets no boost without a measured peak, capped boost with headroom', () => {
  assert.strictEqual(A.computeGain({ pLd: -18, ytTarget: -7, targetLufs: -10 }).gainDb, 0);
  const g = A.computeGain({
    ownLufs: -18,
    ownCoverage: 0.8,
    peakDb: -6,
    pLd: -18,
    ytTarget: -7,
    targetLufs: -10,
    maxBoostDb: 6,
  });
  assert.strictEqual(g.source, 'analysis');
  assert.strictEqual(g.gainDb, 5);
});

test('gain: own analysis wins over YouTube value only with enough coverage', () => {
  assert.strictEqual(A.computeGain({ ownLufs: -6, ownCoverage: 0.1, pLd: -9, targetLufs: -10 }).source, 'youtube');
  assert.strictEqual(A.computeGain({ ownLufs: -6, ownCoverage: 0.5, pLd: -9, targetLufs: -10 }).source, 'analysis');
  assert.deepStrictEqual(A.computeGain({}).gainDb, 0);
});

test('dbToLinear is clamped', () => {
  assert.strictEqual(A.dbToLinear(100), 2);
  assert.strictEqual(A.dbToLinear(-100), 0.0625);
  assert.strictEqual(A.dbToLinear(NaN), 1);
});

test('track title/artist come from the player video data of the same videoId only', () => {
  assert.deepStrictEqual(
    A.pickTrackMeta({ video_id: 'abcdefghijk', title: ' Song ', author: 'Artist' }, 'abcdefghijk'),
    { title: 'Song', artist: 'Artist' },
  );
  assert.strictEqual(A.pickTrackMeta({ video_id: 'zzzzzzzzzzz', title: 'Other' }, 'abcdefghijk'), null);
  assert.strictEqual(A.pickTrackMeta({ video_id: 'abcdefghijk', title: '' }, 'abcdefghijk'), null);
  assert.strictEqual(A.pickTrackMeta(null, 'abcdefghijk'), null);
  assert.deepStrictEqual(A.pickTrackMeta({ video_id: 'abcdefghijk', title: 'Song' }, 'abcdefghijk'), {
    title: 'Song',
    artist: null,
  });
});
