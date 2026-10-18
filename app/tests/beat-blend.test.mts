import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import * as I from '../ui/i18n.mts';
import { overlapStyleText } from '../ui/mix-text.mts';
import { seekbarMarks } from '../shared/seekbar-marks.mts';
import { switchesText } from '../ui/common.mts';
import type { BeatInfo, IndexEntry } from '../shared/types.mts';

const P = 0.5;

// a grid window [bpm, sec, anchor, period, rms, end], 30 s long
const win = (end: number, ph: number, rms = 8, per = P): number[] => {
  const k = Math.floor((end - ph) / per);

  return [60 / per, 30, ph + k * per, per, rms, end];
};

const bt = (grids: number[][], conf = 1): BeatInfo => ({ bpm: 120, conf, alt: [], ph: 0.1, grids });
const oldTrack = (grids = [win(150, 0.1), win(180, 0.1), win(193, 0.1)]) =>
  ({
    l: -10,
    c: 0.9,
    fs: 0.1,
    fx: true,
    d: 195,
    en: { kind: 'decays', lastSoundSec: 193, silenceSec: 2, fadeSec: null, decaySec: 2, endRelLu: -2 },
    bt: bt(grids),
  }) as IndexEntry;
const nextTrack = (fs = 3, grids = [win(33, 0.3), win(63, 0.3)]) =>
  ({ l: -10, c: 0.9, fs, fx: true, h0: -14, d: 180, bt: bt(grids) }) as IndexEntry;
const wrap = (d: number, p: number) => ((((d + p / 2) % p) + p) % p) - p / 2;

test('beat grids: only steady edges whose window agrees with its neighbour qualify', () => {
  assert.strictEqual(A.beatAlignOf(oldTrack(), nextTrack(), undefined).why, 'grids');
  assert.strictEqual(
    A.beatAlignOf(oldTrack([win(180, 0.1), win(193, 0.1, 25)]), nextTrack(), undefined).why,
    'old_unsteady',
  );
  assert.strictEqual(
    A.beatAlignOf(oldTrack([win(180, 0.1), win(193, 0.225)]), nextTrack(), undefined).why,
    'old_unsteady',
  );
  assert.strictEqual(
    A.beatAlignOf(oldTrack(), nextTrack(3, [win(33, 0.3, 40), win(63, 0.3)]), undefined).why,
    'new_unsteady',
  );
  assert.strictEqual(A.beatAlignOf(oldTrack([win(193, 0.1)]), nextTrack(), undefined).why, 'old_unsteady');
  const lowConf = Object.assign(nextTrack(), { bt: bt([win(33, 0.3), win(63, 0.3)], 0.4) });
  assert.strictEqual(A.beatAlignOf(oldTrack(), lowConf, undefined).why, 'new_unsteady');
  assert.strictEqual(A.beatAlignOf(oldTrack(), Object.assign(nextTrack(), { bt: null }), undefined).why, 'no_tempo');
  assert.strictEqual(
    A.beatAlignOf(oldTrack(), nextTrack(0.3, [win(32, 0.3), win(62, 0.3)]), undefined).why,
    'starts_at_once',
  );
  assert.strictEqual(A.beatAlignOf(oldTrack(), nextTrack(), { exit: true } as A.PlannedMix).why, 'mix_point');
});

test('beat grids: the old grid sits near the end, the new one near the first sound', () => {
  const a = A.beatAlignOf(oldTrack(), nextTrack(), undefined);
  assert.ok(a.old && a.new);
  assert.ok(Math.abs(a.old.anchor - 190) < P, `old ${a.old.anchor}`);
  assert.ok(Math.abs(wrap(a.old.anchor - 0.1, P)) < 1e-6);
  assert.ok(Math.abs(a.new.anchor - 4) < P, `new ${a.new.anchor}`);
  assert.ok(Math.abs(wrap(a.new.anchor - 0.3, P)) < 1e-6);
});

test('run stop: the next beat lands on the old heard beat, within one beat of the planned stop', () => {
  const a = A.beatAlignOf(oldTrack(), nextTrack(), undefined);
  const cap = { t0: 50, p0: 188 + 512 / 48000, delaySec: 512 / 48000 };

  for (const t0 of [50.3, 50.41, 50.55, 50.62, 50.77]) {
    const run = { t0, ct0: 0, until: 2.75, rate: 3 };
    const r = A.alignedRushEnd(a, cap, run);
    assert.ok(r, `t0 ${t0}`);
    assert.ok(r.shiftSec >= 0 && r.shiftSec < P, `shift ${r.shiftSec}`);
    assert.ok(r.until <= run.until + 1e-9 && run.until - r.until <= (P * 3) / 2 + 1e-6);
    // the page's timer stops the run 30 ms early
    const end = t0 + (r.until - run.ct0) / 3 - 0.03;
    const c = run.ct0 + 3 * (end - t0) - end;
    const miss = A.beatMissBeats(a, cap, c);
    assert.ok(miss !== null && Math.abs(miss) < 0.01, `t0 ${t0} miss ${miss}`);
  }
});

