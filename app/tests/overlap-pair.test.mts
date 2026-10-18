import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import * as R from '../shared/reorder.mts';
import * as S from '../shared/settings.mts';
import { WINDOW_SEC } from '../ui/mix-text.mts';
import * as I from '../ui/i18n.mts';
import { overlapBasisText } from '../ui/mix-text.mts';
import type { IndexEntry } from '../shared/types.mts';
import { createSim, entry, type Loose } from './helpers/player-sim.mts';

const D = 200;
const fades = (decay: number) =>
  Object.assign(entry(D, 'fades', 195), {
    en: { kind: 'fades', lastSoundSec: 195, silenceSec: 5, fadeSec: null, decaySec: decay, endRelLu: null },
  }) as IndexEntry;
const tp = (e: IndexEntry, pair?: Loose | null) =>
  A.planTransition(e, { enabled: true, fadeOut: A.planFades(e).fadeOut, pair: pair || null });
const soft = { l: -10, c: 0.8, fs: 0.2, fx: true, h0: -25, d: 180 } as IndexEntry;
const plain = { l: -10, c: 0.8, fs: 0.2, fx: true, h0: -14, d: 180 } as IndexEntry;
const loud = { l: -10, c: 0.8, fs: 0.05, fx: true, h0: -9, d: 180 } as IndexEntry;
const intro = (t: number) =>
  Object.assign({}, plain, {
    mx: { g: { bpm: null }, x: [], n: [{ t, k: 'thin', c: 0.9, e: -1, bpm: null, key: null }] },
  }) as IndexEntry;
const edge = (cam: string, bpm: number) => ({
  bpm,
  bc: 0.9,
  cam,
  kc: 0.9,
  fc: 0.9,
  rel: [],
  src: { key: 'edge', tempo: 'edge' },
  chg: { key: false, tempo: false },
});

const pairFor = (x: string, y: string, bx = 120, by = 120) => {
  const a = Object.assign(fades(16), {
      tk: { bpm: bx, bc: 0.9, cam: x, kc: 0.9, fc: 0.9, rel: [], tail: edge(x, bx) },
    }) as unknown as IndexEntry,
    b = Object.assign({}, plain, {
      tk: { bpm: by, bc: 0.9, cam: y, kc: 0.9, fc: 0.9, rel: [], head: edge(y, by) },
    }) as unknown as IndexEntry;

  return R.chooseTransition(R.summaryOf('a', a.tk, a), R.summaryOf('b', b.tk, b), {});
};

const plan = (e: IndexEntry, next: IndexEntry | null, pair?: Loose | null, rate?: unknown) =>
  A.planOverlap(e, tp(e, pair), { enabled: true, next, rate });

test('length by pair: a long fade-out is capped by the next start (loud 3 s, plain 6 s, quiet intro, soft up to 10 s)', () => {
  const e = fades(16);
  const cases: [IndexEntry | null, number, string | null, string | null][] = [
    [soft, 8, null, 'soft'],
    [plain, 6, 'plain', null],
    [loud, 3, 'cut_in', null],
    [intro(4.2), 4, 'intro', null],
    [intro(12), 8, null, 'intro'],
    [null, 6, 'plain', null],
  ];

  for (const [next, lead, cap, long] of cases) {
    const p = plan(e, next);
    assert.deepStrictEqual(
      [p.on, p.leadSec, p.basis!.in, p.basis!.long],
      [true, lead, cap, long],
      JSON.stringify(next),
    );
    assert.strictEqual(p.basis!.out, 'fades');
    assert.strictEqual(p.basis!.outSec, 8);
  }

  const p = plan(fades(30), soft);
  assert.deepStrictEqual([p.leadSec, p.basis!.outSec], [10, 10]);
  assert.ok(Math.abs(p.captureStartPos! - (p.advanceAtPos! - 50)) < 1e-9, '10 s at 1.25x: a 50 s window');
});

