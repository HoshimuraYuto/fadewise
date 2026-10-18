import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import * as TK from '../shared/tempo-key.mts';
import * as A from '../shared/analysis.mts';
import * as S from '../shared/settings.mts';
import { workletJs } from '../scripts/worklets.mts';

type Loose = Record<string, any>;

const SRC = workletJs('audio/meter-worklet.js');
const RATE = 44100;

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
    registerProcessor: (n: any, c: any) => {
      Proc = c;
    },
  };
  vm.runInNewContext(SRC, ctx);

  return { proc: new Proc!(), posted };
}

function rng(seed: any) {
  let s = seed >>> 0;

  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

const midiHz = (m: any) => 440 * Math.pow(2, (m - 69) / 12);

function synth({ sec, bpm, chords = [], chordSec = 2, drums = true, seed = 1 }: any) {
  const n = Math.round(sec * RATE);
  const L = new Float32Array(n);
  const noise = rng(seed);
  const beat = 60 / bpm;

  if (drums) {
    for (let k = 0; k * beat < sec; k++) {
      const t0 = k * beat;
      const s0 = Math.round(t0 * RATE);

      for (let i = 0; i < 0.25 * RATE && s0 + i < n; i++) {
        const t = i / RATE;
        L[s0 + i] += 0.6 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 12);
      }

      if (k % 2 === 1)
        for (let i = 0; i < 0.15 * RATE && s0 + i < n; i++) L[s0 + i] += 0.3 * noise() * Math.exp((-i / RATE) * 25);

      for (const off of [0, beat / 2]) {
        const h0 = Math.round((t0 + off) * RATE);
        for (let i = 0; i < 0.04 * RATE && h0 + i < n; i++) L[h0 + i] += 0.08 * noise() * Math.exp((-i / RATE) * 120);
      }
    }
  }

  if (chords.length) {
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const c = chords[Math.floor(t / chordSec) % chords.length];
      let v = 0;

      for (const m of c) {
        const f = midiHz(m);
        v += Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t);
      }

      L[i] += 0.05 * v;
    }
  }

  return L;
}

function runWorklet(L: any, stereo = true) {
  const { proc, posted } = makeProcessor(RATE);

  for (let off = 0; off + 128 <= L.length; off += 128) {
    const b = L.subarray(off, off + 128);
    proc.process([stereo ? [b, b] : [b]]);
  }

  return posted;
}

function pageFeatures(frames: any, startCt = 0) {
  const flux: any[] = [];
  const sum = new Array(12).fill(0);
  let chromaFrames = 0;
  frames.forEach((f: any, i: any) => {
    if (i > 0) for (const v of f.fx) flux.push(v);
    if (i > 7 && f.cr && TK.addChromaFrame(sum, f.cr)) chromaFrames++;
  });

  return { segments: [{ start: startCt + 0.1, flux }], chromaSum: sum, chromaFrames };
}

const near = (bpm: any, want: any) => [want, want * 2, want / 2].some((w) => Math.abs(bpm / w - 1) <= 0.04);

// the minor V is harmonic minor (G#)
const C_MAJOR = [
  [60, 64, 67],
  [65, 69, 72],
  [67, 71, 74],
  [60, 64, 67],
];
const A_MINOR = [
  [57, 60, 64],
  [62, 65, 69],
  [64, 68, 71],
  [57, 60, 64],
];

test('worklet: frames carry 10 flux values and a 12-bin chroma once the window is full, plus timing', () => {
  const frames = runWorklet(synth({ sec: 3, bpm: 120, chords: C_MAJOR as any }));
  assert.ok(frames.length >= 29);

  for (const f of frames.slice(2)) {
    assert.ok(Array.isArray(f.fx) && f.fx.length >= 9 && f.fx.length <= 11, `fx length ${f.fx.length}`);
    assert.ok(f.fx.every(Number.isFinite));
    assert.ok(Number.isFinite(f.fxMs) && Number.isFinite(f.pMs) && f.pMs >= f.fxMs);
  }

  assert.strictEqual(frames[0].cr, null);
  assert.ok(frames.slice(10).every((f) => Array.isArray(f.cr) && f.cr.length === 12));
  assert.ok(JSON.stringify(frames[20]).length < 600);
});

