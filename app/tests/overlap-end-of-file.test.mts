import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import type { IndexEntry } from '../shared/types.mts';
import { createSim, entry, type Loose, type SimOptions } from './helpers/player-sim.mts';
import { loadFixtures } from './helpers/fixtures.mts';

const D = 100;
const ON = { enabled: true };
const cut = () =>
  Object.assign(entry(D, 'abrupt', 99.96), {
    en: { kind: 'abrupt', lastSoundSec: 99.96, silenceSec: 0.04, fadeSec: 3, decaySec: 0, endRelLu: -2 },
  }) as IndexEntry;
const base = (index: Loose, over?: Partial<SimOptions>, settings?: Loose) =>
  Object.assign(
    {
      queue: ['A', 'B', 'C'],
      tracks: { A: { d: D }, B: { d: 120 }, C: { d: 90 } },
      index: Object.assign({ B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) }, index),
      settings: Object.assign({ overlap: true, overlapStyle: 'simple' }, settings || {}),
    },
    over || {},
  );

test('plan: nothing to skip -> none without the overlap, an advance 0.4 s before the end with it', () => {
  for (const [kind, ls] of [
    ['decays', 99.99],
    ['fades', 99.9],
    ['stop', 99.8],
  ] as const) {
    const e = entry(D, kind, ls);
    assert.strictEqual(A.planTransition(e, ON).reason, 'little_silence', kind);
    const p = A.planTransition(e, { enabled: true, overlap: true });
    assert.deepStrictEqual(
      [p.kind === 'none', p.reason, p.advanceAtPos, p.skipSec, p.atEnd],
      [false, kind, D - A.TR_END_MARGIN_SEC, A.TR_END_MARGIN_SEC, true],
      kind,
    );
  }

  const e = cut();
  const early = { startPos: 96, endPos: 99.2, restorePos: 99.5 };
  const p1 = A.planTransition(e, { enabled: true, overlap: true, fadeOut: early });
  assert.deepStrictEqual([p1.kind, p1.advanceAtPos, p1.atEnd], ['fade_trim', 99.2, undefined]);
  const near = { startPos: 97, endPos: 99.7, restorePos: 100 };
  const pn = A.planTransition(e, { enabled: true, overlap: true, fadeOut: near });
  assert.deepStrictEqual([pn.kind, pn.advanceAtPos, pn.atEnd], ['fade_trim', 99.6, true]);
  const late = A.planFades(e).fadeOut!;
  const p2 = A.planTransition(e, { enabled: true, overlap: true, fadeOut: late });
  assert.deepStrictEqual([p2.kind, p2.advanceAtPos], ['fade_trim', 99.6]);
  const roomy = entry(D, 'decays', 95);
  assert.deepStrictEqual(A.planTransition(roomy, { enabled: true, overlap: true }), A.planTransition(roomy, ON));
});

test('plan: the overlap of an end-of-file advance by ending (decays crossfade, cut / stop segue)', () => {
  const dec = entry(D, 'decays', 99.99);
  const tp = A.planTransition(dec, { enabled: true, overlap: true });
  const op = A.planOverlap(dec, tp, { enabled: true });
  assert.deepStrictEqual([op.on, op.shape, op.leadSec, op.advanceAtPos], [true, 'equal', 3, 99.6]);
  const e = cut();
  const fo = A.fadeOutEndingAt(A.planFades(e).fadeOut, 99.6);
  const tc = A.planTransition(e, { enabled: true, overlap: true, fadeOut: fo });
  const oc = A.planOverlap(e, tc, { enabled: true, fadeOut: fo });
  assert.deepStrictEqual([oc.on, oc.shape, tc.advanceAtPos, fo!.endPos], [true, 'segue', 99.6, 99.6]);
  assert.strictEqual(+(fo!.endPos - fo!.startPos).toFixed(2), 3, 'the fade keeps its length');
});

test('overlapLeadAt: a lead planned at the 1 s minimum still starts on the first frame inside the window', () => {
  const p = { leadSec: 1, rate: 1.25, captureStartPos: 275.38, advanceAtPos: 280.38 };
  for (const ct of [275.38, 275.42, 275.47]) assert.ok(A.overlapLeadAt(p, ct)! > 0.95, `ct ${ct}`);
  assert.strictEqual(A.overlapLeadAt(p, 275.3), null, 'before the window');
  assert.strictEqual(A.overlapLeadAt(p, 280.38), null, 'at the advance');
  assert.strictEqual(A.overlapLeadAt(p, 276), null, 'too little left (0.88 s)');
  assert.ok(Math.abs(A.overlapLeadAt({ ...p, leadSec: 3, captureStartPos: 265.38 }, 270)! - 2.076) < 1e-9);
});

