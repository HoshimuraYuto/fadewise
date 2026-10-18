import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import * as S from '../shared/settings.mts';
import * as I from '../ui/i18n.mts';
import { overlapStyleText } from '../ui/mix-text.mts';
import { seekbarMarks } from '../shared/seekbar-marks.mts';
import type { IndexEntry } from '../shared/types.mts';
import { entry, type Loose } from './helpers/player-sim.mts';

const D = 200;
const ending = (kind: string, decay: number) =>
  Object.assign(entry(D, kind, 195), {
    en: {
      kind,
      lastSoundSec: 195,
      silenceSec: 5,
      fadeSec: kind === 'abrupt' ? 2 : null,
      decaySec: decay,
      endRelLu: -2,
    },
  }) as IndexEntry;
const plain = { l: -10, c: 0.8, fs: 0.2, fx: true, h0: -14, d: 180 } as IndexEntry;
const withThin = (t: number) =>
  Object.assign({}, plain, {
    mx: { g: { bpm: null }, x: [], n: [{ t, k: 'thin', c: 0.9, e: -1, bpm: null, key: null }] },
  }) as IndexEntry;
const pair = (tempo: string, key = 'ok', bpms: number[] = [120, 122]) => ({
  relation: { tempo, key, cams: ['8A', '9A'], bpms },
});
const tp = (e: IndexEntry, pr?: Loose | null) =>
  A.planTransition(e, { enabled: true, fadeOut: A.planFades(e).fadeOut, pair: pr ?? null });
const plan = (e: IndexEntry, next: IndexEntry | null, pr?: Loose | null, style: unknown = 'auto') =>
  A.planOverlap(e, tp(e, pr), { enabled: true, next, style, fadeOut: A.planFades(e).fadeOut });
const heard = (p: A.OverlapPlan) => (p.leadSec ?? 0) - (p.basis?.waitSec ?? 0);

test('style: tempos far apart or unknown -> over the quiet ending, equal-power crossfade, bass swapped halfway', () => {
  for (const [pr, why] of [
    [pair('far', 'ok', [144, 173]), 'tempo_far'],
    [null, 'tempo_unknown'],
    [pair('near', 'clash'), 'key_clash'],
  ] as const) {
    const p = plan(ending('decays', 2), plain, pr);
    assert.strictEqual(p.style?.kind, 'tail', why);
    assert.strictEqual(p.style.why, why);
    assert.deepStrictEqual([p.style.curve, p.style.bass, p.style.hpNew, p.style.hpOld], ['equal', true, false, false]);
    assert.strictEqual(p.style.swapAt, 0.5);
    assert.ok(Math.abs(heard(p) - 4) < 0.01, `heard ${heard(p)}`);
  }

  const f = plan(ending('fades', 12), plain, pair('far'));
  assert.ok(Math.abs(heard(f) - 8) < 0.01, `fade ${heard(f)}`);
  const f2 = plan(ending('fades', 5), plain, pair('far'));
  assert.ok(Math.abs(heard(f2) - 5) < 0.01);
});

test('style: close tempos (match / near, also double or half) -> both loud, filters open and close, 4-8 s in bars', () => {
  const p = plan(ending('decays', 0), plain, pair('near', 'ok', [120, 124]));
  const s = p.style!;
  assert.deepStrictEqual(
    [s.kind, s.why, s.curve, s.bass, s.hpNew, s.hpOld],
    ['blend', 'tempo_close', 'overlap', true, true, true],
  );
  assert.ok([4, 8].includes(heard(p)), `heard ${heard(p)}`);
  assert.strictEqual(s.bars, heard(p) / 2);
  assert.deepStrictEqual(A.blendBars(99), { sec: 4.85, bars: 2 });
  assert.deepStrictEqual(A.blendBars(173), { sec: 5.55, bars: 4 });
  assert.deepStrictEqual(A.blendBars(null), { sec: 6, bars: null });
  const m = plan(ending('decays', 0), plain, pair('match', 'match', [99, 100]));
  assert.strictEqual(m.style?.kind, 'blend');
});

test("style: the bass swap lines up with the end of the old track's loud part and the start of the next one's", () => {
  const old = ending('decays', 2.5);
  const both = plan(old, withThin(3.2), pair('near'));
  const at = both.advanceAtPos!,
    left = +(Math.min(at, 195.3) - 192.5).toFixed(2);
  assert.strictEqual(both.style?.aligned, 'both');
  assert.strictEqual(both.style.swapLeftSec, left);
  assert.ok(Math.abs(heard(both) - (left + 3)) < 0.02, `both ${heard(both)}`);
  assert.strictEqual(both.style.swapPos, +(at - left).toFixed(2));
  const o = plan(old, plain, pair('near'));
  assert.strictEqual(o.style?.aligned, 'old');
  assert.ok(Math.abs(heard(o) - Math.max(4, 2 * left)) < 0.02);
  const n = plan(ending('decays', 0), withThin(3.2), pair('near'));
  assert.strictEqual(n.style?.aligned, 'new');
  assert.strictEqual(n.style.swapInSec, 3);
});