test('run stop: may stop later (the next track earlier) only up to `latest`; no room -> null', () => {
  const a = A.beatAlignOf(oldTrack(), nextTrack(), undefined);
  const cap = { t0: 50, p0: 188, delaySec: 0 };
  const run = { t0: 50.5, ct0: 0, until: 2.75, rate: 3 };
  const r0 = A.alignedRushEnd(a, cap, run);
  assert.ok(r0);
  const late = A.alignedRushEnd(a, cap, Object.assign({}, run, { latest: 2.8 }));
  assert.ok(late && Math.abs(late.shiftSec) <= Math.abs(r0.shiftSec) + 1e-9);
  assert.ok(late.until <= 2.8 + 1e-9);
  assert.strictEqual(A.alignedRushEnd(a, cap, { t0: 50.5, ct0: 0, until: 0.3, rate: 3 }), null);
});

test('double / half time: the shorter beat of the pulse is lined up', () => {
  const a = A.beatAlignOf(oldTrack(), nextTrack(3, [win(33, 0.3, 8, 0.25), win(63, 0.3, 8, 0.25)]), undefined);
  const n = Object.assign(nextTrack(3, [win(33, 0.3, 8, 0.25), win(63, 0.3, 8, 0.25)]), {
    bt: Object.assign(bt([win(33, 0.3, 8, 0.25), win(63, 0.3, 8, 0.25)]), { bpm: 240 }),
  });
  const b = A.beatAlignOf(oldTrack(), n, undefined);
  assert.strictEqual(a.why, 'new_unsteady');
  assert.strictEqual(b.why, 'grids');
  const r = A.alignedRushEnd(b, { t0: 50, p0: 188, delaySec: 0 }, { t0: 50.5, ct0: 0, until: 2.75, rate: 3 });
  assert.ok(r && r.beatSec === 0.25 && r.shiftSec < 0.25);
});

test('plan: a blend keeps one beat in hand for the shift; tail and segue have no beat alignment', () => {
  const o = oldTrack(),
    n = nextTrack();
  const pr = { relation: { tempo: 'match', key: 'ok', cams: ['8A', '8A'], bpms: [120, 120] } };
  const tp = A.planTransition(o, { enabled: true, fadeOut: null, pair: pr });
  const p = A.planOverlap(o, tp, { enabled: true, next: n, style: 'auto' });
  assert.strictEqual(p.style?.kind, 'blend');
  assert.strictEqual(p.style.beat?.why, 'grids');
  const off = Object.assign(nextTrack(), { bt: null });
  const q = A.planOverlap(o, tp, { enabled: true, next: off, style: 'auto' });
  assert.ok(Math.abs((p.leadSec ?? 0) - (q.leadSec ?? 0) - P) < 0.02, `${p.leadSec} vs ${q.leadSec}`);
  assert.strictEqual(p.style.swapPos, q.style?.swapPos);
  const far = { relation: { tempo: 'far', key: 'ok', cams: ['8A', '8A'], bpms: [120, 150] } };
  const t = A.planOverlap(o, A.planTransition(o, { enabled: true, fadeOut: null, pair: far }), {
    enabled: true,
    next: n,
    style: 'auto',
  });
  assert.strictEqual(t.style?.kind, 'tail');
  assert.strictEqual(t.style.beat, undefined);
  assert.strictEqual(A.planOverlap(o, tp, { enabled: true, next: n, style: 'simple' }).style, undefined);
});

test('text: the seek bar and popup say whether the beats were lined up and why not (ja / en)', () => {
  const s = { kind: 'blend', why: 'tempo_close', aligned: null, bpms: [120, 120] };

  for (const lang of ['ja', 'en'] as const) {
    I.setLang(lang);
    const plain = overlapStyleText(s) ?? '';

    for (const why of ['grids', 'aligned', 'old_unsteady', 'new_unsteady', 'starts_at_once', 'no_room', 'rush_seek']) {
      const txt = overlapStyleText(Object.assign({}, s, { beat: why })) ?? '';
      assert.ok(txt.startsWith(plain) && txt.length > plain.length, `${lang} ${why}`);
      assert.ok(!txt.includes('ovBeat.'), `${lang} ${why}: ${txt}`);
    }

    assert.strictEqual(overlapStyleText(Object.assign({}, s, { beat: 'nope' })), plain);
    assert.strictEqual(
      overlapStyleText({ kind: 'tail', why: 'tempo_far', beat: 'aligned' }),
      overlapStyleText({ kind: 'tail', why: 'tempo_far' }),
    );
  }

  I.setLang('ja');
  assert.ok((overlapStyleText(Object.assign({}, s, { beat: 'aligned' })) ?? '').includes('拍をそろえた'));
  const ovs = {
    leadStartPos: 160,
    leadEndPos: 186,
    overlapStartPos: 186,
    overlapEndPos: 192,
    style: Object.assign({}, s, { beat: 'aligned' }),
    state: 'done',
  };
  const band = seekbarMarks({ marks: { dur: 200 }, overlap: ovs }).items.find((x) => x.kind === 'overlap');
  assert.strictEqual(band?.info?.style?.beat, 'aligned');
  const txt = JSON.parse(switchesText([{ beat: 'aligned', beatMiss: -0.016, title: 'x' }], '0')) as {
    switches: Record<string, unknown>[];
  };
  const row = txt.switches[0];
  assert.deepStrictEqual([row.beat, row.beatMiss, row.title], ['aligned', -0.02, undefined]);
});