test('worklet: a 440 Hz tone lands in pitch class A', () => {
  const n = RATE * 2;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE);
  const frames = runWorklet(L, false);
  const c = frames[frames.length - 1].cr;
  assert.strictEqual(c.indexOf(Math.max(...c)), 9);
});

for (const bpm of [92, 120, 128, 150]) {
  test(`features -> BPM: drums at ${bpm} BPM (octave errors allowed)`, () => {
    const frames = runWorklet(synth({ sec: 45, bpm, chords: C_MAJOR as any, seed: bpm }));
    const listen = TK.analyseListen(pageFeatures(frames));
    assert.ok(listen.votes.length >= 1, 'at least one tempo window');
    const tk = TK.mergeTempoKey(null, listen, 1);
    assert.ok(near(tk.tempo!.bpm, bpm), `got ${tk.tempo!.bpm}`);
  });
}

test('features -> key: C major and A minor progressions with drums', () => {
  for (const [chords, want, cam] of [
    [C_MAJOR, 'C', '8B'],
    [A_MINOR, 'Am', '8A'],
  ]) {
    const frames = runWorklet(synth({ sec: 24, bpm: 110, chords: chords as any }));
    const tk = TK.mergeTempoKey(null, TK.analyseListen(pageFeatures(frames)), 1);
    assert.strictEqual(tk.key!.name, want);
    assert.strictEqual(tk.key!.camelot, cam);
    assert.ok(tk.key!.confidence > 0 && tk.key!.confidence <= 1);
  }
});

test('silence and very short listens produce no tempo vote and no error', () => {
  const frames = runWorklet(new Float32Array(RATE * 25));
  const listen = TK.analyseListen(pageFeatures(frames));
  assert.strictEqual(listen.votes.length, 0);
  assert.strictEqual(listen.chromaFrames, 0);
  const short = TK.analyseListen({ segments: [{ start: 0, flux: new Array(1000).fill(1) }] });
  assert.strictEqual(short.votes.length, 0);
  assert.deepStrictEqual(TK.analyseListen(null).votes, []);
  assert.deepStrictEqual(TK.analyseListen({ segments: 'x', chromaSum: [1, 2] }).votes, []);
  assert.strictEqual(TK.beatRoot([1, 2, 3]), null);
});

test('tempo windows: 30 s windows, remainders under 20 s join the previous window', () => {
  const calls = [];
  const flux = new Array(70 * 100).fill(0);
  const v = TK.listenTempoVotes([{ start: 5, flux }]);
  assert.strictEqual(v.length, 0);
  const segs = (sec: any) => [{ start: 0, flux: synthFlux(sec, 120) }];
  assert.deepStrictEqual(
    TK.listenTempoVotes(segs(45)).map((x) => x.sec),
    [45],
  );
  assert.deepStrictEqual(
    TK.listenTempoVotes(segs(70)).map((x) => x.sec),
    [30, 40],
  );
  assert.strictEqual(calls.length, 0);
});

function synthFlux(sec: any, bpm: any) {
  const f = new Array(Math.round(sec * 100)).fill(0.1);
  for (let t = 0.2; t < sec; t += 60 / bpm) f[Math.round(t * 100)] = 5;

  return f;
}

test('beat phase: beats of an impulse train starting at 0.2 s give phase 0.2 s at 120 BPM', () => {
  const listen = TK.analyseListen({ segments: [{ start: 10, flux: synthFlux(40, 120) }] });
  const tk = TK.mergeTempoKey(null, listen, 1);
  assert.ok(Math.abs(tk.tempo!.bpm - 120) < 1.5, `bpm ${tk.tempo!.bpm}`);
  assert.ok(Math.abs(tk.tempo!.phaseSec! - 0.2) < 0.03, `phase ${tk.tempo!.phaseSec}`);
});

test('summarizeTempo: double / half votes join one pulse; the octave follows the weighted majority', () => {
  const s = TK.summarizeTempo([
    [120, 30],
    [121, 30],
    [60.5, 30],
    [240, 20],
  ]);
  assert.ok(Math.abs(s!.bpm - 120.5) < 0.6);
  assert.strictEqual(s!.agreement, 1);
  assert.deepStrictEqual(s!.alt.sort(), ['double', 'half']);
  const h = TK.summarizeTempo([
    [70, 90],
    [140, 30],
  ]);
  assert.strictEqual(h!.bpm, 70);
  assert.strictEqual(h!.octaveAgreement, 0.75);
  const d = TK.summarizeTempo([
    [120, 60],
    [100, 60],
  ]);
  assert.strictEqual(d!.agreement, 0.5);
  assert.ok(d!.confidence <= 0.5);
  assert.strictEqual(TK.summarizeTempo([]), null);
});

