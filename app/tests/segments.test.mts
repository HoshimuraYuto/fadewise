import test from 'node:test';
import assert from 'node:assert/strict';
import * as TK from '../shared/tempo-key.mts';
import * as A from '../shared/analysis.mts';
import * as R from '../shared/reorder.mts';
import { loadFixtures } from './helpers/fixtures.mts';
import type { FixtureTrack } from './helpers/fixtures.mts';
import type { Ending, IndexEntry, SegmentVote, TempoKey } from '../shared/types.mts';

const FX = loadFixtures('real-tracks');
const EAR = loadFixtures('ear-checked');

const keyChroma = (tonic: number, mode: 'major' | 'minor', scale = 1) => {
  const p = TK.TEMPERLEY[mode];

  return Array.from({ length: 12 }, (_, i) => p[(i - tonic + 12) % 12] * scale);
};

const block = (i: number, frames: number, chroma: number[]) => [i, frames, ...chroma.map((c) => c * frames)];

const pulseFlux = (bpm: number, sec: number) => {
  const n = Math.round(sec * 100),
    p = 6000 / bpm,
    f = new Array<number>(n).fill(0.01);

  for (let t = 0; t < n; t += p) {
    const i = Math.round(t);
    if (i < n) f[i] = 1;
    if (i + 1 < n) f[i + 1] = 0.4;
  }

  return f;
};

test('segments: shared key / tempo logic; the full-confidence amount is the only difference', () => {
  const c = keyChroma(9, 'minor').map((v, i) => v + 0.05 * ((i * 7) % 5));
  assert.deepEqual(TK.summarizeKey(c, 600), TK.summarizeKey(c, 300, TK.SEG_KEY_FULL_FRAMES));
  assert.equal(TK.summarizeKey(c, 300)!.confidence, Math.round(TK.summarizeKey(c, 600)!.confidence * 50) / 100);
  const v = [
    [120, 30],
    [121, 30],
  ];
  assert.equal(TK.summarizeTempo(v)!.confidence, 0.5);
  assert.equal(TK.summarizeTempo(v, TK.SEG_TEMPO_FULL_SEC)!.confidence, 1);
});

test('segments: windows from the first / last sound; the duration stands in (approx) until the last sound is known', () => {
  assert.deepEqual(TK.segmentWindows({ firstSoundSec: 1.2, lastSoundSec: 200 }), {
    head: { from: 1.2, to: 31.2, at: 1.2, approx: false },
    tail: { from: 170, to: 200, at: 200, approx: false },
  });
  const w = TK.segmentWindows({ firstSoundSec: null, lastSoundSec: null, durationSec: 180 });
  assert.equal(w.head, null);
  assert.equal(w.tail!.approx, true);
});

test('segments: a modulation and a tempo change show at the edges; the stored segment holds numbers only', () => {
  const blocks = [];
  for (let i = 0; i < 36; i++) blocks.push(block(i, 45, i < 18 ? keyChroma(0, 'major') : keyChroma(2, 'major')));
  const listen = TK.analyseListen({
    segments: [{ start: 0, flux: pulseFlux(100, 90).concat(pulseFlux(130, 90)) }],
    chromaBlocks: blocks,
    chromaSum: new Array<number>(12).fill(1),
    chromaFrames: 1620,
  });
  const tk = TK.mergeTempoKey(null, listen, 1, { firstSoundSec: 0, lastSoundSec: 180, durationSec: 181 });
  assert.equal(tk.seg!.head!.key!.camelot, '8B');
  assert.equal(tk.seg!.tail!.key!.camelot, '10B');
  assert.ok(
    Math.abs(TK.tempoClass(tk.seg!.head!.tempo!.bpm) / TK.tempoClass(100) - 1) < 0.04,
    `head ${tk.seg!.head!.tempo!.bpm}`,
  );
  assert.ok(
    Math.abs(TK.tempoClass(tk.seg!.tail!.tempo!.bpm) / TK.tempoClass(130) - 1) < 0.04,
    `tail ${tk.seg!.tail!.tempo!.bpm}`,
  );
  const json = JSON.stringify(tk);
  assert.ok(!/flux|chromaBlocks|"segments"/.test(json), 'no feature sequences stored');
  assert.ok(JSON.stringify(tk.seg).length < 1200, `seg ${JSON.stringify(tk.seg).length} bytes`);
  assert.equal(tk.logicVersion, TK.TEMPO_LOGIC_VERSION);
  const e = TK.edgeOf(tk, 'tail');
  assert.equal(e.cam, '10B');
  assert.equal(e.src.key, 'segment');
});

