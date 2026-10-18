import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import { createSim, entry, type Loose, type Sim, type SimOptions } from './helpers/player-sim.mts';

const D = 100;
const base = (over?: Partial<SimOptions>) =>
  Object.assign(
    {
      queue: ['A', 'B', 'C'],
      tracks: { A: { d: D }, B: { d: 120 }, C: { d: 90 } },
      index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) },
    },
    over || {},
  );

function watch() {
  const seen = { min: {} as Record<string, number>, belowWhileAd: 0, frames: [] as [number, string, number, number][] };

  return {
    seen,
    fn: (s: Sim) => {
      const v = s.vid();
      const g = s.fg();
      seen.min[v] = Math.min(seen.min[v] ?? 1, g);
      if (s.adNow && g < 0.999) seen.belowWhileAd++;
      seen.frames.push([+s.ctx.currentTime.toFixed(2), v, +s.ct().toFixed(2), g]);
    },
  };
}

test('sim: trim kind presses next at last sound + 0.2 s, holds 0 through the switch, fades the next track in over 0.3 s', async () => {
  const sim = createSim(base());
  await sim.start(80);
  await sim.run(14.9);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.fg(), 1);
  await sim.run(0.2);
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.vid(), 'B');
  assert.ok(sim.ct() < 0.3, `B at ${sim.ct()}`);
  const t0 = sim.ctx.currentTime;
  const g = [];

  for (let i = 0; i < 8; i++) {
    await sim.run(0.05);
    g.push(sim.fg());
  }

  assert.ok(g[0] < 0.5, `fade-in starts low ${g.join()}`);
  assert.ok(
    g.slice(-2).every((x) => x === 1),
    `fade-in ends at 1 ${g.join()}`,
  );
  assert.ok(sim.ctx.currentTime - t0 < 0.5);
  assert.strictEqual(sim.status.fade.vid, 'B');
});

test('sim: the applied record of the outgoing track holds the transition (kind, position, state)', async () => {
  const sim = createSim(base());
  await sim.start(80);
  await sim.run(16);
  const snapA = sim.snapshots.filter((s) => s.videoId === 'A').pop();
  assert.ok(snapA && snapA.applied && snapA.applied.transition, 'A has a transition record');
  const tr = snapA.applied.transition;
  assert.strictEqual(tr.kind, 'trim');
  assert.strictEqual(tr.reason, 'decays');
  assert.strictEqual(tr.state, 'advanced');
  assert.ok(Math.abs(tr.atSec - 95.2) < 0.15, `at ${tr.atSec}`);
  const clean = A.sanitizeApplied(snapA.applied);
  assert.deepStrictEqual(Object.keys(clean!.transition!).sort(), [
    'atSec',
    'cancel',
    'kind',
    'pair',
    'planSec',
    'reason',
    'skipSec',
    'state',
    'wash',
  ]);
  assert.strictEqual(clean!.transition!.state, 'advanced');
});

test('sim: abrupt cut -> the existing fade-out reaches 0 and next is pressed at its end', async () => {
  const sim = createSim(
    base({
      index: {
        A: Object.assign(entry(D, 'abrupt', 99.0), {
          en: { kind: 'abrupt', lastSoundSec: 99, silenceSec: 1, fadeSec: 3 },
        }),
        B: entry(120, 'fades', 110),
      },
    }),
  );
  await sim.start(80);
  await sim.run(17.5);
  const mid = sim.fg();
  assert.ok(mid < 0.9 && mid > 0, `fading ${mid}`);
  assert.strictEqual(sim.clicks, 0);
  await sim.run(1.7);
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.vid(), 'B');
});

test('sim: stop kind waits 0.3 s after the last hit', async () => {
  const sim = createSim(base({ index: { A: entry(D, 'stop', 97), B: entry(120, 'fades', 110) } }));
  await sim.start(90);
  await sim.run(97.2 - sim.ct());
  assert.strictEqual(sim.clicks, 0);
  await sim.run(0.25);
  assert.strictEqual(sim.clicks, 1);
  const adv = sim.diag.find((d) => d.kind === 'tr_advance');
  assert.ok(adv!.ct >= 97.3 && adv!.ct < 97.45, `advanced at ${adv!.ct}`);
});

test('sim: an unanalysed track is left alone (no click, gain 1 throughout, the player advances by itself)', async () => {
  const sim = createSim(base({ index: {} }));
  const w = watch();
  await sim.start(90);
  await sim.run(11, w.fn);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.vid(), 'B');
  assert.strictEqual(Math.min(...Object.values(w.seen.min)), 1);
});

test('sim: setting off -> nothing happens; turning it off while armed cancels and restores 1', async () => {
  const off = createSim(base({ settings: { transitions: false } }));
  await off.start(90);
  await off.run(6);
  assert.strictEqual(off.clicks, 0);
  const sim = createSim(base());
  await sim.start(90);
  await sim.run(2);
  assert.strictEqual(sim.status.fade.transition.state, 'armed');
  sim.send('settings', { transitions: false });
  await sim.run(4);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.fg(), 1);
});

