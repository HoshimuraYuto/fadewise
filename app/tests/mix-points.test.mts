import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../shared/mix-points.mts';
import * as F from '../shared/mix-features.mts';
import * as A from '../shared/analysis.mts';
import * as S from '../shared/settings.mts';
import type { Bar } from '../shared/mix-features.mts';
import type { IndexEntry, MixCandidate, MixKind, MixRecord } from '../shared/types.mts';

const bar = (t: number, lu: number, low = 0.5, mel = 0.1, cr: number[] | null = null): Bar => ({
  t,
  t1: t + 2,
  lu,
  low,
  high: 0.05,
  on: 1,
  cr,
  mel,
  obs: 1,
});

const song = (spec: [number, number, number?, number?][]) => {
  const out: Bar[] = [];
  let t = 1;

  for (const [n, lu, low, mel] of spec)
    for (let i = 0; i < n; i++) {
      out.push(bar(t, lu, low, mel));
      t += 2;
    }

  return out;
};

test('gentle entry skips a thin intro and lands on the bar line', () => {
  const e = M.gentleEntry(
    song([
      [4, -16, 0, 0.05],
      [40, -1, 0.5, 0.1],
    ]),
    -0.5,
    1.0,
  );
  assert.equal(e.k, 'thin');
  assert.equal(e.t, 9);
});

test('gentle entry keeps an intro with a melody, does not skip past the cap, nothing when full from the start', () => {
  const mel = M.gentleEntry(
    song([
      [4, -10, 0, 0.5],
      [40, -1, 0.5, 0.1],
    ]),
    -0.5,
    1.0,
  );
  assert.deepEqual([mel.k, mel.why], ['first', 'melody']);
  const long = M.gentleEntry(
    song([
      [12, -16, 0, 0.05],
      [40, -1, 0.5, 0.1],
    ]),
    -0.5,
    1.0,
  );
  assert.deepEqual([long.k, long.why], ['first', 'too_long']);
  assert.equal(M.gentleEntry(song([[40, -1, 0.5, 0.1]]), -0.5, 1.0).k, 'first');
});

test('gentle exit cuts a quiet outro, not a hard ending or a short ring-out; a loud bar inside moves the cut after it', () => {
  const fade = song([
    [40, -1],
    [2, -6],
    [2, -10],
    [2, -14],
    [2, -20],
  ]);
  const x = M.gentleExit(fade, -0.5, fade[fade.length - 1].t1);
  assert.equal(x.k, 'fade');
  assert.equal(x.t, fade[41].t1);
  const hard = song([[40, -1]]);
  assert.equal(M.gentleExit(hard, -0.5, hard[hard.length - 1].t1).k, 'last');
  const ring = song([
    [40, -1],
    [1, -40],
    [2, -70],
  ]);
  assert.equal(M.gentleExit(ring, -0.5, ring[40].t1).k, 'last');
  const b = song([
    [40, -1],
    [3, -12],
    [1, -2],
    [3, -14],
  ]);
  const x2 = M.gentleExit(b, -0.5, b[b.length - 1].t1);
  assert.deepEqual([x2.k, x2.t], ['fade', b[43].t1]);
  assert.equal(M.GENTLE.exitLu, 8);
});

