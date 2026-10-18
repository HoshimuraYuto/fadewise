import test from 'node:test';
import assert from 'node:assert';
import * as KeyCompat from '../shared/key-compat.mts';
import * as Reorder from '../shared/reorder.mts';
import * as Analysis from '../shared/analysis.mts';
import { createSim, entry, type Loose } from './helpers/player-sim.mts';

const KC: Loose = KeyCompat,
  R: Loose = Reorder,
  A: Loose = Analysis;

const CAMS: string[] = [];
for (let n = 1; n <= 12; n++) for (const l of ['A', 'B']) CAMS.push(n + l);

function expected(a: string, b: string) {
  const na = parseInt(a, 10),
    nb = parseInt(b, 10);
  const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  if (a.slice(-1) === b.slice(-1)) return { 0: 1, 1: 0.9, 2: 0.45, 5: 0.3 }[d] ?? 0;

  return { 0: 0.85, 1: 0.55 }[d] ?? 0;
}

test('camelotCompat: every one of the 24 x 24 pairs follows the table, symmetric; reorder and analysis use the same function', () => {
  let n = 0;

  for (const a of CAMS)
    for (const b of CAMS) {
      assert.strictEqual(KC.camelotCompat(a, b), expected(a, b), `${a} ${b}`);
      assert.strictEqual(KC.camelotCompat(a, b), KC.camelotCompat(b, a));
      n++;
    }

  assert.strictEqual(n, 576);
  assert.strictEqual(R.camelotCompat, KC.camelotCompat);
  assert.strictEqual(R.parseCamelot, KC.parseCamelot);
  for (const bad of [null, '', '13A', '0B', '8C', 8]) assert.strictEqual(KC.camelotCompat(bad, '8A'), null);
  assert.strictEqual(KC.camelotCompat(' 8a', '8A'), 1, 'case and spaces');
});

test('keyTerm: blended toward 0.5 by the lower confidence; unknown is 0.5; family mode takes the worst candidate', () => {
  const k = (cam: string | null, kc: number, fc?: number, rel?: string[]) => ({
    camelot: cam,
    keyConf: kc,
    famConf: fc || 0,
    related: rel || [],
  });
  assert.strictEqual(KC.keyTerm(k('8A', 1), k('8A', 1)), 1);
  assert.strictEqual(KC.keyTerm(k('8A', 1), k('2B', 1)), 0);
  assert.strictEqual(KC.keyTerm(k('8A', 0.6), k('8A', 1)), 0.6 * 1 + 0.4 * 0.5);
  assert.strictEqual(KC.keyTerm(k('8A', 0.6), k('3A', 0.9)), 0.6 * 0.3 + 0.4 * 0.5);
  assert.strictEqual(KC.keyTerm(k('8A', 0), k('2B', 0)), 0.5);
  assert.strictEqual(KC.keyTerm(null, k('8A', 1)), 0.5);
  assert.strictEqual(KC.keyTerm(k(null, 1), k('8A', 1)), 0.5);
  const fam = k('8A', 0.3, 0.8, ['9A']);

  const near = (x: number, y: number) => {
    assert.ok(Math.abs(x - y) < 1e-12, `${x} ${y}`);
  };

  near(
    KC.keyTerm(fam, k('7A', 1)),
    0.8 * Math.min(KC.camelotCompat('8A', '7A'), KC.camelotCompat('9A', '7A')) + 0.2 * 0.5,
  );
  near(KC.keyTerm(fam, k('7A', 1), { keyMode: 'exact' }), 0.3 * 0.9 + 0.7 * 0.5);
});

const edge = (cam: string, bpm: number, conf: number) => ({
  bpm,
  bc: conf,
  cam,
  kc: conf,
  fc: conf,
  rel: [],
  src: { key: 'segment', tempo: 'segment' },
  chg: { key: false, tempo: false },
});
const tkOf = (head: Loose | null, tail: Loose | null) => ({
  bpm: 120,
  bc: 0.9,
  cam: (tail || head)!.cam,
  kc: (tail || head)!.kc,
  fc: (tail || head)!.fc,
  rel: [],
  head,
  tail,
});
const entryOf = (tk: Loose | null, extra?: Loose) =>
  Object.assign(
    { d: 200, fs: 0.5, fx: true, h0: -12, l: -9, c: 0.8, tk, en: { kind: 'decays', lastSoundSec: 195, silenceSec: 5 } },
    extra || {},
  );