test('segments: listens add up while the anchor stays; a moved anchor or an exact tail after an approximate one restarts', () => {
  const l = (at: number, approx: boolean, cf: number) => ({
    head: null,
    tail: { at, approx, votes: [[120, 22, 5] as SegmentVote], cs: keyChroma(0, 'major', cf), cf },
  });
  let s = TK.mergeSegments(null, l(200, false, 100));
  s = TK.mergeSegments(s, l(201, false, 100));
  assert.equal(s.tail!.cf, 200);
  assert.equal(TK.mergeSegments(s, l(210, false, 100)).tail!.cf, 100);
  const a = TK.mergeSegments(TK.mergeSegments(null, l(203, true, 100)), l(200, false, 100));
  assert.equal(a.tail!.cf, 100);
  assert.equal(a.tail!.approx, false);
});

test('segments: a record stored before segments (no seg, no anchors) keeps working and gains segments on the next listen', () => {
  const old = {
    logicVersion: 1,
    votes: [[120, 30, null]],
    chromaSum: keyChroma(0, 'major', 600),
    chromaFrames: 600,
    listens: 2,
    tempo: { bpm: 120, confidence: 0.6 },
    key: { name: 'C', camelot: '8B', confidence: 0.4 },
  } as unknown as TempoKey;
  const p = TK.pageTempoKey(old);
  assert.equal(p!.edges!.head.src.key, 'track');
  assert.equal(p!.edges!.head.cam, '8B');
  assert.equal(p!.edges!.tail.bc, 0.3);
  const plain = TK.mergeTempoKey(
    old,
    TK.analyseListen({ segments: [], chromaSum: keyChroma(0, 'major', 100), chromaFrames: 100 }),
    2,
    { firstSoundSec: 0, lastSoundSec: 180 },
  );
  assert.equal(plain.seg, undefined);
  assert.equal(plain.chromaFrames, 700);
  const blocks = Array.from({ length: 36 }, (_, i) => block(i, 45, keyChroma(0, 'major')));
  const next = TK.mergeTempoKey(
    old,
    TK.analyseListen({
      segments: [],
      chromaBlocks: blocks,
      chromaSum: keyChroma(0, 'major', 1620),
      chromaFrames: 1620,
    }),
    3,
    { firstSoundSec: 0, lastSoundSec: 180 },
  );
  assert.equal(next.seg!.v, TK.SEG_LOGIC_VERSION);
  assert.equal(next.seg!.tail!.key!.camelot, '8B');
  assert.equal(
    TK.edgeOf(Object.assign({}, old, { seg: { v: 99, head: { cs: keyChroma(2, 'major', 300), cf: 300 } } }), 'head').src
      .key,
    'track',
  );
  assert.equal(
    TK.analyseListen({
      chromaBlocks: [
        [0, 5, 'x'],
        [1.5, 5, ...new Array<number>(12).fill(1)],
        [-1, 5, ...new Array<number>(12).fill(1)],
        [2, 5, ...new Array<number>(12).fill(1)],
      ],
    }).chromaBlocks.length,
    1,
  );
});

test('segments: a failure in the segment part keeps the stored segments and the whole-track values', () => {
  const old = {
    logicVersion: 1,
    votes: [],
    chromaSum: keyChroma(0, 'major', 600),
    chromaFrames: 600,
    listens: 1,
    tempo: null,
    seg: { v: 1, head: { at: 0, approx: false, votes: [], cs: keyChroma(0, 'major', 10), cf: 10 }, tail: null },
  };
  const listen = TK.analyseListen({
    chromaBlocks: [[0, 5, ...new Array<number>(12).fill(1)]],
    chromaSum: new Array<number>(12).fill(1),
    chromaFrames: 5,
  });
  const bad = {
    get firstSoundSec() {
      throw new Error('boom');
    },
  };
  const r = TK.mergeTempoKey(old, listen, 1, bad as unknown as TK.SegmentAnchors);
  assert.deepEqual(r.seg, old.seg);
  assert.equal(r.chromaFrames, 605);
});

const edge = (cam: string, bpm: number, conf = 0.9) => ({
  bpm,
  bc: conf,
  cam,
  kc: conf,
  fc: conf,
  rel: [],
  src: { key: 'segment', tempo: 'segment' },
  chg: { key: false, tempo: false },
});
type Edge = ReturnType<typeof edge>;
const S = (
  id: string,
  tail: Edge | null,
  head?: Edge | null,
  en?: Partial<Ending> | null,
  extra?: Partial<IndexEntry>,
) =>
  R.summaryOf(
    id,
    {
      bpm: (tail || head)?.bpm ?? null,
      bc: 0.9,
      cam: (tail || head)?.cam ?? null,
      kc: 0.9,
      fc: 0.9,
      rel: [],
      head,
      tail,
    },
    Object.assign({ en: en || null, fs: 0.5, fx: true, h0: -12, l: -9, c: 0.8 }, extra || {}),
  );