test('aggressive finds the first and the last chorus of a verse/chorus song', () => {
  const cv = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    cc = [0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    ci = [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0];
  const seq: [string, number][] = [
    ['i', 4],
    ['v', 8],
    ['c', 8],
    ['v', 8],
    ['c', 8],
    ['c', 8],
    ['o', 6],
  ];
  const bars: Bar[] = [];
  let t = 1;

  for (const [s, n] of seq)
    for (let i = 0; i < n; i++) {
      const cr = (s === 'v' ? cv : s === 'c' ? cc : ci).map((x, k) => x + 0.05 * ((i + k) % 3));
      bars.push(bar(t, s === 'c' ? 0 : s === 'v' ? -5 : -12, s === 'i' || s === 'o' ? 0.1 : 0.5, 0.1, cr));
      t += 2;
    }

  const r = M.aggressive(bars, -2, 1, bars[bars.length - 1].t1);
  assert.equal(r.entry && r.entry.t, bars[12].t);
  assert.equal(r.exit && r.exit.t, bars[43].t1);
});

test('bar grid: refinePhase recovers a beat phase from a flux comb and barGrid picks the chroma-change beat', () => {
  const P = 0.5,
    ph = 0.23,
    dur = 60,
    frames = [];

  for (let i = 0; i < dur * 10; i++) {
    const ct = (i + 0.5) / 10;
    const fx = [];

    for (let k = 0; k < 10; k++) {
      const tt = ct - 0.05 + k / 100;
      const d = (((tt - ph) % P) + P) % P;
      fx.push(d < 0.01 ? 1 : 0.02);
    }

    const barNo = Math.floor((ct - 0.3 - ph - P) / (4 * P));
    const cr = new Array(12).fill(0.01);
    cr[(barNo * 5 + 120) % 12] = 1;
    frames.push({ ct, e: 0.01, bd: [1, 1, 0.1, 1000], cr, fx });
  }

  const Sx = F.framesToSeries(frames, dur);
  const rp = F.refinePhase(Sx, 120.3, 0.1);
  assert.ok(Math.abs(rp.phase - ph) < 0.02, `phase ${rp.phase}`);
  const g = F.barGrid(Sx, 120, ph, dur);
  assert.ok(Math.abs((((g.bar0 - (ph + P)) % 2) + 2) % 2) < 0.02, `bar0 ${g.bar0}`);
  assert.equal(F.barLines(g, dur).length, 30);
});

function pageRows(from: number, to: number) {
  const rows: number[][] = [];

  for (let i = Math.round(from * 10); i < Math.round(to * 10); i++) {
    const ct = (i + 0.5) / 10;
    const lu = ct < 1 ? -120 : ct < 17 ? -30 : ct < 178 ? -10 : ct < 198 ? -22 : -120;
    const low = ct >= 17 && ct < 178 ? 0.4 : 0.02;
    const barNo = Math.floor((ct - 1) / 2);
    const cr = new Array<number>(12).fill(1);
    cr[(barNo * 7) % 12] = 99;
    rows.push([+ct.toFixed(2), lu, low, 0.05].concat(lu > -100 ? cr : []));
  }

  return rows;
}

const flux = (from: number, to: number) => {
  const f: number[] = [];
  for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) f.push(i % 50 === 0 ? 1 : 0.01);

  return [{ start: from, flux: f }];
};

const rec = (over?: object) =>
  Object.assign({ durationSec: 200, tempoKey: { tempo: { bpm: 120, confidence: 0.8, phaseSec: 0 } } }, over || {});

test('mixAfterListen: head + tail only gives the gentle candidates (thin, fade), small, and no aggressive ones', () => {
  const rows = pageRows(0, 60).concat(pageRows(140, 200));
  const mix = M.mixAfterListen(null, { f: rows }, flux(0, 60).concat(flux(140, 200)), rec(), {
    head: { bpm: 120, cam: '8A' },
    tail: { bpm: 120, cam: '8A' },
  });
  assert.ok(mix && mix.v === 1, JSON.stringify(mix));
  const d = A.mixOf(mix);
  assert.deepEqual(
    d!.n.map((c) => c.k),
    ['first', 'thin'],
  );
  assert.deepEqual(d!.x.map((c) => c.k).sort(), ['fade', 'last']);
  const thin = d!.n.find((c) => c.k === 'thin'),
    fade = d!.x.find((c) => c.k === 'fade');
  assert.ok(thin!.t >= 16 && thin!.t <= 18, `thin ${thin!.t}`);
  assert.ok(fade!.t >= 177 && fade!.t <= 179, `fade ${fade!.t}`);
  assert.equal(thin!.key, '8A');
  assert.deepEqual(mix.h, [1, 1, 0]);
  assert.ok(JSON.stringify(mix).length < 300, `${JSON.stringify(mix).length} bytes`);
});

