import test from 'node:test';
import * as M from '../shared/seekbar-marks.mts';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import type { IndexEntry } from '../shared/types.mts';
import { createSim, entry, type Loose, type Sim, type SimOptions } from './helpers/player-sim.mts';

const D = 100;
const base = (over?: Partial<SimOptions>, settings?: Loose) =>
  Object.assign(
    {
      queue: ['A', 'B', 'C'],
      tracks: { A: { d: D }, B: { d: 120 }, C: { d: 90 } },
      index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) },
      settings: Object.assign({ overlap: true, overlapStyle: 'simple' }, settings || {}),
    },
    over || {},
  );
const ovDiag = (sim: Sim, kind: string) => sim.diag.filter((d) => d.kind === 'ov_' + kind);

test('planOverlap: lead by ending (fades longer, cut / stop short segue), window from the advance point, off cases', () => {
  const tp = (e: Loose) => A.planTransition(e, { enabled: true, fadeOut: A.planFades(e).fadeOut });
  const dec = entry(D, 'decays', 95);
  const p = A.planOverlap(dec, tp(dec), { enabled: true });
  assert.deepStrictEqual(
    [p.on, p.leadSec, p.shape, p.captureStartPos, p.advanceAtPos, p.rate],
    [true, 3, 'equal', 80.2, 95.2, 1.25],
  );
  const fades = Object.assign(entry(D, 'fades', 95), {});
  fades.en.decaySec = 10;
  assert.strictEqual(A.planOverlap(fades, tp(fades), { enabled: true }).leadSec, 5);
  fades.en.decaySec = 30;
  assert.strictEqual(A.planOverlap(fades, tp(fades), { enabled: true }).leadSec, 6, 'capped at 6 s');
  const stop = entry(D, 'stop', 97);
  const ps = A.planOverlap(stop, tp(stop), { enabled: true });
  assert.deepStrictEqual([ps.leadSec, ps.shape], [2, 'segue']);
  const ab = Object.assign(entry(D, 'abrupt', 99), {
    en: { kind: 'abrupt', lastSoundSec: 99, silenceSec: 1, fadeSec: 3 },
  });
  const pa = A.planOverlap(ab as IndexEntry, tp(ab), { enabled: true, fadeOut: A.planFades(ab as IndexEntry).fadeOut });
  assert.deepStrictEqual([pa.leadSec, pa.shape, pa.advanceAtPos], [3, 'segue', 99]);
  assert.strictEqual(A.planOverlap(dec, tp(dec), { enabled: false }).why, 'off');
  assert.strictEqual(
    A.planOverlap(null, A.planTransition(null, { enabled: true }), { enabled: true }).why,
    'no_plan',
    'first play',
  );
  assert.strictEqual(A.planOverlap(dec, tp(dec), { enabled: true, nextExcluded: true }).why, 'next_excluded');
  const short = entry(20, 'decays', 15);
  const psh = A.planOverlap(short, tp(short), { enabled: true });
  assert.ok(psh.on && psh.leadSec! < 3 && psh.captureStartPos! >= 10 - 1e-9, `short track ${JSON.stringify(psh)}`);
  assert.strictEqual(
    A.planOverlap(entry(14, 'decays', 12), tp(entry(14, 'decays', 12)), { enabled: true }).why,
    'short',
  );
  for (const lead of [2, 3, 6]) assert.ok(Math.abs(A.overlapLeadFrom(95.2 - lead * 5, 95.2, 1.25) - lead) < 1e-9);
});

test('heard clock: positions and fade-out times follow what is heard, not the element', () => {
  const cap = { t0: 100, p0: 80, delaySec: 0 };
  assert.strictEqual(A.heardPos(cap, 104), 84);
  assert.strictEqual(A.heardCtx(cap, 93), 113);
  const t = A.fadeOutHeardTimes({ startPos: 92, endPos: 95, restorePos: 95.3 }, cap, 104);
  assert.deepStrictEqual([t!.startCtx, t!.endCtx], [112, 115]);
  const el = A.fadeOutTimes({ startPos: 92, endPos: 95, restorePos: 95.3 }, 85, 104, 1.25);
  assert.ok(Math.abs(el!.startCtx - 109.6) < 1e-9);
  assert.strictEqual(
    A.fadeOutHeardTimes({ startPos: 82, endPos: 85, restorePos: 85.3 }, cap, 104),
    null,
    'start already heard',
  );
});