test('sim: pause while armed cancels; play again re-arms only if the point is still ahead', async () => {
  const sim = createSim(base());
  await sim.start(90);
  await sim.run(2);
  sim.pause();
  await sim.run(1);
  assert.strictEqual(sim.status.fade.transition.result, 'cancelled');
  assert.strictEqual(sim.fg(), 1);
  void sim.play();
  await sim.run(4);
  assert.strictEqual(sim.clicks, 1, 'the plan is still ahead, so it runs');
});

test('sim: a seek past the point never presses next; the gain stays at 1', async () => {
  const sim = createSim(base());
  const w = watch();
  await sim.start(90);
  await sim.run(2, w.fn);
  sim.seek(97);
  await sim.run(4, w.fn);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(w.seen.min.A, 1);
});

test('sim: a seek back from inside the armed window cancels it (re-armed later)', async () => {
  const sim = createSim(base());
  await sim.start(90);
  await sim.run(1);
  sim.seek(40);
  await sim.run(0.5);
  assert.notStrictEqual(sim.status.fade.transition.state, 'armed');
  assert.strictEqual(sim.fg(), 1);
});

test('sim: the user pressing next / previous while armed cancels it and the next track is not faded by us', async () => {
  const sim = createSim(base());
  const w = watch();
  await sim.start(90);
  await sim.run(2, w.fn);
  sim.w.document.getElementById('next')!.click();
  await sim.run(1, w.fn);
  assert.strictEqual(sim.vid(), 'B');
  assert.strictEqual(w.seen.min.B, 1, 'no fade-in from 0 on a user skip');
  assert.strictEqual(sim.fg(), 1);
  const s2 = createSim(base());
  await s2.start(90);
  await s2.run(2);
  s2.w.document.getElementById('prev')!.click();
  await s2.run(1);
  assert.ok(s2.ct() < 2);
  assert.strictEqual(s2.fg(), 1);
  assert.strictEqual(s2.clicks, 0);
});

test('sim: an ad that starts at the boundary puts the gain back to 1 on the media event; no click during the ad', async () => {
  const sim = createSim(base({ nextWorks: false }));
  const w = watch();
  await sim.start(90);
  await sim.run(5.15, w.fn);
  assert.strictEqual(sim.clicks, 1);
  assert.ok(sim.fg() < 0.05, 'held at 0 after the click');
  sim.setAd(true);
  const nDiag = sim.diag.length;
  sim.load(1);
  assert.strictEqual(sim.fg(), 1, 'restored at once on the media event, before any meter frame');
  await new Promise((r) => setTimeout(r, 0));
  const after = sim.diag.slice(nDiag).map((d) => d.kind + ':' + (d.reason || ''));
  assert.strictEqual(after[0], 'tr_end:ad', after.join(' '));
  await sim.run(3, w.fn);
  assert.strictEqual(w.seen.belowWhileAd, 0);
  assert.strictEqual(sim.clicks, 1);
});

test('sim: an ad showing while armed cancels; no transition is armed during ads', async () => {
  const sim = createSim(base());
  await sim.start(90);
  await sim.run(1);
  sim.setAd(true);
  await sim.run(6);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.fg(), 1);
});

test('sim: the next button doing nothing -> the time limit restores 1 and the track ends normally', async () => {
  const sim = createSim(base({ nextWorks: false }));
  await sim.start(90);
  await sim.run(5.3);
  assert.strictEqual(sim.clicks, 1);
  assert.ok(sim.fg() < 0.05);
  await sim.run(4.8);
  assert.strictEqual(sim.vid(), 'B');
  await sim.run(2);
  assert.strictEqual(sim.fg(), 1);
});

test('sim: a missing next button -> no click, nothing lowered', async () => {
  const sim = createSim(base());
  sim.w.document.querySelector('.next-button')!.remove();
  await sim.start(90);
  await sim.run(6);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.fg(), 1);
  assert.strictEqual(sim.snapshots.length >= 0, true);
});

test('sim: an exception in the planner -> no transition and the gain stays 1', async () => {
  const broken = Object.assign({}, A, {
    transitionStep: () => {
      throw new Error('injected');
    },
  });
  const sim = createSim(base({ analysis: broken }));
  await sim.start(90);
  await sim.run(6);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.fg(), 1);
  assert.ok(sim.status.errors > 0);
});

test('sim: an exception after the click (during the incoming track) restores 1', async () => {
  let armed = false;
  const broken = Object.assign({}, A, {
    planHeadTrim: () => {
      armed = true;
      throw new Error('injected');
    },
  });
  const sim = createSim(base({ analysis: broken }));
  await sim.start(90);
  await sim.run(5.5);
  assert.ok(armed);
  await sim.run(1);
  assert.strictEqual(sim.fg(), 1);
});