test('mixAfterListen: a side not heard keeps the stored candidates; a partial listen keeps the stored aggressive ones', () => {
  const full: MixRecord = {
    v: 1,
    g: [120, 1, 0.5],
    x: [
      [178, 4, 1, -12],
      [180, 5, 0.7, 0],
      [198, 3, 1, -20],
    ],
    n: [
      [1, 0, 1, -20],
      [17, 1, 1, 0],
      [41, 2, 0.65, 1],
    ],
    h: [1, 1, 1],
  };
  const headOnly = M.mixAfterListen(full, { f: pageRows(0, 60) }, flux(0, 60), rec(), null);
  const d = A.mixOf(headOnly);
  assert.ok(d!.x.some((c) => c.k === 'fade') && d!.x.some((c) => c.k === 'chorusEnd'), 'exits kept (tail not heard)');
  assert.ok(
    d!.n.some((c) => c.k === 'lift'),
    'aggressive entry kept',
  );
  assert.equal(headOnly!.h[2], 1);
  const neu = { v: 1, g: [120, 1, 0.5], x: [[198, 3, 1, -20]], n: [[1, 0, 1, -20]], h: [1, 1, 1] };
  const m = M.mergeMix(full, neu);
  assert.ok(!m!.x.some((r) => r[1] === 5) && !m!.n.some((r) => r[1] === 2));
  assert.equal(M.mixAfterListen(full, null, null, rec(), null), full, 'no rows: the stored one');
  assert.equal(M.mixAfterListen(full, { f: [['x']] }, null, rec(), null), full, 'garbage: the stored one');
});

test('mixAfterListen: the whole song heard once gives aggressive candidates only from a full listen', () => {
  const mix = M.mixAfterListen(null, { f: pageRows(0, 200) }, flux(0, 200), rec(), null);
  assert.deepEqual(mix!.h, [1, 1, 1]);
  const part = M.mixAfterListen(null, { f: pageRows(0, 120) }, flux(0, 120), rec(), null);
  assert.equal(part!.h[2], 0);
  assert.ok(!part!.n.some((r) => r[1] === 2) && !part!.x.some((r) => r[1] === 5));
});

test('indexEntryOf carries the decoded candidates (mx); a bad or other-version record.mix is ignored', () => {
  const base = Object.assign(A.emptyRecord('v1'), { durationSec: 200 });
  const e = A.indexEntryOf(
    Object.assign({}, base, {
      mix: { v: 1, g: [120, 1, 0.5], x: [[178, 4, 1, -12]], n: [[17, 1, 0.9, 0, 120, '8A']], h: [1, 1, 0] },
    }),
  );
  assert.deepEqual(e!.mx!.n[0], { t: 17, k: 'thin', c: 0.9, e: 0, bpm: 120, key: '8A' });
  assert.equal(A.indexEntryOf(Object.assign({}, base, { mix: { v: 2, x: [], n: [] } }))!.mx, undefined);
  assert.equal(A.indexEntryOf(Object.assign({}, base, { mix: { v: 1, x: [[1, 99]], n: [] } }))!.mx, undefined);
  assert.equal(A.indexEntryOf(base)!.mx, undefined);
});

const cand = (t: number, k: MixKind, c: number, e: number, bpm = 120, key = '8A'): MixCandidate => ({
  t,
  k,
  c,
  e,
  bpm,
  key,
});
const cur = (x: MixCandidate[], d = 200) => ({ d, mx: { x, n: [] } }) as IndexEntry;
const nxt = (n: MixCandidate[], d = 200) => ({ d, mx: { x: [], n } }) as IndexEntry;
const pick = (r: ReturnType<typeof A.planMix>) => r as A.MixPick & { none?: string };
const X = [cand(198, 'last', 1, -14), cand(178, 'fade', 0.9, -1), cand(160, 'chorusEnd', 0.4, 0)];
const N = [cand(0.5, 'first', 1, -14), cand(12, 'thin', 0.9, -1), cand(40, 'lift', 0.9, 1)];

