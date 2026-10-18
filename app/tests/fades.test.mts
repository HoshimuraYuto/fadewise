import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';

const INTEGRATED = -10;

function tail(endPos: number, segments: [sec: number, lufsFrom: number, lufsTo: number][]) {
  const lufs: number[] = [];

  for (const [sec, a, b] of segments) {
    const n = Math.round(sec * 10);
    for (let i = 0; i < n; i++) lufs.push(Math.round((a + (b - a) * (n > 1 ? i / (n - 1) : 0)) * 10) / 10);
  }

  return { endPos, lufs };
}

const HEAD = {
  ad: false,
  adRecent: false,
  killed: false,
  paused: false,
  videoDuration: 200.1,
  playerDuration: 200,
  rate: 1,
};

test('head: first frame near 0 with matching durations is accepted, continuing frames too', () => {
  assert.strictEqual(A.headFrameDecision({ ...HEAD, ct: 0.1, prevCt: null }), 'accept');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, ct: 0.2, prevCt: 0.1, dt: 0.1 }), 'accept');
});

test('head: ads, frames right after an ad, and a duration mismatch are never accepted', () => {
  assert.strictEqual(A.headFrameDecision({ ...HEAD, ad: true, ct: 0.1, prevCt: null }), 'reject');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, adRecent: true, ct: 0.1, prevCt: null }), 'reject');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, videoDuration: 15, ct: 0.3, prevCt: 0.2, dt: 0.1 }), 'reject');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, videoDuration: 15, ct: 0.1, prevCt: null }), 'wait');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, videoDuration: NaN, ct: 0, prevCt: null }), 'wait');
});

test('head: a jump inside the head (seek) rejects; not starting at 0 or paused waits', () => {
  assert.strictEqual(A.headFrameDecision({ ...HEAD, ct: 30, prevCt: 0.3, dt: 0.1 }), 'reject');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, ct: 12, prevCt: null }), 'wait');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, paused: true, ct: 0, prevCt: null }), 'wait');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, ct: 0.4, prevCt: 0.4, dt: 0.1 }), 'wait');
  assert.strictEqual(A.headFrameDecision({ ...HEAD, killed: true, ct: 0.2, prevCt: 0.1, dt: 0.1 }), 'reject');
});

test('head: a run that starts at the head marks the first sound as exact even when sound starts at once', () => {
  const s = A.createSession('abcdefghijk', 30);
  for (let pos = 0.1; pos <= 5.01; pos += 0.1) A.addFrame(s, Math.round(pos * 10) / 10, A.lufsToEnergy(-10), 0.5);
  assert.deepStrictEqual(A.sessionSnapshot(s).firstSound, { pos: 0, exact: true });
  const late = A.createSession('abcdefghijk', 30);
  for (let pos = 1.1; pos <= 5.01; pos += 0.1) A.addFrame(late, Math.round(pos * 10) / 10, A.lufsToEnergy(-10), 0.5);
  assert.strictEqual(A.sessionSnapshot(late).firstSound!.exact, false);
});

test('ending: still loud when the file ends is abrupt, louder cut gets the longer fade', () => {
  const e = A.classifyEnding(tail(200, [[20, -9, -9]]), INTEGRATED, null, 200.05);
  assert.strictEqual(e.kind, 'abrupt');
  assert.ok(e.decaySec! <= 0.5, `decay ${e.decaySec}`);
  assert.strictEqual(e.fadeSec, 4);
  assert.ok(Math.abs(e.lastSoundSec! - 200) < 0.11, `last ${e.lastSoundSec}`);
  const quieter = A.classifyEnding(tail(200, [[20, -17, -17]]), INTEGRATED, null, 200.05);
  assert.strictEqual(quieter.kind, 'abrupt');
  assert.ok(quieter.fadeSec! >= 2 && quieter.fadeSec! < 4, `fade ${quieter.fadeSec}`);
  assert.strictEqual(
    A.classifyEnding(
      tail(200, [
        [19.8, -9, -9],
        [0.2, -99, -99],
      ]),
      INTEGRATED,
      null,
      200.05,
    ).kind,
    'abrupt',
  );
});

