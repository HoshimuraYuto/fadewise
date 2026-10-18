import test from 'node:test';
import assert from 'node:assert';
import * as TK from '../shared/tempo-key.mts';
import * as A from '../shared/analysis.mts';
import { indexEntry } from '../content/bridge.mts';
import type { BeatInfo } from '../shared/types.mts';

type Loose = Record<string, any>;

const near = (a: any, b: any, tol: any, msg?: any) => {
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
};

const gridErr = (x: any, anchor: any, period: any) => {
  const r = (((x - anchor) % period) + period) % period;

  return Math.min(r, period - r);
};

const fo = (L: any, F: any) => ({ startPos: +(L - F).toFixed(2), endPos: L, restorePos: +(L + 0.3).toFixed(2) });

function bt({ bpm = 120, conf = 0.8, alt = [], ph = 0.2, grids }: any) {
  const P = 60 / bpm;

  return { bpm, conf, alt, ph, grids: grids || [[bpm, 45, 0.2 + 370 * P, P, 8, 190.4]] };
}

test('aligned: 120 BPM, cut 0.05 s after a beat -> ends on that beat, starts 2 bars (8 beats) earlier', () => {
  const r = A.alignFadeOut(fo(190.25, 4), bt({} as any));
  assert.strictEqual(r.align.on, true);
  assert.strictEqual(r.align.mode, 'bar');
  assert.strictEqual(r.align.beats, 8);
  near(r.fadeOut!.endPos, 190.2, 1e-6, 'end on the last beat');
  near(r.fadeOut!.startPos, 186.2, 1e-6, 'start = phase + n * 60/BPM');
  near(gridErr(r.fadeOut!.startPos, 0.2, 0.5), 0, 1e-6);
  assert.strictEqual(r.fadeOut!.restorePos, 190.55);
});

test('aligned: a 2 s planned fade picks one bar (4 beats = 2 s at 120 BPM)', () => {
  const r = A.alignFadeOut(fo(190.25, 2), bt({} as any));
  assert.strictEqual(r.align.beats, 4);
  near(r.fadeOut!.startPos, 188.2, 1e-6);
});

test('aligned: cut far from a beat -> the fade still ends at the cut, the start goes to the nearest beat', () => {
  const r = A.alignFadeOut(fo(190.03, 3), bt({} as any));
  assert.strictEqual(r.align.on, true);
  assert.strictEqual(r.align.endOnBeat, false);
  assert.strictEqual(r.align.mode, 'beat');
  near(r.fadeOut!.endPos, 190.03, 1e-6);
  near(gridErr(r.fadeOut!.startPos, 0.2, 0.5), 0, 1e-6, 'start on a beat');
  near(r.fadeOut!.endPos - r.fadeOut!.startPos, 3, 0.25 + 1e-6, 'length within half a beat of the plan');
});

test('the end-snap boundary: 0.25 s before the cut snaps, 0.26 s does not', () => {
  const at = (gap: any) => A.alignFadeOut(fo(+(190.2 + gap).toFixed(3), 4), bt({} as any)).align.endOnBeat;
  assert.strictEqual(at(0.25), true);
  assert.strictEqual(at(0.26), false);
  const r = A.alignFadeOut(fo(190.18, 4), bt({} as any));
  assert.strictEqual(r.align.endOnBeat, true);
  near(r.fadeOut!.endPos, 190.18, 1e-6, 'never later than the last sound');
});

test('aligned length stays within 1.5-4.5 s and on the grid for 60-200 BPM, any phase, 2-4 s plans', () => {
  let n = 0;

  for (let bpm = 60; bpm <= 200; bpm += 7) {
    for (const phase of [0, 0.13, 0.37]) {
      for (const F of [2, 2.7, 3.3, 4]) {
        for (const L of [150.0, 150.17, 150.41]) {
          const P = 60 / bpm;
          const anchor = phase + Math.floor((L - 0.3 - phase) / P) * P;
          const r = A.alignFadeOut(fo(L, F), bt({ bpm, ph: phase, grids: [[bpm, 45, anchor, P, 5, L + 0.2]] }));

          if (!r.align.on) {
            assert.strictEqual(r.align.reason, 'no_beat_in_range');
            continue;
          }

          n++;
          const d = r.fadeOut!.endPos - r.fadeOut!.startPos;
          assert.ok(d >= A.ALIGN_FADE_MIN_SEC - 1e-3 && d <= A.ALIGN_FADE_MAX_SEC + 1e-3, `length ${d} at ${bpm} BPM`);
          assert.ok(
            r.fadeOut!.endPos <= L + 1e-9 && L - r.fadeOut!.endPos <= A.ALIGN_END_SNAP_MAX_SEC + 1e-9,
            'end at or shortly before the cut',
          );
          near(gridErr(r.fadeOut!.startPos, phase, P), 0, 2e-3, `start on grid at ${bpm} BPM`);
        }
      }
    }
  }

  assert.ok(n > 400, `aligned cases ${n}`);
});