test('confidence grows with agreeing listening time and saturates at 1', () => {
  const one = TK.summarizeTempo([[128, 30]]);
  const four = TK.summarizeTempo([
    [128, 30],
    [128.5, 30],
    [127.6, 30],
    [128.2, 30],
  ]);
  assert.strictEqual(one!.confidence, 0.25);
  assert.strictEqual(four!.confidence, 1);
});

test('mergeTempoKey: chroma sums add across listens, votes are capped to the newest, old logic is dropped', () => {
  const c1 = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
  const a = TK.mergeTempoKey(null, { votes: [[120, 30, 0.1]], chromaSum: c1, chromaFrames: 300 }, 1);
  const b = TK.mergeTempoKey(a, { votes: [[121, 30, 0.12]], chromaSum: c1, chromaFrames: 300 }, 2);
  assert.strictEqual(b.chromaFrames, 600);
  assert.strictEqual(b.chromaSum[0], 2);
  assert.strictEqual(b.listens, 2);
  assert.strictEqual(b.votes.length, 2);
  let r = b;
  for (let i = 0; i < 30; i++)
    r = TK.mergeTempoKey(r, { votes: [[90, 30, null]], chromaSum: null, chromaFrames: 0 }, 3 + i);
  assert.strictEqual(r.votes.length, TK.MAX_VOTES);
  assert.strictEqual(r.tempo!.bpm, 90);
  const fresh = TK.mergeTempoKey(
    Object.assign({}, b, { logicVersion: 0 }),
    { votes: [], chromaSum: null, chromaFrames: 0 },
    9,
  );
  assert.strictEqual(fresh.chromaFrames, 0);
  assert.strictEqual(fresh.tempo, null);
  assert.strictEqual(fresh.key, null);
  assert.strictEqual(fresh.listens, 0);
});

test('key: Temperley correlation, confidence from margin and amount, Camelot names', () => {
  const k = TK.summarizeKey(
    TK.TEMPERLEY.major.map((v, i, a) => a[(i + 12 - 7) % 12]),
    600,
  );
  assert.strictEqual(k!.name, 'G');
  assert.strictEqual(k!.camelot, '9B');
  const few = TK.summarizeKey(TK.TEMPERLEY.major.slice(), 60);
  assert.ok(few!.confidence <= 0.1 + 1e-9);
  const cases = [
    [0, 'major', '8B'],
    [9, 'minor', '8A'],
    [7, 'major', '9B'],
    [4, 'minor', '9A'],
    [5, 'major', '7B'],
    [2, 'minor', '7A'],
    [6, 'major', '2B'],
    [3, 'minor', '2A'],
    [11, 'major', '1B'],
    [8, 'minor', '1A'],
    [1, 'major', '3B'],
    [10, 'minor', '3A'],
  ];
  for (const [t, m, want] of cases) assert.strictEqual(TK.camelot(t, m), want, `${t} ${m}`);
  assert.strictEqual(TK.keyName(10, 'minor'), 'Bbm');
  assert.strictEqual(TK.summarizeKey(new Array(12).fill(0), 10), null);
});

function chromeStub() {
  const area = () => {
    const data = {};

    return {
      data,
      get: (k: any) =>
        Promise.resolve(
          k === null
            ? Object.assign({}, data)
            : Object.fromEntries(
                []
                  .concat(k)
                  .filter((x) => x in data)
                  .map((x) => [x, data[x]]),
              ),
        ),
      set: (o: any) => {
        Object.assign(data, JSON.parse(JSON.stringify(o)));

        return Promise.resolve();
      },
      remove: (keys: any) => {
        for (const k of [].concat(keys)) Reflect.deleteProperty(data, k);

        return Promise.resolve();
      },
      setAccessLevel: async () => {},
    };
  };

  const listeners: any[] = [];

  return {
    listeners,
    storage: { local: area(), session: area(), onChanged: { addListener() {} } },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener: (f: any) => listeners.push(f) },
    },
  };
}

let sw: any = null;

