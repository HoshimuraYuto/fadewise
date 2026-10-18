import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { workletJs } from '../scripts/worklets.mts';

type Loose = Record<string, any>;

const SRC = workletJs('audio/overlap-worklet.js');
const FS = 48000,
  D = 512;
const A = (t: any) => 0.3 * Math.sin(2 * Math.PI * 440 * t) + 0.2 * Math.sin(2 * Math.PI * 3000 * t + 1);
const B = (t: any) => 0.3 * Math.sin(2 * Math.PI * 523 * t + 0.4) + 0.2 * Math.sin(2 * Math.PI * 2100 * t);

function make(opts?: any) {
  let Proc = null;
  const msgs: any[] = [];

  class AudioWorkletProcessor {
    port = { postMessage: (m: any) => msgs.push(m), onmessage: null };
  }

  const ctx = {
    AudioWorkletProcessor,
    sampleRate: FS,
    currentTime: 0,
    Math,
    Float32Array,
    Object,
    registerProcessor: (n: any, c: any) => {
      Proc = c;
    },
  };
  vm.runInNewContext(SRC, ctx);
  const p = new Proc!({ processorOptions: opts || {} });
  const h: Loose = { p, msgs, out: [], src: 'a', ta: 1, tb: 0, rate: 1, gOld: 1, kB: 1, n: 0 };
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

    p.process([[x, x]], [[y0, y1]], { gOld: new Float32Array([h.gOld]), kB: new Float32Array([h.kB]) });
    for (let s = 0; s < 128; s++) h.out.push(y0[s]);
    h.n += 128;
    ctx.currentTime = h.n / FS;
  };

  h.run = (sec: any) => {
    for (let i = 0; i < Math.round((sec * FS) / 128); i++) h.block();
  };

  h.ev = (type: any) => msgs.filter((m) => m.ev === type);

  return h;
}

const snrDb = (got: any, want: any) => {
  let e = 0,
    s = 0;

  for (let i = 0; i < got.length; i++) {
    e += (got[i] - want[i]) ** 2;
    s += want[i] ** 2;
  }

  return 10 * Math.log10(s / Math.max(e, 1e-30));
};

const maxStep = (y: any, a: any, b: any) => {
  let m = 0;
  for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1]));

  return m;
};

test('overlap worklet: pass is the input delayed by D samples (after the start fade-in)', () => {
  const h: Loose = make();
  h.run(0.5);
  const want = [],
    got: any[] = [];

  for (let i = 2000; i < h.out.length; i++) {
    got.push(h.out[i]);
    want.push(A(1 + (i - D) / FS));
  }

  assert.ok(snrDb(got, want) > 100, `snr ${snrDb(got, want)}`);
});

test('overlap worklet: 1.25x capture is heard at the original speed (SNR > 80 dB) while the lead grows by 0.25 s per s', () => {
  const h: Loose = make();
  h.run(0.5);
  h.send({ cmd: 'capture', rate: 1.25 });
  h.rate = 1.25;
  h.run(8);
  const got: any[] = [],
    want = [];

  for (let i = 0.6 * FS; i < h.out.length; i++) {
    got.push(h.out[i]);
    want.push(A(1 + (i - D) / FS));
  }

  const snr = snrDb(got, want);
  assert.ok(snr > 80, `round trip snr ${snr.toFixed(1)} dB`);
  h.send({ cmd: 'flush', why: 'test' });
  const fl = h.ev('flush')[0];
  assert.ok(Math.abs(fl.lostSec - 2.0) < 0.05, `lead after 8 s at 1.25x: ${fl.lostSec}`);
});

test('overlap worklet: end -> the next track is crossfaded from its first sound, then pass carries it without a step', () => {
  const h: Loose = make();
  h.run(0.5);
  h.send({ cmd: 'capture', rate: 1.25, xfMax: null });
  h.rate = 1.25;
  h.run(10);
  h.send({ cmd: 'end', tailKeep: 0.3 });
  h.src = 'z';
  h.run(0.25);
  h.src = 'b';
  const bStart = h.n;
  h.run(4);
  const dr = h.ev('drain')[0],
    ns = h.ev('newSound')[0],
    dd = h.ev('drained')[0];
  assert.ok(dr.leadOutSec > 2.3 && dr.leadOutSec < 2.6, `lead at the end ${dr.leadOutSec}`);
  assert.ok(ns && ns.xfSec > 1.9, `crossfade ${ns && ns.xfSec}`);
  assert.ok(dd && !dd.killed);
  const rep = h.ev('report')[0];
  assert.ok(rep, 'report sent');
  assert.strictEqual(rep.silentWins, 0);
  assert.strictEqual(rep.outClicks, 0, JSON.stringify(rep));
  const from = h.out.length - FS;
  const got: any[] = [],
    want = [];

  for (let i = from; i < h.out.length; i++) {
    got.push(h.out[i]);
    want.push(B((i - bStart - D) / FS));
  }

  assert.ok(snrDb(got, want) > 90, `after handover ${snrDb(got, want)}`);
});