const mixCost = (a: Loose, b: Loose) =>
  A.planMix(
    Object.assign(
      { mx: { g: { bpm: null }, x: [{ t: 195, k: 'last', c: 1, e: -14, bpm: 120, key: null }], n: [] } },
      a,
    ),
    Object.assign(
      { mx: { g: { bpm: null }, x: [], n: [{ t: 0.5, k: 'first', c: 1, e: -14, bpm: 120, key: null }] } },
      b,
    ),
    { mode: 'gentle', now: 0 },
  ).cost;

test('ordering, transition choice and planMix: the same compatibility and the same confidence blend', () => {
  const pairs = [
    ['8A', '8A'],
    ['8A', '9A'],
    ['8A', '8B'],
    ['8A', '9B'],
    ['8A', '10A'],
    ['8A', '3A'],
    ['8A', '2B'],
  ];
  const baseCost = mixCost(entryOf(tkOf(null, edge('8A', 120, 1))), entryOf(tkOf(edge('8A', 120, 1), null)));

  for (const conf of [1, 0.7, 0.3])
    for (const [x, y] of pairs) {
      const a = entryOf(tkOf(edge('5B', 120, conf), edge(x, 120, conf))),
        b = entryOf(tkOf(edge(y, 120, conf), edge('5B', 120, conf)));
      const sa = R.summaryOf('a', a.tk, a),
        sb = R.summaryOf('b', b.tk, b);
      const want = conf * KC.camelotCompat(x, y) + (1 - conf) * 0.5;
      assert.ok(
        Math.abs(R.transitionScore(sa, sb, { wKey: 1, wTempo: 0, wFlow: 0 }) - want) < 1e-9,
        `order ${x}->${y} @${conf}`,
      );
      assert.strictEqual(R.chooseTransition(sa, sb, {}).relation.keyCompat, KC.camelotCompat(x, y));
      const d = mixCost(a, b) - baseCost;
      assert.ok(Math.abs(d - A.MIX.W.key * (1 - want)) < 2e-3, `mix ${x}->${y} @${conf}: ${d}`);
    }

  assert.strictEqual(A.MIX.W.key, 0.3, 'weight kept');
});

test('planMix key cost: a key stored only with a candidate counts as unknown (no confidence); unknown keys are 0.5', () => {
  const plain = { d: 200, fs: 0.5, en: { kind: 'decays', lastSoundSec: 195 } };
  const withKeys = (kx: string | null, kn: string | null) =>
    A.planMix(
      Object.assign(
        { mx: { g: { bpm: null }, x: [{ t: 195, k: 'last', c: 1, e: -14, bpm: 120, key: kx }], n: [] } },
        plain,
      ),
      Object.assign(
        { mx: { g: { bpm: null }, x: [], n: [{ t: 0.5, k: 'first', c: 1, e: -14, bpm: 120, key: kn }] } },
        plain,
      ),
      { mode: 'gentle', now: 0 },
    ).cost;
  assert.strictEqual(withKeys('8A', '2B'), withKeys(null, null));
  assert.strictEqual(withKeys('8A', '8A'), withKeys(null, null));
});

test('semitone (same letter, 5 steps): the mix pair cost now 0.7 at full confidence (was 1, the worst)', () => {
  const a = entryOf(tkOf(null, edge('8A', 120, 1))),
    b = entryOf(tkOf(edge('3A', 120, 1), null)),
    c = entryOf(tkOf(edge('2B', 120, 1), null));
  const same = mixCost(a, entryOf(tkOf(edge('8A', 120, 1), null)));
  assert.ok(Math.abs(mixCost(a, b) - same - 0.3 * 0.7) < 2e-3);
  assert.ok(Math.abs(mixCost(a, c) - same - 0.3 * 1) < 2e-3);
});

const tp = (e: Loose, pair: Loose | null) =>
  A.planTransition(e, { enabled: true, fadeOut: A.planFades(e).fadeOut, pair });

const pairFor = (x: string, y: string, bx = 120, by = 120, conf = 0.9) => {
  const a = entryOf(tkOf(edge('5B', bx, conf), edge(x, bx, conf))),
    b = entryOf(tkOf(edge(y, by, conf), edge('5B', by, conf)));

  return R.chooseTransition(R.summaryOf('a', a.tk, a), R.summaryOf('b', b.tk, b), {});
};