test('sim overlap: runs ahead at 1.25x with preservesPitch off, presses next at the last sound, the old remainder plays over the next track, then everything is back to 1', async () => {
  const sim = createSim(base());
  await sim.start(78);
  assert.ok(sim.ov, 'overlap worklet created');
  await sim.run(2.5);
  assert.strictEqual(sim.rate(), 1.25);
  assert.strictEqual(sim.pp(), false);
  assert.strictEqual(sim.ov.mode, 'capture');
  assert.strictEqual(sim.status.state, 'ahead', 'frames ahead are not analysed');
  const fgBefore: number[] = [];
  await sim.run(11.8, (s) => fgBefore.push(s.fg()));
  assert.strictEqual(sim.clicks, 1, 'next pressed once');
  assert.strictEqual(sim.vid(), 'B');
  assert.ok(
    fgBefore.every((g) => g === 1),
    'no fade to 0 before the switch',
  );
  assert.strictEqual(sim.rate(), 1);
  assert.strictEqual(sim.pp(), false, 'preservesPitch stays off at rate 1 while the overlap is on (prearmed)');
  const adv = sim.diag.find((d) => d.kind === 'tr_advance');
  assert.ok(Math.abs(adv!.ct - 95.2) < 0.15, `advance at ${adv!.ct}`);
  const dr = sim.ov.posted.find((d) => d.ev === 'drain');
  assert.ok(dr!.leadOutSec > 2.8 && dr!.leadOutSec <= 3.05, `lead at the switch ${dr!.leadOutSec}`);
  assert.ok(sim.diag.some((d) => d.kind === 'tr_incoming_overlap'));
  const gs: number[] = [];
  await sim.run(4, (s) => gs.push(s.fg()));
  assert.ok(
    gs.every((g) => g === 1),
    `fade stage ${Math.min(...gs)}`,
  );
  assert.strictEqual(sim.ov.mode, 'pass');
  assert.ok(ovDiag(sim, 'drained').length === 1);
  const snapA = sim.snapshots.filter((s) => s.videoId === 'A').pop();
  const o = snapA!.applied.transition.overlap;
  assert.strictEqual(o.state, 'done');
  assert.strictEqual(o.shape, 'equal');
  assert.ok(o.leadOutSec > 2.8 && o.xfSec > 2.8);
  const clean = A.sanitizeApplied(snapA!.applied);
  assert.deepStrictEqual(Object.keys(clean!.transition!.overlap!).sort(), [
    'cancel',
    'leadOutSec',
    'leadSec',
    'lostSec',
    'shape',
    'state',
    'xfSec',
  ]);
  assert.strictEqual(clean!.transition!.overlap!.state, 'done');
});

test('sim overlap: setting off -> the existing transition (fade to 0, next, fade-in), the rate never changes', async () => {
  const sim = createSim(base(undefined, { overlap: false }));
  await sim.start(80);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.rateLog.length, 0);
  assert.ok(
    sim.diag.some((d) => d.kind === 'tr_fade_in'),
    'the old fade-in',
  );
  assert.ok(!sim.ov || sim.ov.msgs.length === 0);
});

test('sim overlap: first play, gapless and excluded tracks fall back to the existing transition', async () => {
  const s1 = createSim(base({ index: { B: entry(120, 'fades', 110) } }));
  await s1.start(80);
  await s1.run(22);
  assert.strictEqual(s1.rateLog.length, 0);
  const s2 = createSim(base());
  s2.send('excluded', ['A']);
  await s2.start(78);
  await s2.run(20);
  assert.strictEqual(s2.rateLog.length, 0);
  const s3 = createSim(base());
  s3.send('excluded', ['B']);
  await s3.start(78);
  await s3.run(20);
  assert.strictEqual(s3.rateLog.length, 0);
  assert.strictEqual(s3.clicks, 1, 'the planned transition still runs');
  const url = 'https://music.youtube.com/watch?v=A&list=OLAK5uy_test';
  const ab = Object.assign(entry(D, 'abrupt', 99.9), {
    en: { kind: 'abrupt', lastSoundSec: 99.9, silenceSec: 0.1, fadeSec: 3 },
  });
  const s4 = createSim(
    base({
      url,
      albumPos: { A: 0, B: 1, C: 2 },
      index: { A: ab, B: Object.assign(entry(120, 'fades', 110), { fs: 0, fx: true }) },
    }),
  );
  await s4.start(78);
  await s4.run(20);
  assert.strictEqual(s4.rateLog.length, 0);
});