test('style: a cut or a stop -> segue (the old track fades under the next one), bass swapped halfway', () => {
  const c = plan(ending('abrupt', 0.2), plain, pair('near'));
  assert.deepStrictEqual([c.style?.kind, c.style?.why, c.style?.curve, c.shape], ['segue', 'cut', 'segue', 'segue']);
  const s = plan(ending('stop', 0.2), plain, pair('far'));
  assert.deepStrictEqual([s.style?.kind, s.style?.why], ['segue', 'stop']);
});

test("style: the lead covers the wait for the next track's first sound, stays within 10 s and the track's room", () => {
  const head = Object.assign({}, plain, { fs: 2.96, fx: true }) as IndexEntry;
  const p = plan(ending('stop', 0.2), head, pair('far'));
  assert.ok(p.basis?.waitSec && p.basis.waitSec > 1.5);
  assert.ok(heard(p) >= 2 - 1e-9, `heard after the wait ${heard(p)}`);
  const long = plan(ending('fades', 30), head, pair('far'));
  assert.ok((long.leadSec ?? 0) <= A.OVERLAP.maxLeadSec);
  const short = Object.assign(ending('fades', 12), { d: 22 }) as IndexEntry;
  short.en = Object.assign({}, short.en, { lastSoundSec: 20 });
  const sp = plan(short, plain, pair('far'));
  assert.ok(!sp.on || (sp.leadSec ?? 0) <= A.overlapLeadFrom(A.OVERLAP.minStartSec, sp.advanceAtPos, sp.rate) + 0.01);
});

test("style: 'simple' (and no style) plans exactly as before", () => {
  const e = ending('decays', 2);

  for (const pr of [null, pair('far'), pair('near', 'match')]) {
    const simple = plan(e, plain, pr, 'simple'),
      none = A.planOverlap(e, tp(e, pr), { enabled: true, next: plain, fadeOut: A.planFades(e).fadeOut });
    assert.deepStrictEqual(simple, none);
    assert.ok(!simple.style);
  }
});

test('style text: plain words in both languages, numbers only, no unknown codes', () => {
  I.setLang('ja');
  const p = plan(ending('decays', 2), plain, pair('far', 'ok', [144, 173]));
  assert.strictEqual(
    overlapStyleText(p.style),
    'テンポが離れているので、前の曲の余韻やフェードに重ね、途中で低音を入れ替える（144 → 173 BPM）',
  );
  const b = plan(ending('decays', 2.5), withThin(3.2), pair('near', 'ok', [110, 116]));
  assert.match(
    overlapStyleText(b.style) ?? '',
    /^テンポが近いので、2 曲とも大きいまま重ね、前の曲の盛り上がりが終わり/,
  );
  I.setLang('en');
  assert.strictEqual(
    overlapStyleText(p.style),
    "tempos far apart, so blended over the previous track's fade or ring-out, with the bass swapped partway (144 → 173 BPM)",
  );
  assert.strictEqual(overlapStyleText({ kind: 'nope' }), null);
  assert.strictEqual(overlapStyleText(null), null);
});

test('seek bar: the bass swap is a point at its planned song position, inside the overlap band', () => {
  const p = plan(ending('decays', 2.5), withThin(3.2), pair('near'));
  const ovs = {
    leadStartPos: 150,
    leadEndPos: 189,
    overlapStartPos: 189,
    overlapEndPos: 195.3,
    style: p.style,
    swapPos: p.style?.swapPos,
    state: 'planned',
  };
  const m = seekbarMarks({ marks: { dur: D }, overlap: ovs });
  const sw = m.items.find((x) => x.kind === 'swap');
  assert.ok(sw && sw.at === p.style?.swapPos, JSON.stringify(m.items.map((x) => x.kind)));
  const ov = m.items.find((x) => x.kind === 'overlap');
  assert.strictEqual(ov?.info?.style?.kind, 'blend');
});

test('setting: overlapStyle is auto unless simple is stored; unknown values fall back; presets leave it', () => {
  assert.strictEqual(S.withDefaults({}).overlapStyle, 'auto');
  assert.strictEqual(S.withDefaults({ overlapStyle: 'simple' }).overlapStyle, 'simple');
  assert.strictEqual(S.withDefaults({ overlapStyle: 'loud' }).overlapStyle, 'auto');
  assert.strictEqual(S.withDefaults(S.applyPreset({ overlapStyle: 'simple' }, 'off')).overlapStyle, 'simple');
  assert.strictEqual(S.DEFAULTS.overlap, false, 'overlapping itself stays off by default');
});
