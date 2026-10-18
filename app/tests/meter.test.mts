import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import * as A from '../shared/analysis.mts';
import { workletJs } from '../scripts/worklets.mts';

const SRC = workletJs('audio/meter-worklet.js');

function makeProcessor(rate: any) {
  let Proc = null;
  const posted: any[] = [];

  class AudioWorkletProcessor {
    port = { postMessage: (m: any) => posted.push(m) };
  }

  const ctx = {
    AudioWorkletProcessor,
    sampleRate: rate,
    currentTime: 0,
    Math,
    Float64Array,
    registerProcessor: (n: any, c: any) => {
      Proc = c;
    },
  };
  vm.runInNewContext(SRC, ctx);

  return { proc: new Proc!(), posted, ctx };
}

// segments: [{ sec, ampL, ampR, freq }]
function run(rate: any, segments: any) {
  const { proc, posted } = makeProcessor(rate);
  let phase = 0;

  for (const s of segments) {
    const total = Math.round(s.sec * rate);

    for (let off = 0; off < total; off += 128) {
      const L = new Float32Array(128),
        R = new Float32Array(128);

      for (let i = 0; i < 128; i++) {
        const v = Math.sin((2 * Math.PI * (s.freq || 1000) * phase++) / rate);
        L[i] = (s.ampL || 0) * v;
        R[i] = (s.ampR || 0) * v;
      }

      proc.process([[L, R]]);
    }
  }

  return posted;
}

const db = (x: any) => Math.pow(10, x / 20);
const integrated = (frames: any) => A.integratedFromSubBlocks(frames.map((f: any) => f.e));

for (const rate of [48000, 44100]) {
  test(`EBU Tech 3341 case 1: stereo 1 kHz at -23 dBFS reads -23.0 LUFS (${rate} Hz)`, () => {
    const L = integrated(run(rate, [{ sec: 20, ampL: db(-23), ampR: db(-23) }]));
    assert.ok(Math.abs(L! - -23) <= 0.1, `got ${L}`);
  });
  test(`1 kHz sine at 0 dBFS in one channel reads -3.01 LUFS (${rate} Hz)`, () => {
    const L = integrated(run(rate, [{ sec: 10, ampL: 1, ampR: 0 }]));
    assert.ok(Math.abs(L! - -3.01) <= 0.1, `got ${L}`);
  });
}

test('EBU Tech 3341 case 2: stereo 1 kHz at -33 dBFS reads -33.0', () => {
  const L = integrated(run(48000, [{ sec: 20, ampL: db(-33), ampR: db(-33) }]));
  assert.ok(Math.abs(L! - -33) <= 0.1, `got ${L}`);
});

test('EBU Tech 3341 case 3: -36/-23/-36 dBFS (10/60/10 s) reads -23.0 (relative gate)', () => {
  const L = integrated(
    run(48000, [
      { sec: 10, ampL: db(-36), ampR: db(-36) },
      { sec: 60, ampL: db(-23), ampR: db(-23) },
      { sec: 10, ampL: db(-36), ampR: db(-36) },
    ]),
  );
  assert.ok(Math.abs(L! - -23) <= 0.1, `got ${L}`);
});

test('EBU Tech 3341 case 5: -26/-20/-26 dBFS (20/20.1/20 s) reads -23.0', () => {
  const L = integrated(
    run(48000, [
      { sec: 20, ampL: db(-26), ampR: db(-26) },
      { sec: 20.1, ampL: db(-20), ampR: db(-20) },
      { sec: 20, ampL: db(-26), ampR: db(-26) },
    ]),
  );
  assert.ok(Math.abs(L! - -23) <= 0.1, `got ${L}`);
});

test('EBU Tech 3341 case 4: absolute gate drops -72 dBFS parts', () => {
  const L = integrated(
    run(48000, [
      { sec: 10, ampL: db(-72), ampR: db(-72) },
      { sec: 10, ampL: db(-36), ampR: db(-36) },
      { sec: 60, ampL: db(-23), ampR: db(-23) },
      { sec: 10, ampL: db(-36), ampR: db(-36) },
      { sec: 10, ampL: db(-72), ampR: db(-72) },
    ]),
  );
  assert.ok(Math.abs(L! - -23) <= 0.1, `got ${L}`);
});

test('second input (after the gain) is measured over the same window; absent input adds nothing', () => {
  const { proc, posted } = makeProcessor(48000);
  let phase = 0;

  for (let off = 0; off < 48000 * 3; off += 128) {
    const L = new Float32Array(128),
      R = new Float32Array(128),
      L2 = new Float32Array(128),
      R2 = new Float32Array(128);

    for (let i = 0; i < 128; i++) {
      const v = Math.sin((2 * Math.PI * 1000 * phase++) / 48000) * db(-23);
      L[i] = R[i] = v;
      L2[i] = R2[i] = v * 0.5;
    }

    proc.process([
      [L, R],
      [L2, R2],
    ]);
  }

  const pre = A.integratedFromSubBlocks(posted.map((f) => f.e));
  const postL = A.integratedFromSubBlocks(posted.map((f) => f.e2));
  assert.ok(Math.abs(postL! - pre! - -6.02) <= 0.05, `pre ${pre} post ${postL}`);
  assert.ok(Math.abs(posted[5].p2 - 0.5 * db(-23)) < 1e-3);
  const only = run(48000, [{ sec: 0.5, ampL: 0.5, ampR: 0.5 }]);
  assert.ok(only.every((f) => f.e2 === undefined));
  const { proc: p3, posted: out3 } = makeProcessor(48000);
  for (let off = 0; off < 4800 * 2; off += 128) p3.process([[new Float32Array(128).fill(0.1)], []]); // input 1 unconnected
  assert.ok(out3.every((f) => f.e2 === undefined));
});

test('frames are ~100 ms and report sample peak', () => {
  const f = run(48000, [{ sec: 1, ampL: 0.5, ampR: 0.25 }]);
  assert.strictEqual(f.length, 9); // hops round 4800 up to 128-frame quanta
  assert.ok(f.every((x) => x.n >= 4800 && x.n < 4800 + 128));
  assert.ok(Math.abs(f[3].p - 0.5) < 1e-3);
});