test('sim overlap: pause while ahead -> flush, rate 1 / preservesPitch back, the element goes back by the unheard lead; resuming runs ahead again', async () => {
  const sim = createSim(base());
  await sim.start(78);
  await sim.run(6.2);
  const ctAhead = sim.ct();
  sim.pause();
  await sim.run(0.3);
  assert.strictEqual(sim.rate(), 1);
  assert.strictEqual(sim.pp(), false);
  assert.strictEqual(sim.ov!.mode, 'pass');
  const rw = ovDiag(sim, 'rewind')[0];
  assert.ok(rw && rw.lostSec > 0.8 && rw.lostSec < 1.3, `rewound ${rw && rw.lostSec}`);
  assert.ok(Math.abs(sim.ct() - (ctAhead - rw.lostSec)) < 0.02, `position ${sim.ct()} vs ${ctAhead} - ${rw.lostSec}`);
  void sim.play();
  await sim.run(1);
  assert.strictEqual(sim.rate(), 1.25, 'runs ahead again after resuming');
  await sim.run(14);
  assert.strictEqual(sim.vid(), 'B');
  assert.strictEqual(sim.rate(), 1);
  assert.strictEqual(sim.pp(), false);
});

test('sim overlap: seek, the user next / previous and a rate set by someone else flush and leave the rest alone', async () => {
  const seek = createSim(base());
  await seek.start(78);
  await seek.run(5);
  seek.seek(40);
  await seek.run(0.5);
  assert.deepStrictEqual([seek.rate(), seek.pp(), seek.ov!.mode], [1, false, 'pass']);
  assert.strictEqual(ovDiag(seek, 'cancel')[0].reason, 'seek');
  assert.ok(Math.abs(seek.ct() - 40.5) < 0.05, 'the seek target is kept');
  seek.seek(86);
  await seek.run(0.5);
  assert.strictEqual(seek.rate(), 1.25);
  const c2 = ovDiag(seek, 'capture')[1];
  assert.ok(c2 && c2.leadSec > 1.7 && c2.leadSec < 1.9, `second capture ${c2 && c2.leadSec}`);

  const nx = createSim(base());
  await nx.start(78);
  await nx.run(5);
  nx.w.document.getElementById('next')!.click();
  await nx.run(0.5);
  assert.deepStrictEqual([nx.vid(), nx.rate(), nx.pp(), nx.ov!.mode], ['B', 1, false, 'pass']);
  assert.strictEqual(ovDiag(nx, 'cancel')[0].reason, 'user_skip');

  const pv = createSim(base());
  await pv.start(78);
  await pv.run(5);
  pv.w.document.getElementById('prev')!.click(); // YTM: past 3 s, previous restarts the track
  await pv.run(0.5);
  assert.deepStrictEqual([pv.rate(), pv.pp(), pv.ov!.mode], [1, false, 'pass']);
  assert.ok(pv.ct() < 1);

  const rt = createSim(base());
  await rt.start(78);
  await rt.run(5);
  rt.setRate(1.5);
  await rt.run(0.3);
  assert.strictEqual(ovDiag(rt, 'cancel')[0].reason, 'rate');
  assert.strictEqual(rt.ov!.mode, 'pass');
});

test('sim overlap: the user presses next / previous while the old remainder still plays -> it is dropped at once', async () => {
  const sim = createSim(base());
  await sim.start(78);
  await sim.run(14.3);
  assert.strictEqual(sim.vid(), 'B');
  await sim.run(0.8);
  assert.strictEqual(sim.ov!.mode, 'drain');
  sim.w.document.getElementById('next')!.click();
  await sim.run(0.3);
  assert.strictEqual(sim.vid(), 'C');
  assert.strictEqual(sim.ov!.mode, 'pass');
  assert.strictEqual(ovDiag(sim, 'cancel')[0].reason, 'user_skip');
});

test('sim overlap: a second emptied / loadstart of the same slow load does not drop the remainder', async () => {
  const sim = createSim(base());
  sim.nextLoadsPaused = true;
  await sim.start(78);
  await sim.run(14.1);
  assert.strictEqual(sim.vid(), 'B');
  await sim.run(0.8);
  sim.reload();
  await sim.run(0.2);
  assert.strictEqual(sim.ov!.mode, 'drain');
  assert.strictEqual(ovDiag(sim, 'cancel').length, 0);
  sim.nextLoadsPaused = false;
  void sim.play();
  await sim.run(4);
  assert.strictEqual(ovDiag(sim, 'drained').length, 1);
});

