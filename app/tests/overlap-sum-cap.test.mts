import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { workletJs } from '../scripts/worklets.mts';

type Loose = Record<string, any>;
const SRC = workletJs('audio/overlap-worklet.js');
const FS = 48000,
  D = 512;
const tone = (fs: number[], amp: number, ph: number) => (t: number) =>
  fs.reduce((a, f, i) => a + amp * Math.sin(2 * Math.PI * f * t + ph * (i + 1)), 0);
const A = tone([70, 440, 1250, 3100], 0.12, 0.3);
const B = tone([95, 520, 1500, 2700], 0.12, 1.1);

function make(bAmp = 1) {
  let Proc: any = null;
  const msgs: any[] = [];

  class AudioWorkletProcessor {
    port = { postMessage: (m: any) => msgs.push(m), onmessage: null as any };
  }

  const ctx: Loose = {
    AudioWorkletProcessor,
    sampleRate: FS,
    currentTime: 0,
    Math,
    Float32Array,
    Float64Array,
    Object,
    registerProcessor: (_n: any, c: any) => {
      Proc = c;
    },
  };
  vm.runInNewContext(SRC, ctx);
  const p = new Proc({ processorOptions: {} });
  const h: Loose = { p, msgs, out: [] as number[], src: 'a', ta: 1, tb: 0, rate: 1, n: 0 };
  h.send = (c: any) => p.port.onmessage({ data: c });

  h.block = () => {
    const x = new Float32Array(128),
      y0 = new Float32Array(128),
      y1 = new Float32Array(128);

    for (let s = 0; s < 128; s++) {
      if (h.src === 'a') {
        x[s] = A(h.ta);
        h.ta += h.rate / FS;
      } else if (h.src === 'b') {
        x[s] = B(h.tb) * bAmp;
        h.tb += 1 / FS;
      }
    }

    p.process([[x, x]], [[y0, y1]], { gOld: new Float32Array([1]), kB: new Float32Array([1]) });
    for (let s = 0; s < 128; s++) h.out.push(y0[s]);
    h.n += 128;
    ctx.currentTime = h.n / FS;
  };

  h.run = (sec: number) => {
    for (let i = 0; i < Math.round((sec * FS) / 128); i++) h.block();
  };

  h.ev = (type: string) => msgs.filter((m) => m.ev === type);

  return h;
}

function sw(style: Loose | null, bAmp = 1) {
  const h = make(bAmp);
  h.run(0.5);
  h.send({ cmd: 'capture', rate: 1.25, shape: 'equal', style });
  h.rate = 1.25;
  h.run(24);
  h.send({ cmd: 'end', tailKeep: 0.3 });
  h.src = 'z';
  h.run(0.2);
  h.src = 'b';
  h.bStart = h.n;
  h.run(8);

  return h;
}

const BLEND = { curve: 'overlap', swapAt: 0.5, bass: true, hpNew: true, hpOld: true };

function levels(h: Loose, sec: number) {
  const from = h.bStart + D,
    w = Math.round(0.4 * FS),
    out: number[] = [];

  for (let i = from; i + w < from + sec * FS; i += Math.round(0.1 * FS)) {
    let e = 0;
    for (let k = i; k < i + w; k++) e += h.out[k] ** 2;
    out.push(10 * Math.log10(e / w));
  }

  return out;
}

const dbOf = (f: (t: number) => number) => {
  let e = 0;
  for (let i = 0; i < FS; i++) e += f(i / FS) ** 2;

  return 10 * Math.log10(e / FS);
};

test('sum cap: in a blend that keeps both tracks up, the sum stays within 2 dB of one track at full level', () => {
  const capped = sw(BLEND);
  const ref = Math.max(dbOf(A), dbOf(B));
  const xf = capped.ev('newSound')[0].xfSec;
  const lv = levels(capped, xf);
  const peak = Math.max(...lv) - ref;
  const rep = capped.ev('report')[0];
  if (process.env.V51_PRINT) console.log(JSON.stringify({ peak, ref, sumCutDb: rep.sumCutDb, xf }));
  assert.ok(peak < 2, `peak over the louder track ${peak.toFixed(2)} dB`);
  assert.ok(rep.sumCutDb < -0.3, `the cap acted (${rep.sumCutDb} dB)`);
  assert.strictEqual(rep.silentWins, 0);
  assert.strictEqual(rep.outClicks, 0, JSON.stringify(rep.outAt));
  assert.ok(rep.lowBoth <= 4, `both lows loud in ${rep.lowBoth}`);
  assert.ok(capped.ev('drained')[0], 'drained');
  let m = 0;
  for (let i = capped.out.length - FS; i < capped.out.length; i++)
    m = Math.max(m, Math.abs(capped.out[i] - Math.fround(B((i - capped.bStart - D) / FS))));
  assert.ok(m < 1e-6, `after the blend ${m}`);
});

test('sum cap: an equal-power crossfade of two unrelated tracks is left alone (no dip added)', () => {
  const h = sw({ curve: 'equal', swapAt: 0.5, bass: true, hpNew: false, hpOld: false });
  const rep = h.ev('report')[0];
  assert.ok(rep.sumCutDb > -1, `equal power: ${rep.sumCutDb} dB`);
});

test('sum cap: the old track alone never rises above its own level while the swap closes it', () => {
  const h = sw(BLEND, 0.004); // a next track that is only just above the first-sound threshold
  const ref = dbOf(A);
  const lv = levels(h, h.ev('newSound')[0].xfSec);
  const top = Math.max(...lv) - ref;
  assert.ok(top < 0.3, `old part over its own level ${top.toFixed(2)} dB`);
});

test('sum cap: a flush mid-blend still drops the old part, the filters and the cap within 5 ms', () => {
  const h = make();
  h.run(0.5);
  h.send({ cmd: 'capture', rate: 1.25, shape: 'equal', style: BLEND });
  h.rate = 1.25;
  h.run(24);
  h.send({ cmd: 'end', tailKeep: 0.3 });
  h.src = 'b';
  h.bStart = h.n;
  h.run(3.2);
  assert.ok(h.p.comp < 0.95, `cap down before the flush (${h.p.comp})`);
  h.send({ cmd: 'flush', why: 'ad', fade: 0.005 });
  h.run(0.02);
  assert.ok(h.ev('drained')[0]?.killed, 'killed');
  const from = h.n;
  h.run(0.5);
  let m = 0;
  for (let i = from; i < h.out.length; i++)
    m = Math.max(m, Math.abs(h.out[i] - Math.fround(B((i - h.bStart - D) / FS))));
  assert.ok(m < 1e-6, `after the flush ${m}`);
});