test('sim: head rush (verification switch on the plain path) plays an exact head silence at 3x, back to 1 before the first sound, then fades in', async () => {
  const sim = createSim(
    base({ index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110, { fs: 1.2, fx: true }) } }),
  );
  sim.w.__fadewiseHeadMode = 'rate';
  await sim.start(90);
  await sim.run(6);
  assert.strictEqual(sim.vid(), 'B');
  assert.ok(!sim.diag.some((d) => d.kind === 'tr_head_trim'), 'no seek');
  const r = sim.diag.find((d) => d.kind === 'ov_rush');
  assert.ok(r && r.until === 0.95 && r.mode === 'plain', JSON.stringify(r));
  assert.ok(
    sim.rateLog.some(([, x]) => x === 3),
    'rate 3 during the head silence',
  );
  const e = sim.diag.find((d) => d.kind === 'ov_rush_end');
  assert.ok(e && e.toSec >= 0.85 && e.toSec <= 1.2 && e.wallSec < 0.45, JSON.stringify(e));
  const fi = sim.diag.find((d) => d.kind === 'tr_fade_in');
  assert.ok(fi && /^rush_/.test(fi.why) && fi.ct <= 1.25, JSON.stringify(fi));
  assert.deepStrictEqual([sim.rate(), sim.pp(), sim.fg()], [1, true, 1], 'overlap off: preservesPitch back on');
  assert.strictEqual(sim.status.fade.transition.incoming.headReason, 'rush_exact');
});

test('sim: head rush ends at once on a pause or a seek (rate 1)', async () => {
  for (const act of ['pause', 'seek']) {
    const sim = createSim(
      base({ index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110, { fs: 1.8, fx: true }) } }),
    );
    sim.w.__fadewiseHeadMode = 'rate';
    await sim.start(90);
    let at: number | null = null;
    await sim.run(7, (s) => {
      if (at === null && s.rate() === 3) {
        at = s.ctx.currentTime;
        if (act === 'pause') s.pause();
        else s.seek(30);
      }
    });
    assert.ok(at !== null, 'rush started');
    const e = sim.diag.find((d) => d.kind === 'ov_rush_end');
    assert.strictEqual(e && e.why, act);
    assert.strictEqual(sim.rate(), 1);
  }
});

test('sim: head trim seeks over an exact head silence (<= 2 s) and then fades in', async () => {
  const sim = createSim(
    base({ index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110, { fs: 1.2, fx: true }) } }),
  );
  await sim.start(90);
  await sim.run(6);
  assert.strictEqual(sim.vid(), 'B');
  const trim = sim.diag.find((d) => d.kind === 'tr_head_trim');
  assert.ok(trim && trim.to === 1.15 && trim.ct < 0.3, JSON.stringify(trim));
  const fi = sim.diag.find((d) => d.kind === 'tr_fade_in');
  assert.ok(fi && fi.why === 'seeked' && Math.abs(fi.ct - 1.15) < 0.02, JSON.stringify(fi));
  assert.strictEqual(sim.fg(), 1);
  assert.strictEqual(sim.status.fade.transition.incoming.headTrimTo, 1.15);
});

test('sim: no head trim for an inexact or long head silence', async () => {
  for (const extra of [
    { fs: 1.2, fx: false },
    { fs: 2.5, fx: true },
  ]) {
    const sim = createSim(base({ index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110, extra) } }));
    await sim.start(90);
    await sim.run(6);
    assert.strictEqual(sim.vid(), 'B');
    assert.ok(!sim.diag.some((d) => d.kind === 'tr_head_trim'));
    assert.ok(sim.diag.some((d) => d.kind === 'tr_fade_in' && d.why === 'playing'));
    assert.strictEqual(sim.status.fade.transition.incoming.headReason, extra.fx ? 'long' : 'not_exact');
  }
});

test('sim: a pause during the fade-in of the next track does not leave the gain down', async () => {
  const sim = createSim(base());
  await sim.start(90);
  await sim.run(5.22);
  assert.strictEqual(sim.vid(), 'B');
  sim.pause();
  await sim.run(1);
  assert.strictEqual(sim.fg(), 1);
});

test('sim: 20 back-to-back transitions through a long queue, gain 1 between them, one click each', async () => {
  const queue: string[] = [],
    tracks: Record<string, { d: number }> = {},
    index: Record<string, Loose> = {};

  for (let i = 0; i < 21; i++) {
    const v = 'T' + i;
    queue.push(v);
    tracks[v] = { d: 30 };
    index[v] = entry(30, i % 3 === 0 ? 'stop' : i % 3 === 1 ? 'fades' : 'decays', 26);
  }

  const sim = createSim({ queue, tracks, index });
  const w = watch();
  await sim.start(20);

  for (let i = 0; i < 20; i++) {
    await sim.run(27.5 - (i === 0 ? 20 : 0), w.fn);
  }

  assert.strictEqual(sim.clicks, 20);
  assert.strictEqual(sim.vid(), 'T20');
  const mid = w.seen.frames.filter(([, , ct]) => ct > 2 && ct < 24);
  assert.ok(mid.length > 100 && mid.every(([, , , g]) => g === 1));
});