async function loadServiceWorker() {
  if (sw) return sw;
  const chrome = chromeStub();
  (chrome.storage.local.data as Loose).consent = {
    decision: 'granted',
    version: S.CONSENT_VERSION,
    at: 0,
  };
  globalThis.chrome = chrome as any;
  globalThis.self = globalThis as any;
  await import('../background/service-worker.mts');
  const send = (data: any) =>
    new Promise((resolve) => chrome.listeners[0]({ type: 'snapshot', data }, { tab: { id: 1 } }, resolve));
  sw = { chrome, send };

  return sw;
}

function snapshot(vid: any, sessionId: any, tk: any, extra?: any) {
  const s = A.createSession(vid, 200);
  for (let i = 1; i <= 300; i++) A.addFrame(s, i * 0.1, 0.05, 0.5);

  return Object.assign(A.sessionSnapshot(s, { sessionId, final: true }), tk ? { tk } : {}, extra || {});
}

test('service worker: stores BPM / key results only, never the feature sequences', async () => {
  const { chrome, send } = await loadServiceWorker();
  const tk = {
    segments: [{ start: 1, flux: synthFlux(40, 120) }],
    chromaSum: TK.TEMPERLEY.minor.slice(),
    chromaFrames: 400,
    fluxSec: 40,
  };
  const entry = await send(snapshot('abcdefghijk', 'abcdefghijk:1', tk));
  assert.ok(entry && entry.l !== undefined, 'index entry returned');
  const rec = chrome.storage.local.data['track:abcdefghijk'];
  assert.ok(rec.tempoKey && rec.tempoKey.tempo && Math.abs(rec.tempoKey.tempo.bpm - 120) < 1.5);
  assert.strictEqual(rec.tempoKey.key.name, 'Cm');
  assert.strictEqual(rec.tempoKey.logicVersion, TK.TEMPO_LOGIC_VERSION);
  assert.strictEqual(rec.tk, undefined);
  const json = JSON.stringify(rec);
  assert.ok(!json.includes('"flux"') && !json.includes('"segments"'));
  assert.ok(json.length < 8000, `record ${json.length} bytes`);
});

test('service worker: snapshots of the same listen re-merge against the base (no double counting)', async () => {
  const { chrome, send } = await loadServiceWorker();
  const tk = {
    segments: [{ start: 1, flux: synthFlux(40, 100) }],
    chromaSum: TK.TEMPERLEY.major.slice(),
    chromaFrames: 200,
  };
  await send(snapshot('lmnopqrstuv', 'lmnopqrstuv:1', tk));
  await send(snapshot('lmnopqrstuv', 'lmnopqrstuv:1', tk));
  let rec = chrome.storage.local.data['track:lmnopqrstuv'];
  assert.strictEqual(rec.tempoKey.chromaFrames, 200);
  assert.strictEqual(rec.tempoKey.listens, 1);
  await send(snapshot('lmnopqrstuv', 'lmnopqrstuv:1', null));
  rec = chrome.storage.local.data['track:lmnopqrstuv'];
  assert.strictEqual(rec.tempoKey.chromaFrames, 200);
  await send(snapshot('lmnopqrstuv', 'lmnopqrstuv:2', tk));
  rec = chrome.storage.local.data['track:lmnopqrstuv'];
  assert.strictEqual(rec.tempoKey.chromaFrames, 400);
  assert.strictEqual(rec.tempoKey.listens, 2);
});

test('service worker: malformed features never block saving the loudness record', async () => {
  const { chrome, send } = await loadServiceWorker();
  const bad = {
    segments: [{ start: 'x', flux: 5 }, null, { start: 0, flux: ['a', null, {}] }],
    chromaSum: 'no',
    chromaFrames: -1,
  };
  const entry = await send(snapshot('wxyz0123456', 'wxyz0123456:1', bad));
  assert.ok(entry);
  const rec = chrome.storage.local.data['track:wxyz0123456'];
  assert.ok(rec.integratedLufs !== null);
  assert.strictEqual(rec.tempoKey.tempo, null);
  assert.strictEqual(rec.tempoKey.key, null);
  const evil = {};
  Object.defineProperty(evil, 'segments', {
    get() {
      throw new Error('boom');
    },
    enumerable: true,
  });
  const entry2 = await send(snapshot('wxyz0123457', 'wxyz0123457:1', evil));
  assert.ok(entry2);
  assert.ok(chrome.storage.local.data['track:wxyz0123457']);
});