test('length by pair: keys and tempos that agree lift a plain start; a clash halves it to a segue', () => {
  const e = fades(16);
  const agree = plan(e, plain, pairFor('8A', '8A'));
  assert.deepStrictEqual([agree.leadSec, agree.basis!.in, agree.basis!.long], [8, null, 'key_tempo']);
  const neighbour = plan(e, plain, pairFor('8A', '9A'));
  assert.deepStrictEqual([neighbour.leadSec, neighbour.basis!.long], [8, 'key_tempo'], 'a neighbouring key matches');
  const ok = plan(e, plain, pairFor('8A', '10A'));
  assert.deepStrictEqual([ok.leadSec, ok.basis!.in], [6, 'plain'], 'two steps apart is only "ok"');
  const tempoNear = plan(e, plain, pairFor('8A', '8A', 120, 128));
  assert.deepStrictEqual([tempoNear.leadSec, tempoNear.basis!.long], [8, 'key_tempo'], 'tempos within 8 %: lifted');
  const tempoFar = plan(e, plain, pairFor('8A', '8A', 120, 140));
  assert.deepStrictEqual([tempoFar.leadSec, tempoFar.adapt!.why], [3, 'tempo_far'], 'tempos far apart: halved');
  const clash = plan(e, soft, pairFor('8A', '3B'));
  assert.deepStrictEqual(
    [clash.leadSec, clash.shape, clash.adapt!.why, clash.adapt!.baseLeadSec],
    [4, 'segue', 'key_clash', 8],
  );
  const both = plan(e, loud, pairFor('8A', '3B'));
  assert.deepStrictEqual([both.leadSec, both.adapt!.baseLeadSec, both.basis!.covered], [1.55, 3, true]);
});

test('length by pair: a segue (cut / stop) is not capped by the next start; a short track is', () => {
  const stop = entry(D, 'stop', 190) as IndexEntry;
  assert.deepStrictEqual(
    [plan(stop, loud).leadSec, plan(stop, loud).shape, plan(stop, loud).basis!.in],
    [2, 'segue', null],
  );
  const shortT = Object.assign(fades(16), { d: 40 }) as IndexEntry;
  shortT.en = Object.assign({}, shortT.en, { lastSoundSec: 35, silenceSec: 5 });
  const p = plan(shortT, soft);
  assert.strictEqual(p.basis!.in, 'short');
  assert.ok(p.leadSec! < 8 && p.leadSec! >= 4.9, `short ${p.leadSec}`);
  const q = plan(shortT, soft, null, 1.5);
  assert.ok(q.leadSec! > p.leadSec!, `1.5x ${q.leadSec} > 1.25x ${p.leadSec}`);
});

test('lead rate: 1.25 and 1.5 are offered, anything else (2x was measured and left out) falls back to 1.25', () => {
  assert.deepStrictEqual([...A.OVERLAP.rates], [1.25, 1.5]);
  assert.deepStrictEqual([...S.LEAD_RATES], [...A.OVERLAP.rates]);
  const e = fades(16);
  const p = plan(e, soft, null, 1.5);
  assert.deepStrictEqual([p.rate, p.leadSec], [1.5, 8]);
  assert.ok(Math.abs(p.captureStartPos! - (p.advanceAtPos! - 24)) < 1e-9, '8 s at 1.5x: a 24 s window');
  assert.strictEqual(plan(e, soft, null, 2).rate, 1.25);
  assert.strictEqual(plan(e, soft, null, '1.5').rate, 1.25);
  assert.strictEqual(S.withDefaults({}).leadRate, 1.25);
  assert.strictEqual(S.withDefaults({ leadRate: 1.5 }).leadRate, 1.5);
  assert.strictEqual(S.withDefaults({ leadRate: 2 }).leadRate, 1.25, 'an unknown stored value falls back');
  assert.strictEqual(S.withDefaults(S.applyPreset({ leadRate: 1.5 }, 'off')).leadRate, 1.5);
  assert.strictEqual(S.withDefaults(S.toggleAll(S.toggleAll({ leadRate: 1.5 }))).leadRate, 1.5);
});

