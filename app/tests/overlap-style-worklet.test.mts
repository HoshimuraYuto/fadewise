import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { workletJs } from '../scripts/worklets.mts';

type Loose = Record<string, any>;
const SRC = workletJs('audio/overlap-worklet.js');
const FS = 48000,
  D = 512;
const A = (t: number) => 0.35 * Math.sin(2 * Math.PI * 60 * t) + 0.2 * Math.sin(2 * Math.PI * 900 * t);
const B = (t: number) => 0.35 * Math.sin(2 * Math.PI * 85 * t + 0.3) + 0.2 * Math.sin(2 * Math.PI * 1300 * t);

function make() {
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
  const h: Loose = { p, msgs, out: [] as number[], src: 'a', ta: 1, tb: 0, rate: 1, n: 0, ms: 0, blocks: 0 };
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
        x[s] = B(h.tb);
        h.tb += 1 / FS;
      }
    }

    const t0 = performance.now();
    p.process([[x, x]], [[y0, y1]], { gOld: new Float32Array([1]), kB: new Float32Array([1]) });

    if (p.mode === 'drain') {
      h.ms += performance.now() - t0;
      h.blocks++;
    }

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

function sw(capture: Loose, after = 5) {
  const h = make();
  h.run(0.5);
  h.send(Object.assign({ cmd: 'capture', rate: 1.25 }, capture));
  h.rate = 1.25;
  h.run(10);
  h.send({ cmd: 'end', tailKeep: 0.3 });
  h.src = 'z';
  h.run(0.2);
  h.src = 'b';
  h.bStart = h.n;
  h.run(after);

  return h;
}

const AUTO = { curve: 'equal', swapAt: 0.5, bass: true, hpNew: false, hpOld: false };

test('style: without a style the switch is the same samples as before; after the blend the output is the input delayed by D', () => {
  const plain = sw({ shape: 'equal' }),
    nul = sw({ shape: 'equal', style: null });
  assert.strictEqual(plain.out.length, nul.out.length);
  for (let i = 0; i < plain.out.length; i++) assert.strictEqual(plain.out[i], nul.out[i]);
  const h = sw({ shape: 'equal', style: AUTO });
  assert.ok(h.ev('drained')[0], 'drained');
  let m = 0;

  for (let i = h.out.length - FS; i < h.out.length; i++) {
    const want = Math.fround(B((i - h.bStart - D) / FS));
    m = Math.max(m, Math.abs(h.out[i] - want));
  }

  assert.ok(m < 1e-6, `after the blend ${m}`);
});

test('style: the low ends swap instead of piling up (windows with both lows loud: plain crossfade vs bass swap)', () => {
  const plain = sw({ shape: 'equal', style: { curve: 'equal', swapAt: 0.5, bass: false } });
  const swap = sw({ shape: 'equal', style: AUTO });
  const rp = plain.ev('report')[0],
    rs = swap.ev('report')[0];
  if (process.env.V47_PRINT)
    console.log(JSON.stringify({ plain: [rp.lowBoth, rp.lowWins], swap: [rs.lowBoth, rs.lowWins] }));
  assert.ok(rp.lowWins > 30 && rs.lowWins > 30, `blend windows ${rp.lowWins} / ${rs.lowWins}`);
  assert.ok(rp.lowBoth >= rp.lowWins * 0.5, `plain: both lows loud in ${rp.lowBoth} / ${rp.lowWins}`);
  assert.ok(rs.lowBoth <= 4, `bass swap: both lows loud in ${rs.lowBoth} / ${rs.lowWins} (the 150 ms ramp)`);
  assert.strictEqual(rs.silentWins, 0);
  assert.strictEqual(rs.outClicks, 0, JSON.stringify(rs.outAt));
});

test('style: the swap lands at the asked point (half the blend, or N s before the remainder ends)', () => {
  const h = sw({ shape: 'equal', style: AUTO });
  const ns = h.ev('newSound')[0],
    s = h.ev('swap')[0];
  assert.ok(s, 'swap reported');
  assert.ok(Math.abs(s.atSec - ns.xfSec / 2) < 0.01, `half: ${s.atSec} of ${ns.xfSec}`);
  const k = sw({ shape: 'equal', style: AUTO, swapLeftSec: 0.8 });
  const n2 = k.ev('newSound')[0],
    s2 = k.ev('swap')[0];
  assert.ok(Math.abs(n2.remSec - s2.atSec - 0.8) < 0.01, `left 0.8: at ${s2.atSec} of ${n2.remSec}`);
});

test('style overlap: both tracks stay up until the swap, the next opens from a high pass and the old one closes', () => {
  const h = sw({ shape: 'equal', style: { curve: 'overlap', swapAt: 0.5, bass: true, hpNew: true, hpOld: true } });
  const ns = h.ev('newSound')[0],
    s = h.ev('swap')[0];
  assert.ok(ns && s && h.ev('drained')[0]);
  const rep = h.ev('report')[0];
  assert.strictEqual(rep.silentWins, 0);
  assert.strictEqual(rep.outClicks, 0, JSON.stringify(rep.outAt));
  assert.ok(rep.lowBoth <= 4, `both lows loud in ${rep.lowBoth}`);
  const at = h.bStart + D + Math.round((s.atSec - 0.2) * FS);
  let e = 0;
  for (let i = at - 2400; i < at; i++) e += h.out[i] ** 2;
  const rms = Math.sqrt(e / 2400);
  assert.ok(rms > 0.3, `before the swap ${rms.toFixed(3)}`);
});

test('style: a flush while blending (an ad) drops the old part and the filters within 5 ms, then passes the input', () => {
  const h = make();
  h.run(0.5);
  h.send({ cmd: 'capture', rate: 1.25, shape: 'equal', style: AUTO });
  h.rate = 1.25;
  h.run(10);
  h.send({ cmd: 'end', tailKeep: 0.3 });
  h.src = 'b';
  h.bStart = h.n;
  h.run(0.6);
  h.send({ cmd: 'flush', why: 'ad', fade: 0.005 });
  h.run(0.02);
  const dd = h.ev('drained')[0];
  assert.ok(dd && dd.killed, 'killed');
  const from = h.n;
  h.run(0.5);
  let m = 0;
  for (let i = from; i < h.out.length; i++)
    m = Math.max(m, Math.abs(h.out[i] - Math.fround(B((i - h.bStart - D) / FS))));
  assert.ok(m < 1e-6, `after the flush ${m}`);
});

test('style: the filters cost little per 128-sample block while blending', () => {
  const plain = sw({ shape: 'equal' }, 3),
    st = sw({ shape: 'equal', style: { curve: 'overlap', swapAt: 0.5, bass: true, hpNew: true, hpOld: true } }, 3);
  const a = plain.ms / plain.blocks,
    b = st.ms / st.blocks;
  if (process.env.V47_PRINT) console.log(JSON.stringify({ plainMs: a, styledMs: b }));
  assert.ok(b < 0.5, `per block: plain ${a.toFixed(3)} ms, styled ${b.toFixed(3)} ms`);
});