test("ending: a fast loud stop followed by silence inside the file is the track's own stop, no fade", () => {
  const e = A.classifyEnding(
    tail(200, [
      [18, -9, -9],
      [2, -99, -99],
    ]),
    INTEGRATED,
    null,
    200.5,
  );
  assert.strictEqual(e.kind, 'stop');
  assert.strictEqual(e.fadeSec, null);
  assert.ok(e.decaySec! <= 0.5 && e.silenceSec! > 0.3, JSON.stringify(e));
  assert.strictEqual(A.planFades({ l: INTEGRATED, en: e }, {}).fadeOut, null);
  assert.strictEqual(
    A.classifyEnding(
      tail(200, [
        [19.6, -9, -9],
        [0.4, -99, -99],
      ]),
      INTEGRATED,
      null,
      200.05,
    ).kind,
    'stop',
  );
  const noLen = A.classifyEnding(tail(200, [[20, -9, -9]]), INTEGRATED, null, null);
  assert.strictEqual(noLen.kind, 'unknown');
  assert.strictEqual(A.planFades({ l: INTEGRATED, en: noLen }, {}).fadeOut, null);
});

test('ending: a recorded fade-out (decays over seconds) is left alone', () => {
  const e = A.classifyEnding(
    tail(200, [
      [10, -10, -10],
      [8, -10, -60],
      [2, -99, -99],
    ]),
    INTEGRATED,
    null,
    200.3,
  );
  assert.strictEqual(e.kind, 'fades');
  assert.ok(e.decaySec! >= 3, `decay ${e.decaySec}`);
  const plan = A.planFades({ l: INTEGRATED, en: e }, {});
  assert.strictEqual(plan.fadeOut, null);
});

test('ending: a short ring-out (1-3 s) is neither cut nor fade and gets no fade', () => {
  const e = A.classifyEnding(
    tail(200, [
      [17, -10, -10],
      [1.5, -10, -55],
      [1.5, -99, -99],
    ]),
    INTEGRATED,
    null,
    200.2,
  );
  assert.strictEqual(e.kind, 'decays');
  assert.strictEqual(A.planFades({ l: INTEGRATED, en: e }, {}).fadeOut, null);
});

test('ending: long silence after the last sound is measured; skip only when enabled', () => {
  const e = A.classifyEnding(
    tail(240, [
      [10, -9, -9],
      [10, -99, -99],
    ]),
    INTEGRATED,
    229.9,
    240.4,
  );
  assert.strictEqual(e.kind, 'stop');
  assert.ok(e.silenceSec! >= 10 && e.silenceSec! < 11, `silence ${e.silenceSec}`);
  assert.strictEqual(A.planFades({ l: INTEGRATED, en: e }, { skipSilence: true }).fadeOut, null);
  assert.strictEqual(A.planFades({ l: INTEGRATED, en: e }, { skipSilence: false }).skipAtPos, null);
  const p = A.planFades({ l: INTEGRATED, en: e }, { skipSilence: true });
  assert.ok(p.skipAtPos! > e.lastSoundSec! && p.skipAtPos! < 240.4 - 5, `skip ${p.skipAtPos}`);
  const short = A.classifyEnding(
    tail(200, [
      [18, -9, -9],
      [2, -99, -99],
    ]),
    INTEGRATED,
    null,
    200.5,
  );
  assert.strictEqual(A.planFades({ l: INTEGRATED, en: short }, { skipSilence: true }).skipAtPos, null);
});

test('ending: too little contiguous audio before the end is "unknown"', () => {
  assert.strictEqual(
    A.classifyEnding(
      tail(200, [
        [3, -9, -9],
        [1, -99, -99],
      ]),
      INTEGRATED,
      null,
      200,
    ).kind,
    'unknown',
  );
  assert.strictEqual(A.classifyEnding(null, INTEGRATED, null, 200).kind, 'unknown');
  assert.strictEqual(A.classifyEnding(tail(200, [[20, -99, -99]]), INTEGRATED, null, 200).kind, 'unknown');
});

test('plan: no analysis means no fades at all', () => {
  const p = A.planFades(null, { skipSilence: true });
  assert.deepStrictEqual([p.fadeIn, p.fadeOut, p.skipAtPos, p.reason], [null, null, null, 'no_analysis']);
});

test('plan: abrupt ending fades to silence exactly at the last sound and restores right after', () => {
  const e = A.classifyEnding(tail(200, [[20, -9, -9]]), INTEGRATED, null, 200.05);
  const p = A.planFades({ l: INTEGRATED, en: e }, {});
  assert.ok(Math.abs(p.fadeOut!.endPos - e.lastSoundSec!) < 1e-9);
  assert.ok(Math.abs(p.fadeOut!.endPos - p.fadeOut!.startPos - e.fadeSec!) < 0.011);
  assert.ok(p.fadeOut!.restorePos > p.fadeOut!.endPos);
});