test('planMix by mode: gentle never uses lift / chorusEnd; auto only from 0.6; aggressive may', () => {
  const g = pick(A.planMix(cur(X), nxt(N), { mode: 'gentle', now: 0 }));
  assert.ok(['fade', 'last'].includes(g.x.k) && ['first', 'thin'].includes(g.n.k));
  const au = pick(A.planMix(cur(X), nxt(N), { mode: 'auto', now: 0 }));
  assert.notEqual(au.x.k, 'chorusEnd');
  const ag = pick(
    A.planMix(cur([cand(160, 'chorusEnd', 0.9, 0)]), nxt([cand(40, 'lift', 0.9, -4)]), {
      mode: 'aggressive',
      now: 0,
    }),
  );
  assert.deepEqual([ag.x.k, ag.n.k], ['chorusEnd', 'lift']);
  const au2 = pick(
    A.planMix(cur([cand(160, 'chorusEnd', 0.9, 0)]), nxt([cand(40, 'lift', 0.9, -4)]), {
      mode: 'auto',
      now: 0,
    }),
  );
  assert.deepEqual([au2.x.k, au2.n.k], ['chorusEnd', 'lift'], 'auto takes confident aggressive points');
  assert.equal(
    pick(A.planMix(cur([cand(160, 'chorusEnd', 0.5, 0)]), nxt([cand(40, 'lift', 0.9, -4)]), { mode: 'auto', now: 0 }))
      .none,
    'no_exit',
  );
  const far = pick(
    A.planMix(
      cur([cand(160, 'chorusEnd', 0.9, 0, 120), cand(198, 'last', 1, -14, 120)]),
      nxt([cand(40, 'lift', 0.9, -4, 140), cand(0.5, 'first', 1, -14, 140)]),
      { mode: 'aggressive', now: 0 },
    ),
  );
  assert.deepEqual([far.x.k, far.n.k], ['last', 'first']);
});

test("planMix window: an exit whose 50 s window has begun is not chosen; no pair without both tracks' candidates", () => {
  assert.equal(A.MIX.windowSec, 50, '10 s lead at 1.25x');
  assert.equal(
    (pick(A.planMix(cur(X), nxt(N), { mode: 'gentle', now: 120 })).x.k as string | undefined) !== undefined,
    true,
  );
  const late = pick(A.planMix(cur(X), nxt(N), { mode: 'gentle', now: 140 }));
  assert.equal(late.x.k, 'last', 'the fade exit (178) is inside its window at 140');
  assert.equal(pick(A.planMix(cur(X), nxt(N), { mode: 'gentle', now: 150 })).none, 'window');
  assert.equal(pick(A.planMix(cur(X), null, { mode: 'gentle' })).none, 'no_entry');
  assert.equal(
    pick(A.planMix(cur(X), { d: 200, fs: 0.4 }, { mode: 'gentle', now: 0 })).n.t,
    0.4,
    'a known next track without candidates: its first sound',
  );
  assert.equal(pick(A.planMix({ d: 200 }, nxt(N), { mode: 'gentle' })).none, 'no_exit');
  assert.equal(
    pick(A.planMix(cur(X), nxt(N), { mode: 'gentle', now: 0, midExit: false })).x.k,
    'last',
    'no fade and no overlap: no cut inside the music',
  );
});

test('planMix: a different next track gives a different pair (chosen again per pair)', () => {
  const quietIn = nxt([cand(0.5, 'first', 1, -14)]);
  const loudIn = nxt([cand(0.5, 'first', 1, -1), cand(12, 'thin', 0.9, -1)]);
  const a = pick(A.planMix(cur(X), quietIn, { mode: 'gentle', now: 0 })),
    b = pick(A.planMix(cur(X), loudIn, { mode: 'gentle', now: 0 }));
  assert.notDeepEqual([a.x.k, a.n.k], [b.x.k, b.n.k]);
});

test('planTransition with a mix pair: the exit becomes the advance point (with its fade-out), the entry rides along', () => {
  const e: IndexEntry = {
    l: -10,
    c: 0.8,
    p: -1,
    fs: 0.5,
    fx: true,
    d: 200,
    en: { kind: 'fades' as const, lastSoundSec: 198, silenceSec: 2, decaySec: 20 },
  };
  const pair = { mode: 'gentle', cost: 0.5, x: cand(178, 'fade', 0.9, -1), n: cand(12, 'thin', 0.9, -1), nextVid: 'B' };
  const fo = A.mixFadeOut(pair.x);
  assert.deepEqual([fo.startPos, fo.endPos], [176, 178]);
  const p = A.planTransition(e, { enabled: true, fadeOut: fo, mix: pair });
  assert.deepEqual(
    [p.kind, p.advanceAtPos, p.skipSec, p.mix!.exit, p.mix!.entry, p.mix!.n.t, p.mix!.nextVid],
    ['fade_trim', 178, 22, true, true, 12, 'B'],
  );
  const cut = A.planTransition(e, { enabled: true, fadeOut: null, mix: pair });
  assert.equal(cut.kind, 'trim');
  const plain = A.planTransition(e, {
    enabled: true,
    fadeOut: null,
    mix: { mode: 'gentle', x: cand(198, 'last', 1, -14), n: cand(0.5, 'first', 1, -14) },
  });
  assert.deepEqual([plain.advanceAtPos, plain.mix!.exit, plain.mix!.entry], [198.2, false, false]);
  assert.equal(A.planTransition(e, { enabled: false, mix: pair }).kind, 'none');
  assert.equal(A.mixEntryOf({ n: cand(2.5, 'thin', 1, 0) }), null);
});