test('fail-safe: confidence below 0.5 keeps the unaligned fade; exactly 0.5 aligns', () => {
  const plain = fo(190.25, 4);
  const low = A.alignFadeOut(plain, bt({ conf: 0.49 } as any));
  assert.strictEqual(low.align.on, false);
  assert.strictEqual(low.align.reason, 'low_confidence');
  assert.deepStrictEqual(low.fadeOut, plain);
  assert.strictEqual(A.alignFadeOut(plain, bt({ conf: 0.5 } as any)).align.on, true);
});

test('fail-safe: double / half candidates, missing phase, missing tempo, tempo out of range', () => {
  const plain = fo(190.25, 4);

  for (const [b, reason] of [
    [bt({ alt: ['half' as any] }), 'octave'],
    [bt({ ph: null as any }), 'no_phase'],
    [null, 'no_tempo'],
    [bt({ bpm: 220, grids: [] }), 'out_of_range'],
    [bt({ bpm: 55, grids: [] }), 'out_of_range'],
  ]) {
    const r = A.alignFadeOut(plain, b! as any);
    assert.strictEqual(r.align.on, false, reason as any);
    assert.strictEqual(r.align.reason, reason);
    assert.deepStrictEqual(r.fadeOut, plain);
  }
});

test('fail-safe: tempo change at the end, unstable beats, no window at the end', () => {
  const plain = fo(190.25, 4);
  const tc = A.alignFadeOut(plain, bt({ grids: [[100, 45, 189.8, 0.6, 5, 190.4]] }));
  assert.strictEqual(tc.align.reason, 'tempo_change');
  assert.deepStrictEqual(tc.fadeOut, plain);
  assert.strictEqual(
    A.alignFadeOut(plain, bt({ grids: [[120, 45, 189.8, 0.6, 5, 190.4]] })).align.reason,
    'tempo_change',
  );
  assert.strictEqual(A.alignFadeOut(plain, bt({ grids: [[120, 45, 185.2, 0.5, 31, 190.4]] })).align.reason, 'unstable');
  assert.strictEqual(A.alignFadeOut(plain, bt({ grids: [[120, 45, 185.2, 0.5, 30, 190.4]] })).align.on, true);
  // a grid window ending 2.5 s before the cut is not extrapolated
  assert.strictEqual(A.alignFadeOut(plain, bt({ grids: [[120, 30, 185.2, 0.5, 5, 187.75]] })).align.reason, 'no_grid');
  assert.strictEqual(A.alignFadeOut(plain, bt({ grids: [[120, 3, 190.2, 0.5, 5, 190.4]] })).align.reason, 'no_grid');
  assert.strictEqual(A.alignFadeOut(plain, bt({ grids: [] })).align.reason, 'no_grid');
});

test('the newest window at the end wins over older ones (a later listen corrects an earlier grid)', () => {
  const old = [120, 45, 185.0, 0.5, 5, 190.4];
  const nu = [120, 45, 185.2, 0.5, 5, 190.4];
  const r = A.alignFadeOut(fo(190.25, 4), bt({ grids: [old, nu] }));
  near(gridErr(r.fadeOut!.startPos, 0.2, 0.5), 0, 1e-6);
  const r2 = A.alignFadeOut(fo(190.25, 4), bt({ grids: [nu, [100, 45, 189.8, 0.6, 5, 190.4]] }));
  assert.strictEqual(r2.align.on, true);
  near(gridErr(r2.fadeOut!.startPos, 0.2, 0.5), 0, 1e-6);
});