test('choice: unknown pair values change nothing (plan with default modifiers); kinds stay with the ending', () => {
  const r = R.chooseTransition(S('a', null, null, { kind: 'abrupt', fadeSec: 2.5 }), null, { washAllowed: true });
  assert.deepEqual([r.fadeOutSec, r.wash, r.extraWaitSec, r.fadeInSec], [null, false, 0, 0.3]);
  const u = R.chooseTransition(
    R.summaryOf('a', null, { en: { kind: 'abrupt', fadeSec: 2.5 } }),
    R.summaryOf('b', null, {}),
    { washAllowed: true },
  );
  assert.deepEqual([u.fadeOutSec, u.wash, u.extraWaitSec, u.fadeInSec], [2.5, false, 0, 0.3]);
  const e = A.indexEntryOf(null);
  assert.equal(A.planTransition(e, { enabled: true, pair: u }).kind, 'none');
});

test('choice: fade 2–4 s with contrast; wash only with agreeing keys and never after a stop / fade-out; pause on double contrast; punch-in', () => {
  const ab = { kind: 'abrupt' as const, fadeSec: 2.5, endRelLu: -2 };
  const o = { washAllowed: true };
  assert.equal(R.chooseTransition(S('a', edge('8B', 120), null, ab), S('b', null, edge('8B', 120)), o).fadeOutSec, 2.5);
  assert.equal(R.chooseTransition(S('a', edge('8B', 120), null, ab), S('b', null, edge('8B', 90)), o).fadeOutSec, 3);
  const both = R.chooseTransition(S('a', edge('8B', 120), null, ab), S('b', null, edge('3B', 90)), o);
  assert.deepEqual([both.fadeOutSec, both.extraWaitSec, both.wash], [4, 0.6, false]);
  assert.equal(R.chooseTransition(S('a', edge('8B', 120), null, ab), S('b', null, edge('9B', 120)), o).wash, true);
  assert.equal(
    R.chooseTransition(S('a', edge('8B', 120), null, { kind: 'stop' }), S('b', null, edge('8B', 120)), o).wash,
    false,
  );
  assert.equal(
    R.chooseTransition(S('a', edge('8B', 120), null, { kind: 'fades' }), S('b', null, edge('8B', 120)), o).wash,
    false,
  );
  assert.equal(
    R.chooseTransition(S('a', edge('8B', 120), null, ab), S('b', null, edge('9B', 120))).wash,
    false,
    'not allowed by the setting',
  );
  const stop = R.chooseTransition(S('a', edge('8B', 120), null, { kind: 'stop' }), S('b', null, edge('3B', 90)), o);
  assert.equal(stop.extraWaitSec, 0, 'a stop is its own pause');
  const cutIn = S('b', null, edge('8B', 120), null, { fs: 0, h0: -8, l: -9 });
  assert.equal(R.chooseTransition(S('a', edge('8B', 120), null, { kind: 'stop', endRelLu: -1 }), cutIn).fadeInSec, 0.1);
  assert.equal(R.chooseTransition(S('a', edge('8B', 120), null, { kind: 'stop', endRelLu: -6 }), cutIn).fadeInSec, 0.3);
});

test('choice: planTransition adds the pause only when silence is left; planFades takes the longer fade inside 2–4 s', () => {
  const pair = {
    extraWaitSec: 0.6,
    fadeInSec: 0.3,
    wash: false,
    reasons: ['contrast_pause'],
    relation: { tempo: 'far', key: 'clash' },
  };
  const e = { d: 100, en: { kind: 'decays' as const, lastSoundSec: 95 } };
  const p = A.planTransition(e, { enabled: true, pair });
  assert.deepEqual([p.advanceAtPos, p.skipSec, p.pair!.extraWaitSec], [95.8, 4.2, 0.6]);
  const tight = A.planTransition(
    { d: 95.6, en: { kind: 'decays' as const, lastSoundSec: 95 } },
    { enabled: true, pair },
  );
  assert.deepEqual([tight.advanceAtPos, tight.pair!.extraWaitSec], [95.2, 0]);
  const ab = { d: 200, en: { kind: 'abrupt' as const, fadeSec: 2.5, lastSoundSec: 199.9 } };
  const f = A.planFades(ab, { beatAlign: false, fadeOutSec: 6 });
  assert.equal(+(f.fadeOut!.endPos - f.fadeOut!.startPos).toFixed(2), 4);
  assert.equal(
    +(
      A.planFades(ab, { beatAlign: false }).fadeOut!.endPos - A.planFades(ab, { beatAlign: false }).fadeOut!.startPos
    ).toFixed(2),
    2.5,
  );
});

