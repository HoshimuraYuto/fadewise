import test from 'node:test';
import assert from 'node:assert';
import * as TK from '../shared/tempo-key.mts';
import type { KeySummary } from '../shared/types.mts';

type Mode = 'major' | 'minor';
const ideal = (tonic: number, mode: Mode) => TK.TEMPERLEY[mode].map((_, i, a) => a[(i - tonic + 12) % 12]);
const mix = (a: number[], b: number[], w: number) => a.map((v, i) => (1 - w) * v + w * b[i]);
const K = (tonic: number, mode: Mode) => ({ tonic, mode });

test('relatedKey: fifth up and down, relative, parallel; nothing else', () => {
  const C = K(0, 'major');
  assert.ok(TK.relatedKey(C, K(7, 'major')));
  assert.ok(TK.relatedKey(C, K(5, 'major')));
  assert.ok(TK.relatedKey(C, K(9, 'minor')));
  assert.ok(TK.relatedKey(C, K(0, 'minor')));
  assert.ok(!TK.relatedKey(C, C));
  assert.ok(!TK.relatedKey(C, K(2, 'major')));
  assert.ok(!TK.relatedKey(C, K(4, 'minor')));
  const Fsm = K(6, 'minor');
  assert.ok(TK.relatedKey(Fsm, K(9, 'major')));
  assert.ok(TK.relatedKey(Fsm, K(1, 'minor')));
  assert.ok(TK.relatedKey(Fsm, K(11, 'minor')));
  assert.ok(TK.relatedKey(Fsm, K(6, 'major')));
  const all = [];
  for (const m of ['major', 'minor'] as const) for (let t = 0; t < 12; t++) all.push(K(t, m));

  for (const a of all) {
    assert.strictEqual(all.filter((b) => TK.relatedKey(a, b)).length, 4);
    for (const b of all) assert.strictEqual(TK.relatedKey(a, b), TK.relatedKey(b, a));
  }
});

test('relatedKey matches the Camelot wheel: same number with the other letter, or one step on the same letter', () => {
  for (const ma of ['major', 'minor'] as const)
    for (let ta = 0; ta < 12; ta++)
      for (const mb of ['major', 'minor'] as const)
        for (let tb = 0; tb < 12; tb++) {
          if (ma === mb && ta === tb) continue;
          const ca = TK.camelot(ta, ma),
            cb = TK.camelot(tb, mb);
          const na = parseInt(ca!, 10),
            nb = parseInt(cb!, 10),
            la = ca!.slice(-1),
            lb = cb!.slice(-1);
          const step = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
          const camelotNear = (la === lb && step === 1) || (la !== lb && step === 0);
          const parallel = ta === tb && ma !== mb; // 3 steps apart on the wheel
          assert.strictEqual(TK.relatedKey(K(ta, ma), K(tb, mb)), camelotNear || parallel, `${ca} vs ${cb}`);
        }
});

test('summarizeKey v2: a clear key keeps full confidence; the format carries v, family and candidates', () => {
  const k = TK.summarizeKey(ideal(7, 'major'), 600);
  assert.strictEqual(k!.v, TK.KEY_LOGIC_VERSION);
  assert.strictEqual(k!.name, 'G');
  assert.strictEqual(k!.camelot, '9B');
  assert.strictEqual(k!.confidence, 1);
  assert.strictEqual(k!.familyConfidence, 1);
  assert.strictEqual(typeof k!.runnerUpRelated, 'boolean');
  assert.ok(Array.isArray(k!.related) && k!.related.length <= 2);

  for (const r of k!.related) {
    assert.ok(TK.relatedKey(K(k!.tonic, k!.mode), r));
    assert.ok(r.gap! >= 0 && r.gap! <= TK.KEY_RELATED_MARGIN);
    assert.strictEqual(r.name, TK.keyName(r.tonic, r.mode));
    assert.strictEqual(r.camelot, TK.camelot(r.tonic, r.mode));
  }

  const few = TK.summarizeKey(ideal(7, 'major'), 150);
  assert.strictEqual(few!.confidence, 0.25);
  assert.strictEqual(few!.familyConfidence, 0.25);
});

test('summarizeKey v2: a related runner-up halves the confidence the old margin / 0.1 would give', () => {
  for (const w of [0.3, 0.35, 0.4]) {
    const ch = mix(ideal(0, 'major'), ideal(9, 'minor'), w);
    const k = TK.summarizeKey(ch, 600);
    assert.strictEqual(k!.runnerUpRelated, true);
    const old = Math.min(1, k!.margin! / TK.KEY_FULL_MARGIN);
    assert.ok(Math.abs(k!.confidence - Math.min(1, k!.margin! / TK.KEY_RELATED_MARGIN)) <= 0.006, `w=${w}`);
    if (old < 1) assert.ok(k!.confidence <= old / 2 + 0.006);
    assert.ok(k!.familyConfidence >= 0.9, `family ${k!.familyConfidence}`);
    assert.ok(k!.related.some((r) => r.name === (k!.name === 'C' ? 'Am' : 'C')));
  }
});

test('summarizeKey v2: an unrelated runner-up keeps the v1 scale (margin / 0.1)', () => {
  let s = 7,
    found = 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

  for (let n = 0; n < 300; n++) {
    const ch = Array.from({ length: 12 }, () => rnd());
    const k = TK.summarizeKey(ch, 600);
    if (k!.runnerUpRelated) continue;
    found++;
    assert.ok(Math.abs(k!.confidence - Math.min(1, k!.margin! / TK.KEY_FULL_MARGIN)) <= 0.006);
    assert.ok(!k!.related.some((r) => r.name === k!.runnerUp));
  }

  assert.ok(found >= 10, `chroma with an unrelated runner-up: ${found}`);
});