test('overlap worklet: the gate (head rush) keeps the fast input out, reports its first sound, then fades it in without a step', () => {
  const h: Loose = make();
  h.run(0.5);
  h.send({ cmd: 'capture', rate: 1.25 });
  h.rate = 1.25;
  h.run(10);
  h.send({ cmd: 'end', tailKeep: 0.3 });
  h.src = 'z';
  h.run(0.1);
  h.send({ cmd: 'gate', on: true });
  h.src = 'b';
  h.run(0.2);
  const ins = h.ev('inSound')[0];
  assert.ok(ins && ins.gated === true, 'first input sample reported while gated');
  assert.strictEqual(h.ev('newSound').length, 0, 'gated input does not start the crossfade');
  h.send({ cmd: 'gate', on: false, delay: 0.04 });
  const at = h.n;
  h.run(4);
  const open = h.ev('gateOpen')[0];
  assert.ok(open && Math.abs(open.t - (at / FS + 0.04)) < 0.004, `gate opens 40 ms later ${open && open.t}`);
  assert.ok(h.ev('newSound').length === 1);
  const rep = h.ev('report')[0];
  assert.ok(rep && rep.outClicks === 0 && rep.silentWins === 0, JSON.stringify(rep));
});

test('overlap worklet: a flush opens a shut gate (no input lost after an ad / skip)', () => {
  const h: Loose = make();
  h.run(0.3);
  h.send({ cmd: 'capture', rate: 1.25 });
  h.rate = 1.25;
  h.run(6);
  h.send({ cmd: 'end' });
  h.src = 'b';
  h.send({ cmd: 'gate', on: true });
  h.run(0.1);
  h.send({ cmd: 'flush', why: 'ad', fade: 0.005 });
  h.run(0.3);
  const tail = h.out.slice(-2000);
  assert.ok(Math.max(...tail.map(Math.abs)) > 0.2, 'input passes after the flush');
});

test('overlap worklet: segue keeps the new track at full level from its first sound', () => {
  const h: Loose = make();
  h.run(0.3);
  h.send({ cmd: 'capture', rate: 1.25, shape: 'segue' });
  h.rate = 1.25;
  h.run(8);
  h.send({ cmd: 'end' });
  h.src = 'b';
  const bStart = h.n;
  h.run(0.5);
  const got: any[] = [],
    want = [];

  for (let i = bStart + D + 2000; i < bStart + D + 6000; i++) {
    got.push(h.out[i]);
    want.push(B((i - bStart - D) / FS));
  }

  let dot = 0,
    bb = 0;

  for (let i = 0; i < got.length; i++) {
    dot += got[i] * want[i];
    bb += want[i] * want[i];
  }

  assert.ok(dot / bb > 0.95, `B gain ${dot / bb}`);
});

test('overlap worklet: a flush while capturing returns to pass within 20 ms, without a step', () => {
  const h: Loose = make();
  h.run(0.3);
  h.send({ cmd: 'capture', rate: 1.25 });
  h.rate = 1.25;
  h.run(4);
  const at = h.n;
  h.send({ cmd: 'flush', why: 'pause', fade: 0.02 });
  h.rate = 1;
  h.run(0.5);
  const pass = h.ev('pass')[0];
  assert.ok(pass && pass.t - at / FS <= 0.025, `pass after ${(pass.t - at / FS).toFixed(3)} s`);
  const music = maxStep(h.out, at - 4800, at);
  assert.ok(maxStep(h.out, at, at + 4800) <= music * 1.5, `flush step ${maxStep(h.out, at, at + 4800)} vs ${music}`);
  const rep = h.ev('report')[0];
  assert.strictEqual(rep.outClicks, 0);
});

test('overlap worklet: a flush while draining (an ad) puts the new input at gain 1 within 5 ms and drops the old tail', () => {
  const h: Loose = make();
  h.run(0.3);
  h.send({ cmd: 'capture', rate: 1.25 });
  h.rate = 1.25;
  h.run(10);
  h.send({ cmd: 'end' });
  h.src = 'b';
  h.run(0.3);
  const at = h.n;
  h.send({ cmd: 'flush', why: 'ad', fade: 0.005 });
  h.run(0.2);
  const dd = h.ev('drained')[0];
  assert.ok(dd && dd.killed);
  assert.ok(dd.t - at / FS < 0.01);
  assert.ok(h.ev('flush')[0].lostSec > 1, 'the unheard lead is reported');
});

test('overlap worklet: gOld scales only the old track, kB only the input path', () => {
  const h: Loose = make();
  h.run(0.3);
  h.kB = 0.5;
  h.run(0.2);

  const pk = (a: any, b: any) => {
    let m = 0;
    for (let i = a; i < b; i++) m = Math.max(m, Math.abs(h.out[i]));

    return m;
  };

  const passPk = pk(h.out.length - 4800, h.out.length);
  assert.ok(passPk < 0.27 && passPk > 0.2, `pass x0.5 ${passPk}`);
  h.kB = 1;
  h.send({ cmd: 'capture', rate: 1.25 });
  h.rate = 1.25;
  h.gOld = 0.25;
  h.run(1);
  const capPk = pk(h.out.length - 4800, h.out.length);
  assert.ok(capPk < 0.14 && capPk > 0.1, `capture x0.25 ${capPk}`);
});

test('overlap worklet: the ring is sized for the longest lead only (6 s at 1.05x: under 4 MB)', () => {
  const h: Loose = make({ maxLeadSec: 6, minRate: 1.05 });
  const r = h.ev('ready')[0];
  assert.ok(r.ringMB <= 4, `ring ${r.ringMB} MB`);
});