test('sim overlap: an ad at the boundary flushes and the element is not touched while the ad shows', async () => {
  const sim = createSim(base());
  await sim.start(78);
  await sim.run(5);
  const n = sim.rateLog.length;
  sim.setAd(true);
  sim.w.document.getElementById('movie_player')!.dispatchEvent(new sim.w.Event('x')); // class observer is async in jsdom
  await sim.run(1);
  assert.strictEqual(sim.ov!.mode, 'pass');
  assert.ok(['ad'].includes(ovDiag(sim, 'cancel')[0].reason));
  assert.ok(
    sim.rateLog.slice(n).every(([, , , ad]) => !ad),
    'no rate change while the ad shows',
  );
  sim.setAd(false);
  await sim.run(0.5);
  assert.strictEqual(sim.rate(), 1, 'back to 1 once the ad is gone');
  assert.strictEqual(sim.pp(), false, 'prearmed, not touched by the ad');
});

test('sim overlap: turning the setting off while ahead flushes and restores at once', async () => {
  const sim = createSim(base());
  await sim.start(78);
  await sim.run(5);
  sim.send('settings', { overlap: false });
  await sim.run(0.2);
  assert.deepStrictEqual([sim.rate(), sim.pp(), sim.ov!.mode], [1, false, 'pass']);
  assert.strictEqual(ovDiag(sim, 'cancel')[0].reason, 'off');
  await sim.run(12);
  assert.strictEqual(sim.clicks, 1, 'the planned transition still runs (no overlap)');
});

test('sim overlap: an exception while ahead flushes and restores (safe wrapper)', async () => {
  const An = Object.assign({}, A); // the module namespace is shared by every test
  const sim = createSim(base({ analysis: An }));
  await sim.start(78);
  await sim.run(5);

  An.transitionStep = () => {
    throw new Error('boom');
  };

  await sim.run(0.3);
  assert.deepStrictEqual([sim.rate(), sim.pp(), sim.ov!.mode], [1, false, 'pass']);
  assert.ok(ovDiag(sim, 'cancel').some((d) => d.reason === 'error'));
});

test('sim overlap: an abrupt track gets its fade-out on the heard clock (worklet gOld), not on the element clock', async () => {
  const ab = Object.assign(entry(D, 'abrupt', 99), {
    en: { kind: 'abrupt', lastSoundSec: 99, silenceSec: 1, fadeSec: 3 },
  });
  const sim = createSim(base({ index: { A: ab, B: entry(120, 'fades', 110) } }));
  await sim.start(82);
  await sim.run(2);
  const fo = ovDiag(sim, 'fade_out')[0];
  assert.ok(fo, 'fade-out on the heard clock');
  const cap = ovDiag(sim, 'capture')[0];
  assert.ok(
    Math.abs(fo.startCtx - (cap.at + (96 - cap.ct) + 512 / 8000)) < 0.12,
    `start ${fo.startCtx} vs ${cap.at + 96 - cap.ct}`,
  );
  const fg: number[] = [];
  await sim.run(13.2, (s) => fg.push(s.fg()));
  assert.strictEqual(sim.vid(), 'B');
  assert.strictEqual(sim.ov!.mode, 'drain');
  assert.ok(
    fg.every((g) => g === 1),
    `fade stage ${Math.min(...fg)}`,
  );
  const gOld = (sim.ov!.node as unknown as Loose).parameters.get('gOld');
  assert.ok(gOld.value < 1 && gOld.value > 0, `old track fading on the heard clock: ${gOld.value}`);
});

test('sim overlap: status carries the lead and overlap spans for the seek bar', async () => {
  const sim = createSim(base());
  await sim.start(78);
  await sim.run(3);
  const o = sim.status.fade.overlap;
  assert.ok(o, 'status.fade.overlap');
  assert.strictEqual(o.overlapEndPos, 95.2);
  assert.ok(Math.abs(o.leadStartPos - 80.2) < 0.15);
  assert.strictEqual(o.leadEndPos, 92.2);
  assert.strictEqual(o.running, 'capture');

  const m = M.seekbarMarks(sim.status.fade);
  const lead = m.items.find((i: Loose) => i.kind === 'lead'),
    ov = m.items.find((i: Loose) => i.kind === 'overlap');
  assert.ok(lead && ov);
  assert.strictEqual(ov.sec, 3);
});

test('sim overlap: frames ahead are not analysed; the stored ending of the next listen is unchanged', async () => {
  const sim = createSim(base({ energyAt: (vid: string, ct: number) => (vid === 'A' && ct > 95 ? 1e-9 : 1e-3) }));
  await sim.start(70);
  let ahead = 0;
  await sim.run(25, (s) => {
    if (s.status.state === 'ahead') ahead++;
  });
  assert.ok(ahead > 100, `${ahead} frames ahead`);
  const snapA = sim.snapshots.filter((s) => s.videoId === 'A').pop();
  assert.strictEqual(snapA!.tailFrames, null, 'no tail from a sped-up end');
  assert.strictEqual(snapA!.lastSound, null);
});