test('summarizeKey v2 on stored chroma sums of real listens: related candidates listed, a small related margin drops below 0.5', () => {
  const ch = [407.72, 504.176, 477.392, 268.19, 553.139, 343.776, 530.375, 379.982, 506.345, 568.032, 314.705, 505.284];
  const k = TK.summarizeKey(ch, 860);
  assert.strictEqual(k!.name, 'A');
  assert.strictEqual(k!.runnerUp, 'F#m');
  assert.strictEqual(k!.runnerUpRelated, true);
  assert.ok(k!.confidence > 0.9); // known miss: margin 0.187 counts as clear
  assert.deepStrictEqual(
    k!.related.map((r) => r.name),
    ['F#m', 'D'],
  );
  const ch2 = [
    249.797, 512.089, 240.89, 286.978, 390.411, 286.377, 532.254, 286.494, 381.618, 391.46, 244.626, 336.003,
  ];
  const k2 = TK.summarizeKey(ch2, 766);
  assert.strictEqual(k2!.name, 'F#m');
  assert.strictEqual(k2!.runnerUp, 'C#m');
  assert.ok(k2!.confidence < TK.RELIABLE, `v2 ${k2!.confidence}`);
  assert.ok(k2!.familyConfidence >= TK.RELIABLE);
  assert.strictEqual(k2!.related[0].name, 'C#m');
});

test('currentKey: v1 keys are recomputed from the stored chroma, v2 keys are used as stored', () => {
  const ch = mix(ideal(0, 'major'), ideal(9, 'minor'), 0.35);
  const v1 = {
    tonic: 0,
    mode: 'major',
    name: 'C',
    camelot: '8B',
    r: 0.9,
    margin: 0.08,
    confidence: 0.8,
    runnerUp: 'Am',
  };
  const old = { logicVersion: TK.TEMPO_LOGIC_VERSION, chromaSum: ch, chromaFrames: 700, key: v1 };
  const k = TK.currentKey(old);
  assert.strictEqual(k!.v, TK.KEY_LOGIC_VERSION);
  assert.deepStrictEqual(k, TK.summarizeKey(ch, 700));
  const stored = Object.assign({}, old, { key: Object.assign({}, k, { confidence: 0.12345 }) });
  assert.strictEqual(TK.currentKey(stored)!.confidence, 0.12345);
  assert.strictEqual(TK.currentKey(null), null);
  assert.strictEqual(TK.currentKey({ key: v1 }), null);
  assert.strictEqual(TK.currentKey({ chromaSum: new Array(12).fill(0), chromaFrames: 10 }), null);
  assert.strictEqual(TK.currentKey({ chromaSum: ch, chromaFrames: 0 }), null);
});

test('mergeTempoKey writes v2 keys, and merging onto a v1 record recomputes from the summed chroma', () => {
  const c = ideal(9, 'minor').map((x) => x * 100);
  const a = TK.mergeTempoKey(null, { votes: [], chromaSum: c, chromaFrames: 300 }, 1);
  assert.strictEqual(a.key!.v, TK.KEY_LOGIC_VERSION);
  assert.strictEqual(a.key!.name, 'Am');
  const v1rec = Object.assign({}, a, { key: { name: 'Am', confidence: 0.9 } as unknown as KeySummary });
  const b = TK.mergeTempoKey(v1rec, { votes: [], chromaSum: c, chromaFrames: 300 }, 2);
  assert.strictEqual(b.key!.v, TK.KEY_LOGIC_VERSION);
  assert.strictEqual(b.chromaFrames, 600);
  assert.strictEqual(b.key!.confidence, TK.summarizeKey(b.chromaSum, 600)!.confidence);
});

test('tempoKeySummary: key fields from the current logic, related keys for ordering', () => {
  const ch = mix(ideal(0, 'major'), ideal(9, 'minor'), 0.35);
  const s = TK.tempoKeySummary({ tempo: null, chromaSum: ch, chromaFrames: 600, key: { name: 'C', confidence: 1 } });
  const k = TK.summarizeKey(ch, 600);
  assert.strictEqual(s!.key, k!.name);
  assert.strictEqual(s!.keyConfidence, k!.confidence);
  assert.strictEqual(s!.keyReliable, k!.confidence >= TK.RELIABLE);
  assert.strictEqual(s!.keyFamilyConfidence, k!.familyConfidence);
  assert.strictEqual(s!.keyFamilyReliable, true);
  assert.deepStrictEqual(
    s!.relatedKeys,
    k!.related.map((r) => ({ name: r.name, camelot: r.camelot })),
  );
  const none = TK.tempoKeySummary({ tempo: null, chromaSum: null, chromaFrames: 0, key: null });
  assert.strictEqual(none!.key, null);
  assert.deepStrictEqual(none!.relatedKeys, []);
});

test('rankKeys: 24 keys sorted, invalid chroma gives null', () => {
  const r = TK.rankKeys(ideal(3, 'minor'));
  assert.strictEqual(r!.length, 24);
  for (let i = 1; i < 24; i++) assert.ok(r![i - 1].r >= r![i].r);
  assert.deepStrictEqual([r![0].tonic, r![0].mode], [3, 'minor']);
  assert.strictEqual(TK.rankKeys([1, 2, 3]), null);
  assert.strictEqual(TK.rankKeys(new Array(12).fill(0)), null);
  assert.strictEqual(TK.rankKeys([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, NaN]), null);
});