test('planOverlap with a mix pair: a mid-track exit crossfades over 3 s; a thin entry is equal power (not a segue)', () => {
  const ab = { d: 200, en: { kind: 'abrupt' as const, lastSoundSec: 199.9, silenceSec: 0.1, fadeSec: 3 } };
  const pair = { mode: 'gentle' as const, x: cand(178, 'fade', 0.9, -1), n: cand(12, 'thin', 0.9, -1) };
  const fo = A.mixFadeOut(pair.x);
  const tp = A.planTransition(ab, { enabled: true, fadeOut: fo, mix: pair });
  const o = A.planOverlap(ab, tp, { enabled: true, fadeOut: fo });
  assert.deepEqual([o.on, o.shape, o.leadSec, o.advanceAtPos], [true, 'equal', 3, 178]);
  const ab2 = { d: 200, en: { kind: 'abrupt' as const, lastSoundSec: 199, silenceSec: 1, fadeSec: 3 } };
  const fo2 = A.planFades(ab2).fadeOut;
  assert.equal(
    A.planOverlap(ab2, A.planTransition(ab2, { enabled: true, fadeOut: fo2 }), { enabled: true, fadeOut: fo2 }).shape,
    'segue',
  );
  const onlyIn = A.planTransition(ab2, {
    enabled: true,
    fadeOut: fo2,
    mix: { mode: 'gentle', x: cand(199, 'last', 1, 0), n: cand(12, 'thin', 0.9, -1) },
  });
  assert.deepEqual([onlyIn.mix!.exit, onlyIn.mix!.entry], [false, true]);
  assert.equal(A.planOverlap(ab2, onlyIn, { enabled: true, fadeOut: fo2 }).shape, A.MIX.fullEntryShape);
  assert.equal(A.MIX.fullEntryShape, 'equal');
});

test('setting mixPoints: default gentle, unknown values fall back, presets leave it as it is', () => {
  assert.equal(S.withDefaults(null).mixPoints, 'gentle');
  assert.equal(S.withDefaults({ mixPoints: 'aggressive' }).mixPoints, 'aggressive');
  assert.equal(S.withDefaults({ mixPoints: 'wild' }).mixPoints, 'gentle');
  assert.ok(!(S.PRESET_KEYS as string[]).includes('mixPoints'));
  assert.equal(S.applyPreset({ mixPoints: 'auto' }, 'off').mixPoints, 'auto');
  assert.deepEqual(S.MIX_POINTS, A.MIX.modes);
  assert.deepEqual(M.MIX_KINDS, A.MIX.kinds);
});

test('sanitizeApplied keeps the mix codes of a transition and drops unknown ones', () => {
  const a = A.sanitizeApplied({
    at: 1,
    transition: { kind: 'trim', mix: { mode: 'auto', x: 'fade', n: 'thin', xSec: 178.123, nSec: 12 } },
    incoming: { headReason: 'mix_thin' },
  });
  assert.deepEqual(a!.transition!.mix, { mode: 'auto', x: 'fade', n: 'thin', xSec: 178.12, nSec: 12 });
  assert.equal(a!.incoming!.headReason, 'mix_thin');
  assert.equal(
    A.sanitizeApplied({ at: 1, transition: { kind: 'trim', mix: { mode: 'x', x: 'y' } } })!.transition!.mix!.mode,
    null,
  );
});