test('ordering: the score reads the outgoing tail and the incoming head (a modulating track is placed by where it ends)', () => {
  const A1 = S('A', edge('10B', 120), edge('8B', 120), { kind: 'decays' });
  const B = S('B', edge('10B', 120), edge('10B', 120));
  const C = S('C', edge('8B', 120), edge('8B', 120));
  assert.ok(R.transitionScore(A1, B) > R.transitionScore(A1, C));
  const half = S('H', edge('8B', 120, 0.3), edge('8B', 120));
  assert.equal(R.isMovable(half), false);
  assert.equal(R.isMovable(R.summaryOf('W', { bpm: 120, bc: 0.9, cam: '8B', kc: 0.9, fc: 0.9, rel: [] })), true);
  const trackOnly = {
    bpm: 120,
    bc: 0.45,
    cam: '8B',
    kc: 0.45,
    fc: 0.45,
    rel: [],
    src: { key: 'track', tempo: 'track' },
    chg: { key: false, tempo: false },
  };
  assert.equal(
    R.isMovable(
      R.summaryOf('T', { bpm: 120, bc: 0.9, cam: '8B', kc: 0.9, fc: 0.9, rel: [], head: trackOnly, tail: trackOnly }),
    ),
    true,
  );
});

function replay(t: FixtureTrack) {
  const L = t.tail.lufs,
    n = L.length,
    st = A.liveGapState();

  for (let i = 0; i < n; i++) {
    const ct = t.tail.endPos - (n - 1 - i) * 0.1;

    if (
      A.liveGapStep(st, {
        ct,
        lufs: L[i],
        duration: t.durationSec,
        contiguous: true,
        sessionLufs: t.integratedLufs,
      }) === 'advance'
    ) {
      let cut = 0;
      for (let k = i + 1; k < n; k++) if (L[k] > t.integratedLufs - 42) cut++;

      return { at: ct, cut };
    }
  }

  return null;
}

test('live gap: on 42 stored real tracks it never cuts sound above I - 42 LU, and never fires in the first ~8 s', () => {
  const tracks = FX.tracks.concat(EAR.tracks);
  const fired = tracks.map((t) => [t.label, replay(t)] as const).filter(([, r]) => r);
  for (const [label, r] of fired) assert.equal(r!.cut, 0, label);
  assert.ok(fired.length >= 15, `fired on ${fired.length}`);

  for (const t of FX.tracks) {
    const st = A.liveGapState();
    for (const f of t.head.frames as { ct: number; lufs: unknown }[])
      if (typeof f.lufs === 'number')
        assert.notEqual(
          A.liveGapStep(st, { ct: f.ct, lufs: f.lufs, duration: t.durationSec, contiguous: true, sessionLufs: null }),
          'advance',
          t.label,
        );
  }
});

test('live gap: rules — sound first, contiguous frames, last 3 s only, a break re-arms nothing', () => {
  const run = (frames: [number, number, boolean?][], d = 100) => {
    const st = A.liveGapState();
    const out: string[] = [];
    for (const [ct, lufs, contiguous = true] of frames)
      out.push(A.liveGapStep(st, { ct, lufs, duration: d, contiguous, sessionLufs: -10 }));

    return out;
  };

  const seq = (from: number, to: number, lufs: number) => {
    const f: [number, number, boolean?][] = [];
    for (let x = from; x < to - 1e-9; x += 0.1) f.push([+x.toFixed(2), lufs]);

    return f;
  };

  const r = run(seq(90, 96, -12).concat(seq(96, 98, -80)));
  assert.equal(r.indexOf('arm'), 60);
  assert.equal(r.indexOf('advance'), 70);
  assert.ok(!run(seq(96, 99.5, -80)).includes('advance'));
  const g = seq(90, 96, -12)
    .concat(seq(96, 96.6, -80))
    .concat([[96.7, -80, false]])
    .concat(seq(96.8, 97.4, -80));
  assert.ok(!run(g).includes('advance'));
  assert.ok(!run(seq(90, 98.9, -12).concat(seq(98.9, 99.9, -80))).includes('advance'));
  assert.ok(!run(seq(10, 16, -12).concat(seq(16, 18, -80)), 20).includes('advance'));
  // -53 is above I - 42 LU (-56): not silence
  const st = A.liveGapState();
  for (const [ct, lufs] of seq(90, 96, -20).concat(seq(96, 98, -53)))
    assert.notEqual(A.liveGapStep(st, { ct, lufs, duration: 100, contiguous: true, sessionLufs: -14 }), 'advance');
});