test('the local grid is used, not the global phase extrapolated with the summary BPM (drift)', () => {
  const Pt = 60 / 120.1;
  const anchor = 0.2 + 380 * Pt;
  const r = A.alignFadeOut(
    fo(anchor + 0.05, 4),
    bt({ bpm: 120, ph: 0.2, grids: [[120.1, 45, anchor, Pt, 5, anchor + 0.3]] }),
  );
  assert.strictEqual(r.align.on, true);
  near(gridErr(r.fadeOut!.startPos, anchor, Pt), 0, 5e-4, 'on the local grid (positions are kept to 1 ms)');
  assert.ok(Math.abs(r.align.globalPhaseDiffMs!) > 100, `the global grid is ${r.align.globalPhaseDiffMs} ms off here`);
});

test('beatGridFit: straight grid, jitter, a tempo ramp, too few beats', () => {
  const beats = [];
  for (let k = 0; k < 60; k++) beats.push(100.2 + k * 0.5);
  const g = TK.beatGridFit(beats, 120);
  near(g!.periodSec, 0.5, 1e-9);
  near(g!.anchorSec, 129.7, 1e-9);
  near(g!.rmsMs, 0, 1e-6);
  const j = TK.beatGridFit(
    beats.map((b, i) => b + (i % 2 ? 0.01 : -0.01)),
    120,
  );
  near(j!.periodSec, 0.5, 1e-3);
  near(j!.rmsMs, 10, 0.5);
  const ramp = [];
  let t = 100;

  for (let k = 0; k < 60; k++) {
    ramp.push(t);
    t += 60 / (120 + (12 * k) / 59);
  }

  assert.ok(TK.beatGridFit(ramp, 126)!.rmsMs > A.ALIGN_MAX_RMS_MS, 'ramp residual');
  const off = TK.beatGridFit(beats, 121);
  near(off!.periodSec, 0.5, 1e-9);
  near(off!.rmsMs, 0, 1e-6);
  const missing = beats.filter((_, i) => i !== 30);
  near(TK.beatGridFit(missing, 120)!.anchorSec, 129.7, 1e-9);
  assert.strictEqual(TK.beatGridFit(beats.slice(0, 7), 120), null);
  assert.strictEqual(TK.beatGridFit(null, 120), null);
});

function synthFlux(sec: any, bpm: any, first = 0.2) {
  const f = new Array(Math.round(sec * 100)).fill(0.1);
  for (let x = first; x < sec; x += 60 / bpm) f[Math.round(x * 100)] = 5;

  return f;
}

function cutRecord(endPos: any, tempoKey: any) {
  const lufs = new Array(200).fill(-9);

  return {
    integratedLufs: -10,
    coverage: 0.5,
    durationSec: endPos + 0.05,
    lastSoundSec: endPos,
    tail: { endPos, lufs },
    tempoKey,
  };
}

test('end to end: two synthetic listens -> stored votes with grids -> index entry -> beat-aligned plan', () => {
  const bpm = 124,
    P = 60 / bpm,
    first = 0.31;
  const seg = (start: any, sec: any) => ({ start, flux: synthFlux(sec, bpm, (((first - start) % P) + P) % P) });
  const l1 = TK.analyseListen({ segments: [seg(0.01, 45)] });
  const l2 = TK.analyseListen({ segments: [seg(155.01, 44.99)] });
  assert.ok(l2.votes.length && l2.votes[0].length === 7, 'votes carry the local grid');
  const tk = TK.mergeTempoKey(TK.mergeTempoKey(null, l1, 1), l2, 2);
  assert.ok(tk.tempo!.confidence >= 0.5, `confidence ${tk.tempo!.confidence}`);
  const entry = A.indexEntryOf(cutRecord(200.0, tk));
  assert.ok(entry!.bt && entry!.bt.grids.length === 2);
  const plan = A.planFades(entry, {});
  assert.strictEqual(plan.align.on, true, JSON.stringify(plan.align));
  near(gridErr(plan.fadeOut!.startPos, first, P), 0, 0.015, 'start on a synthetic beat (10 ms flux grid)');
  near(gridErr(plan.fadeOut!.startPos, tk.tempo!.phaseSec, 60 / tk.tempo!.bpm), 0, 0.03, 'and phaseSec + n * 60/BPM');
  assert.ok(plan.fadeOut!.endPos <= 200.0 && plan.fadeOut!.endPos >= 200.0 - 0.25);
  const offPlan = A.planFades(entry, { beatAlign: false });
  assert.deepStrictEqual(offPlan.fadeOut, { startPos: 196, endPos: 200, restorePos: 200.3 });
  assert.strictEqual(offPlan.align.reason, 'off');
});