test('fadeOutEndingAt: moved only when it would end after the advance', () => {
  const fo = { startPos: 97, endPos: 99.96, restorePos: 100.26 };
  assert.deepStrictEqual(A.fadeOutEndingAt(fo, 99.6), { startPos: 96.64, endPos: 99.6, restorePos: 99.9 });
  assert.strictEqual(A.fadeOutEndingAt(fo, 99.99), fo);
  assert.strictEqual(A.fadeOutEndingAt(null, 99.6), null);
});

test('real fixtures: every ending that had nothing to skip gets an overlap plan; the others keep their plan', () => {
  const tracks = [...loadFixtures('real-tracks').tracks, ...loadFixtures('ear-checked').tracks];
  let moved = 0;

  for (const t of tracks) {
    const e = A.indexEntryOf({
      integratedLufs: t.integratedLufs,
      coverage: t.coverage,
      durationSec: t.durationSec,
      lastSoundSec: t.lastSoundSec ?? undefined,
      tail: t.tail,
    });
    const fo = A.planFades(e).fadeOut;
    const plain = A.planTransition(e, { enabled: true, fadeOut: fo });
    const withOv = A.planTransition(e, { enabled: true, fadeOut: fo, overlap: true });

    if (plain.reason === 'little_silence') {
      moved++;
      assert.ok(withOv.atEnd && withOv.kind !== 'none', t.label);
      assert.ok(withOv.advanceAtPos! <= t.durationSec - A.TR_END_MARGIN_SEC + 1e-9, t.label);
      const op = A.planOverlap(e, withOv, { enabled: true, fadeOut: A.fadeOutEndingAt(fo, withOv.advanceAtPos) });
      assert.ok(op.on, `${t.label} ${op.why}`);
    } else if (plain.kind !== 'none' && plain.skipSec! >= A.TR_END_MARGIN_SEC) {
      assert.deepStrictEqual(withOv, plain, t.label);
    }
  }

  assert.ok(moved >= 20, `${moved} end-of-file tracks`);
});

test('sim: a track sounding to the end of its file runs ahead and is overlapped into the next one', async () => {
  const sim = createSim(base({ A: entry(D, 'decays', 99.99) }));
  await sim.start(82);
  await sim.run(3);
  assert.strictEqual(sim.rate(), 1.25, 'running ahead');
  await sim.run(12);
  assert.strictEqual(sim.clicks, 1, 'next pressed by the extension');
  assert.strictEqual(sim.vid(), 'B');
  const adv = sim.diag.find((d) => d.kind === 'tr_advance');
  assert.ok(Math.abs(adv!.ct - 99.6) < 0.15, `advance at ${adv!.ct}`);
  assert.ok(sim.diag.some((d) => d.kind === 'tr_incoming_overlap'));
  const dr = sim.ov!.posted.find((d) => d.ev === 'drain');
  assert.ok(dr!.leadOutSec > 2.8, `lead at the switch ${dr!.leadOutSec}`);
  await sim.run(4);
  assert.strictEqual(sim.ov!.mode, 'pass');
  assert.strictEqual(sim.rate(), 1);
});

test('sim: overlap off -> no advance, the player ends the track itself (as before)', async () => {
  const sim = createSim(base({ A: entry(D, 'decays', 99.99) }, undefined, { overlap: false }));
  await sim.start(85);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.rateLog.length, 0);
  assert.strictEqual(sim.vid(), 'B');
});

test('sim: pause / seek / the user next while ahead -> no early advance; after the pause it runs ahead again', async () => {
  const pause = createSim(base({ A: entry(D, 'decays', 99.99) }));
  await pause.start(84);
  await pause.run(4);
  pause.pause();
  await pause.run(0.3);
  assert.deepStrictEqual([pause.rate(), pause.ov!.mode], [1, 'pass']);
  void pause.play();
  await pause.run(1);
  assert.strictEqual(pause.rate(), 1.25, 'runs ahead again');
  await pause.run(14);
  assert.strictEqual(pause.clicks, 1);
  assert.ok(pause.diag.some((d) => d.kind === 'tr_incoming_overlap'));

  const seek = createSim(base({ A: entry(D, 'decays', 99.99) }));
  await seek.start(84);
  await seek.run(4);
  seek.seek(97);
  await seek.run(5);
  assert.strictEqual(seek.clicks, 0, 'no advance without the run-ahead');
  assert.strictEqual(seek.vid(), 'B', 'the player ended it');

  const nx = createSim(base({ A: entry(D, 'decays', 99.99) }));
  await nx.start(84);
  await nx.run(4);
  nx.w.document.getElementById('next')!.click();
  await nx.run(0.5);
  assert.deepStrictEqual([nx.vid(), nx.rate(), nx.ov!.mode], ['B', 1, 'pass']);
  assert.strictEqual(nx.clicks, 1, 'only the user press');
});

test('sim: the next track left alone -> the plain plan (no early advance)', async () => {
  const sim = createSim(base({ A: entry(D, 'decays', 99.99) }));
  sim.send('excluded', ['B']);
  await sim.start(85);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.rateLog.length, 0);
});