test('planOverlap: keys clash -> half the lead and a segue; keys agree or unknown -> as before', () => {
  const dec = entryOf(null);
  const ok = A.planOverlap(dec, tp(dec, pairFor('8A', '9A')), { enabled: true });
  assert.deepStrictEqual([ok.leadSec, ok.shape, ok.adapt], [3, 'equal', null]);
  const unk = A.planOverlap(dec, tp(dec, pairFor('8A', '2B', 120, 120, 0.3)), { enabled: true });
  assert.deepStrictEqual([unk.leadSec, unk.shape, unk.adapt], [3, 'equal', null], 'low confidence = unknown');
  const none = A.planOverlap(dec, tp(dec, null), { enabled: true });
  assert.deepStrictEqual([none.leadSec, none.shape], [3, 'equal']);
  const cl = A.planOverlap(dec, tp(dec, pairFor('8A', '3B')), { enabled: true });
  assert.deepStrictEqual([cl.leadSec, cl.shape, cl.why], [1.5, 'segue', 'segue']);
  assert.deepStrictEqual(cl.adapt, {
    why: 'key_clash',
    baseLeadSec: 3,
    baseShape: 'equal',
    cams: ['8A', '3B'],
    bpms: [120, 120],
  });
  assert.ok(Math.abs(cl.captureStartPos! - (cl.advanceAtPos! - 1.5 * 5)) < 1e-9, 'the window shrinks with the lead');
});

test('sim: the page plans the shorter segue for a clashing pair and runs ahead for that long; an agreeing pair as before', async () => {
  const run = async (camB: string) => {
    const tk = (cam: string) => ({ bpm: 120, bc: 0.9, cam, kc: 0.9, fc: 0.9, rel: [] });
    const sim = createSim({
      queue: ['A', 'B'],
      tracks: { A: { d: 100 }, B: { d: 120 } },
      index: { A: entry(100, 'decays', 95, { tk: tk('8A') }), B: entry(120, 'fades', 110, { tk: tk(camB) }) },
      settings: { overlap: true, overlapStyle: 'simple' },
    });
    await sim.start(70);
    await sim.run(1);
    const o = sim.status.fade.overlap;
    await sim.run(24);
    const dr = sim.ov!.posted.find((d) => d.ev === 'drain');

    return { o, tr: sim.status.fade && sim.status.fade.transition, lead: dr ? dr.leadOutSec : null, vid: sim.vid() };
  };

  const clash = await run('3B');
  assert.deepStrictEqual(
    [clash.o.leadSec, clash.o.shape, clash.o.adapt.why, clash.o.adapt.cams],
    [1.5, 'segue', 'key_clash', ['8A', '3B']],
  );
  assert.ok(clash.lead > 1.3 && clash.lead <= 1.55, `lead at the switch ${clash.lead}`);
  assert.strictEqual(clash.vid, 'B');
  const fit = await run('9A');
  assert.deepStrictEqual([fit.o.leadSec, fit.o.shape, fit.o.adapt], [3, 'equal', null]);
  assert.ok(fit.lead > 2.8, `lead at the switch ${fit.lead}`);
});

test('planOverlap: tempos far apart are treated the same; both -> one reason; the 1 s floor; a mix entry keeps equal power', () => {
  const dec = entryOf(null);
  const far = A.planOverlap(dec, tp(dec, pairFor('8A', '8A', 120, 95)), { enabled: true });
  assert.deepStrictEqual(
    [far.leadSec, far.shape, far.adapt!.why, far.adapt!.bpms],
    [1.5, 'segue', 'tempo_far', [120, 95]],
  );
  const near = A.planOverlap(dec, tp(dec, pairFor('8A', '8A', 120, 126)), { enabled: true });
  assert.strictEqual(near.adapt, null, 'near tempo: unchanged');
  const both = A.planOverlap(dec, tp(dec, pairFor('8A', '3B', 120, 95)), { enabled: true });
  assert.strictEqual(both.adapt!.why, 'both');
  const fades = entryOf(null, { en: { kind: 'fades', lastSoundSec: 195, silenceSec: 5, decaySec: 12 } });
  assert.strictEqual(A.planOverlap(fades, tp(fades, pairFor('8A', '3B')), { enabled: true }).leadSec, 3, '6 s -> 3 s');
  const stop = entryOf(null, { en: { kind: 'stop', lastSoundSec: 195, silenceSec: 5 } });
  const sp = A.planOverlap(stop, tp(stop, pairFor('8A', '3B')), { enabled: true });
  assert.deepStrictEqual([sp.leadSec, sp.adapt!.baseLeadSec, sp.basis!.covered], [1.6, 2, true], '2 s -> 1 s -> 1.6 s');
  const withEntry = tp(dec, pairFor('8A', '3B'));
  withEntry.mix = {
    mode: 'gentle',
    x: { k: 'last', t: 195, c: 1 },
    n: { k: 'thin', t: 12, c: 0.9 },
    exit: false,
    entry: true,
  };
  const me = A.planOverlap(dec, withEntry, { enabled: true });
  assert.deepStrictEqual([me.leadSec, me.shape], [1.5, A.MIX.fullEntryShape]);
});