test('one listen of the tail only (confidence < 0.5) keeps the old fade', () => {
  const l = TK.analyseListen({ segments: [{ start: 155.01, flux: synthFlux(44.99, 124) }] });
  const tk = TK.mergeTempoKey(null, l, 1);
  assert.ok(tk.tempo!.confidence < 0.5);
  const plan = A.planFades(A.indexEntryOf(cutRecord(200.0, tk)), {});
  assert.strictEqual(plan.align.reason, 'low_confidence');
  assert.deepStrictEqual(plan.fadeOut, { startPos: 196, endPos: 200, restorePos: 200.3 });
});

test('fail-safe: broken tempo data never breaks the plan; other tempo logic versions are ignored', () => {
  const rec = cutRecord(200.0, null);
  const base = A.planFades(A.indexEntryOf(rec), {});
  assert.strictEqual(base.align.reason, 'no_tempo');
  const entry = A.indexEntryOf(rec);
  entry!.bt = {
    get bpm(): number {
      throw new Error('boom');
    },
  } as BeatInfo;
  const p = A.planFades(entry, {});
  assert.strictEqual(p.align.reason, 'error');
  assert.deepStrictEqual(p.fadeOut, base.fadeOut);

  for (const tk of [
    { logicVersion: 99, tempo: { bpm: 120, confidence: 1, phaseSec: 0.1 }, votes: [] },
    { logicVersion: A.TEMPO_LOGIC_VERSION, tempo: null },
    { logicVersion: A.TEMPO_LOGIC_VERSION, tempo: { bpm: 120 }, votes: 'x' },
  ]) {
    const q = A.planFades(A.indexEntryOf(cutRecord(200.0, tk)), {});
    assert.strictEqual(q.align.on, false);
    assert.deepStrictEqual(q.fadeOut, base.fadeOut);
  }

  assert.strictEqual(A.planFades(null).align.reason, 'no_fade');
  assert.strictEqual(A.planFades({ en: { kind: 'fades' } }).align.reason, 'no_fade');
});

test('the tempo logic version read by the page equals the one written by the service worker', () => {
  assert.strictEqual(A.TEMPO_LOGIC_VERSION, TK.TEMPO_LOGIC_VERSION);
});

test('the bridge keeps tail, tempo summary, votes, the current key and the edges in index entries (chroma, segments and cells are dropped)', () => {
  const sum = [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4].map((x) => x * 600);
  const tk = {
    logicVersion: 1,
    tempo: { bpm: 120, confidence: 0.9 },
    votes: [[120, 45, 0.1]],
    chromaSum: sum,
    chromaFrames: 600,
    seg: {
      v: 1,
      head: { at: 0.5, approx: false, votes: [[120, 30, 5]], cs: sum.map((x) => x / 2), cf: 300 },
      tail: null,
    },
  };
  const rec: Loose = cutRecord(200.0, tk);
  rec.cells = [[0, 10, -9, -1]];
  const e = indexEntry(rec);
  assert.strictEqual(e.cells, undefined);
  assert.ok(e.tail && (e.tail as Loose).lufs.length === 200);
  assert.deepStrictEqual(Object.keys(e.tempoKey as any).sort(), ['edges', 'key', 'logicVersion', 'tempo', 'votes']);
  assert.strictEqual((e.tempoKey as any).chromaSum, undefined);
  assert.strictEqual((e.tempoKey as any).seg, undefined);
  assert.strictEqual((e.tempoKey as any).key.camelot, '8B');
  assert.strictEqual((e.tempoKey as any).edges.head.src.key, 'segment');
  assert.strictEqual((e.tempoKey as any).edges.tail.src.key, 'track');
  const ie = A.indexEntryOf(e);
  assert.strictEqual(ie!.tk!.head!.cam, '8B');
  assert.strictEqual(
    ie!.tk!.tail!.kc,
    Math.round(ie!.tk!.kc * 50) / 100,
    'no tail segment: the track key at half confidence',
  );
});