test('plan: short fade-in only for a loud start at 0 s (exact), never for quiet or late starts', () => {
  const loud = A.planFades({ l: INTEGRATED, c: 0.5, fs: 0, fx: true, h0: -9 }, {});
  assert.ok(loud.fadeIn && loud.fadeIn.durSec <= 0.2 && loud.fadeIn.fromDb >= -6, JSON.stringify(loud.fadeIn));
  assert.strictEqual(A.planFades({ l: INTEGRATED, c: 0.5, fs: 0, fx: false, h0: -9 }, {}).fadeIn, null);
  assert.strictEqual(A.planFades({ l: INTEGRATED, c: 0.5, fs: 1.2, fx: true, h0: -9 }, {}).fadeIn, null);
  assert.strictEqual(A.planFades({ l: INTEGRATED, c: 0.5, fs: 0, fx: true, h0: -20 }, {}).fadeIn, null);
});

test('plan: fade-in needs the integrated loudness from enough of the track (same coverage as the gain)', () => {
  const entry = { l: INTEGRATED, fs: 0, fx: true, h0: -9 };
  assert.strictEqual(A.planFades({ ...entry, c: 0.15 }, {}).fadeIn, null);
  assert.strictEqual(A.planFades({ ...entry, c: null }, {}).fadeIn, null);
  assert.strictEqual(A.planFades({ ...entry }, {}).fadeIn, null);
  assert.ok(A.planFades({ ...entry, c: A.MIN_COVERAGE_FOR_GAIN }, {}).fadeIn);
});

test('headProfile is floored so a digitally silent first second is a finite, very low value', () => {
  const r = A.deriveSummary({
    durationSec: 20,
    cells: [
      [0, 10, -450.14, null],
      [1, 10, -12, -3],
      [2, 2, -12, -3],
    ],
  });
  assert.strictEqual(r.headProfile[0], -99);
  assert.strictEqual(r.headProfile[1], -12);
  assert.strictEqual(r.headProfile[2], null);
  assert.strictEqual(A.planFades({ l: -10, c: 1, fs: 0, fx: true, h0: r.headProfile[0] }, {}).fadeIn, null);
});

test('fade times map song positions onto the AudioContext clock and refuse late starts', () => {
  const fo = { startPos: 196, endPos: 200, restorePos: 200.3 };
  const t = A.fadeOutTimes(fo, 190, 1000, 1);
  assert.deepStrictEqual([t!.startCtx, t!.endCtx], [1006, 1010]);
  assert.ok(Math.abs(t!.restoreCtx - 1010.3) < 1e-9);
  assert.strictEqual(A.fadeOutTimes(fo, 195.9, 1000, 1), null);
  assert.strictEqual(A.fadeOutTimes(fo, 198, 1000, 1), null);
  assert.strictEqual(A.fadeOutTimes(fo, 190, 1000, 2)!.startCtx, 1003);
});

test('merge keeps the ending of the last full listen and the index entry carries it', () => {
  const s = A.createSession('abcdefghijk', 30);
  let pos = 0;

  const add = (sec: number, lufs: number | null, peak: number) => {
    for (let i = 0; i < sec * 10; i++) {
      pos = Math.round((pos + 0.1) * 10) / 10;
      A.addFrame(s, pos, lufs === null ? 0 : A.lufsToEnergy(lufs), peak);
    }
  };

  add(30, -10, 0.5);
  A.markEnded(s, 30);
  const r = A.mergeRecord(null, A.sessionSnapshot(s), 1);
  assert.strictEqual(r.ending!.kind, 'abrupt');
  assert.strictEqual(r.tail!.lufs.length, 200);
  const entry = A.indexEntryOf(r);
  assert.strictEqual(entry!.en!.kind, 'abrupt');
  assert.strictEqual(entry!.fx, true);
  const s2 = A.createSession('abcdefghijk', 30);
  for (let p2 = 5.1; p2 <= 10; p2 += 0.1) A.addFrame(s2, Math.round(p2 * 10) / 10, A.lufsToEnergy(-10), 0.5);
  assert.strictEqual(A.mergeRecord(r, A.sessionSnapshot(s2), 2).ending!.kind, 'abrupt');
});