test('the pair window and the ring follow the 10 s maximum at the slowest rate', () => {
  assert.strictEqual(A.MIX.windowSec, 50);
  assert.strictEqual(WINDOW_SEC, String(A.MIX.windowSec), 'the words say the same window');
  assert.strictEqual(A.overlapWindowSec(10, 1.25), 50);
  assert.strictEqual(A.overlapWindowSec(10, 1.5), 30);
});

test('basis in words: the ending, then what of the next start limited or allowed it', () => {
  I.setLang('ja');
  assert.strictEqual(
    overlapBasisText({ out: 'fades', in: 'cut_in', long: null }),
    '前の曲がゆっくりフェードアウトする、次の曲は最初から大きな音で始まる',
  );
  assert.strictEqual(
    overlapBasisText({ out: 'fades', in: null, long: 'key_tempo' }),
    '前の曲がゆっくりフェードアウトする、キーとテンポが合うので長く重ねる',
  );
  I.setLang('en');
  assert.strictEqual(
    overlapBasisText({ out: 'decays', in: 'plain', long: null }),
    "the previous track ends with a short ring-out; kept shorter to fit the next track's start",
  );
  assert.strictEqual(overlapBasisText(null), null);

  for (const lang of ['ja', 'en'] as const) {
    I.setLang(lang);
    for (const k of ['fades', 'decays', 'abrupt', 'stop', 'mid', 'other'])
      assert.notStrictEqual(I.t('ovOut.' + k), 'ovOut.' + k, `${lang} ovOut.${k}`);
    for (const k of ['loud_entry', 'cut_in', 'intro', 'soft', 'plain', 'short'])
      assert.notStrictEqual(I.t('ovIn.' + k), 'ovIn.' + k, `${lang} ovIn.${k}`);
    for (const k of ['intro', 'soft', 'key_tempo'])
      assert.notStrictEqual(I.t('ovLong.' + k), 'ovLong.' + k, `${lang} ovLong.${k}`);
  }
});

interface OvStatus {
  leadSec: number;
  rate: number;
  basis: A.OverlapBasis;
}
const ovOf = (sim: { status: Loose }): OvStatus => (sim.status as { fade: { overlap: OvStatus } }).fade.overlap;

test('sim: the page passes the next track and the rate; 1.5x runs ahead at 1.5 for a soft-starting next track', async () => {
  const run = async (leadRate: number, next: Loose) => {
    const sim = createSim({
      queue: ['A', 'B'],
      tracks: { A: { d: D }, B: { d: 180 } },
      index: { A: fades(16), B: next },
      settings: { overlap: true, overlapStyle: 'simple', leadRate },
    });
    await sim.start(150);
    await sim.run(2);

    return sim;
  };

  const s1 = await run(1.25, soft);
  assert.deepStrictEqual([ovOf(s1).leadSec, ovOf(s1).rate], [8, 1.25]);
  assert.strictEqual(ovOf(s1).basis.long, 'soft');
  const s2 = await run(1.5, soft);
  assert.deepStrictEqual([ovOf(s2).leadSec, ovOf(s2).rate], [8, 1.5]);
  await s2.run(28);
  assert.strictEqual(s2.rate(), 1.5, 'running ahead at 1.5x');
  await s2.run(12);
  assert.strictEqual(s2.vid(), 'B');
  const dr = s2.ov!.posted.find((d) => d.ev === 'drain');
  assert.ok(dr && dr.leadOutSec > 7, `lead at the switch ${dr?.leadOutSec}`);
  const s3 = await run(1.25, loud);
  assert.deepStrictEqual([ovOf(s3).leadSec, ovOf(s3).basis.in], [3, 'cut_in']);
});
