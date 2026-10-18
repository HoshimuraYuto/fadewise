import test from 'node:test';
import * as Analysis from '../shared/analysis.mts';
import { startBridge } from '../content/bridge.mts';
import assert from 'node:assert';
import { createSim, entry, type Loose, type SimOptions } from './helpers/player-sim.mts';

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

test('robust: "previous" right after our advance (next track still loading) brings the gain back within about 1 s', async () => {
  const sim = createSim(base());
  sim.nextLoadsPaused = true;
  await sim.start(90);
  await sim.run(5.25);
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.vid(), 'B');
  assert.strictEqual(sim.fg(), 0, 'held at 0 across our own switch');
  sim.nextLoadsPaused = false;
  sim.w.document.getElementById('prev')!.click();
  assert.strictEqual(sim.vid(), 'A');
  await sim.run(1.4);
  assert.strictEqual(sim.fg(), 1, 'not left at 0 until the 8 s limit');
  assert.strictEqual(sim.status.fade.transition.state, 'idle');
  await sim.run(95.3 - sim.ct());
  assert.strictEqual(sim.clicks, 2);
  assert.strictEqual(sim.vid(), 'B');
});

test('robust: the next track reported late (same videoId for a moment) is not mistaken for going back', async () => {
  const sim = createSim(base());
  await sim.start(90);
  await sim.run(5.25);
  assert.strictEqual(sim.vid(), 'B');
  await sim.run(0.5);
  assert.strictEqual(sim.fg(), 1, 'normal fade-in');
  assert.strictEqual(sim.status.fade.transition.incoming.cancel, null);
});

test('robust: extension reloaded while armed -> the orphaned page script stops (gain 1, no "next", no snapshots)', async () => {
  const sim = createSim(base());
  await sim.start(88);
  await sim.run(1);
  assert.strictEqual(sim.status.fade.transition.state, 'armed');
  sim.send('detached', null);
  const snaps = sim.snapshots.length;
  await sim.run(12);
  assert.strictEqual(sim.clicks, 0, 'no press of "next" after the extension is gone');
  assert.strictEqual(sim.fg(), 1);
  assert.strictEqual(sim.vid(), 'B', 'the player moved on by itself');
  await sim.run(1);
  assert.strictEqual(sim.fg(), 1, 'no fade-in by the orphan');
  assert.strictEqual(sim.snapshots.length, snaps, 'nothing sent for saving');
  sim.send('settings', { transitions: true, fadesEnabled: true, saveAnalysis: true });
  await sim.run(1);
  assert.strictEqual(sim.status.detached, true);
});

test('robust: extension reloaded during a fade-out -> the gain goes back to 1 at once', async () => {
  const cut = entry(D, 'abrupt', 99.9);
  cut.en = { kind: 'abrupt', lastSoundSec: 99.9, silenceSec: 0.1, fadeSec: 3, endRelLu: -2 };
  const sim = createSim(base({ index: { A: cut, B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) } }));
  await sim.start(90);
  await sim.run(8.2);
  assert.ok(sim.fg() < 0.9, `fading ${sim.fg()}`);
  sim.send('detached', null);
  await sim.run(0.1);
  assert.strictEqual(sim.fg(), 1);
});

const quietTail = (vid: string, ct: number) => (vid === 'A' && ct > 95 ? 0 : 1e-3);

for (const mode of ['reload', 'seek'] as const) {
  test(`robust: 1-track repeat (${mode}) starts a new listen; the ended listen keeps its real last sound`, async () => {
    const sim = createSim(base({ energyAt: quietTail, index: {} }));
    sim.repeatOne = mode;
    sim.w.document.querySelector('ytmusic-player-bar')!.setAttribute('repeat-mode', 'ONE');
    await sim.start(80);
    await sim.run(20 + 12);
    assert.strictEqual(sim.vid(), 'A');
    assert.ok(sim.ct() > 10 && sim.ct() < 13, `looped, at ${sim.ct()}`);
    const sessions = [...new Set(sim.snapshots.map((s) => s.sessionId))];
    assert.ok(sessions.length >= 2, `a new listen after the loop (${sessions.length})`);
    const first = sim.snapshots.filter((s) => s.sessionId === sessions[0]);
    const fin = first.filter((s) => s.final).pop() || first.pop();
    assert.ok(
      fin!.lastSound && fin!.lastSound.pos > 94 && fin!.lastSound.pos <= 95.1,
      `last sound ${JSON.stringify(fin!.lastSound)}`,
    );

    for (const s of sim.snapshots) {
      if (s.lastSound)
        assert.ok(s.lastSound.pos > 90, `no head frame taken as the last sound: ${s.lastSound.pos} (${s.sessionId})`);
    }
  });
}

test('robust: addFrame forgets "reached the end" when the position goes back to the head', () => {
  const A = Analysis;
  const s = A.createSession('x', 100);
  for (let p = 98; p <= 100; p += 0.1) A.addFrame(s, +p.toFixed(1), 1e-3, 0.1, true);
  A.markEnded(s, 100);
  assert.strictEqual(s.reachedEnd, true);
  A.addFrame(s, 0.1, 1e-3, 0.1, false);
  assert.strictEqual(s.reachedEnd, false);
  assert.strictEqual(A.sessionSnapshot(s).lastSound, null);
});

test('robust: a stored tail from mid-track (written by the repeat bug) plans nothing and is learned again', () => {
  const A: Loose = Analysis;
  const tailAt = (endPos: number, lastLoudAt: number) => ({
    endPos,
    lufs: Array.from({ length: 200 }, (_, i) => (endPos - (199 - i) * 0.1 <= lastLoudAt ? -12 : -90)),
  });
  const cells = Array.from({ length: 228 }, (_, i) => [i, 10, -12, -3]);
  const bad = {
    videoId: 'kkkkkkkkkkk',
    durationSec: 228.16,
    cells,
    integratedLufs: -12,
    lastSoundSec: 122.81,
    tail: tailAt(122.81, 122.8),
    logicVersion: A.LOGIC_VERSION,
  };
  assert.strictEqual(A.indexEntryOf(bad).en, null, 'no ending from a tail that stops 105 s before the end');
  assert.strictEqual(A.planTransition(A.indexEntryOf(bad), { enabled: true }).kind, 'none');
  const snap = {
    videoId: 'kkkkkkkkkkk',
    durationSec: 228.16,
    cells: [],
    acceptedSec: 30,
    lastSound: { pos: 228.1, exact: true },
    tailFrames: tailAt(228.1, 228.1),
  };
  const r = A.mergeRecord(bad, snap, 1);
  assert.strictEqual(r.lastSoundSec, 228.1);
  assert.strictEqual(r.tail.endPos, 228.1);
  const r2 = A.mergeRecord(bad, { videoId: 'kkkkkkkkkkk', durationSec: 228.16, cells: [], acceptedSec: 30 }, 1);
  assert.strictEqual(r2.tail, null);
  assert.strictEqual(r2.lastSoundSec, null);
  assert.strictEqual(r2.ending, null);
  const live = A.mergeRecord(
    null,
    Object.assign({}, snap, { lastSound: { pos: 224.9, exact: true }, tailFrames: tailAt(225.2, 224.9) }),
    1,
  );
  assert.strictEqual(live.lastSoundSec, 224.9);
  assert.ok(live.tail && A.indexEntryOf(live).en, 'ending kept');
});

test('robust: the bridge tells the page once when the extension context is gone', () => {
  const area = () => ({
    data: {},
    get: () => Promise.resolve({}),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  });
  let alive = true;
  const runtime = { getURL: (p: string) => 'chrome-extension://x/' + p, sendMessage: () => Promise.resolve(null) };
  Object.defineProperty(runtime, 'id', {
    get: () => {
      if (!alive) throw new Error('Extension context invalidated.');

      return 'x';
    },
  });
  const chrome = { runtime, storage: { local: area(), session: area(), onChanged: { addListener: () => {} } } };
  const listeners: ((e: Loose) => void)[] = [],
    toMain: Loose[] = [];
  const win: Loose = {
    addEventListener: (t: string, f: (e: Loose) => void) => {
      if (t === 'message') listeners.push(f);
    },
    postMessage: (m: Loose) => toMain.push(m),
  };
  win.location = { origin: 'https://music.youtube.com' };
  win.document = { documentElement: {} };
  startBridge({
    win: win as unknown as Window,
    chrome: chrome as unknown as typeof globalThis.chrome,
    startAutoContinue: () => ({}) as never,
  });

  const fromMain = (type: string, data: unknown) => {
    for (const f of listeners) f({ source: win, data: { fadewise: 'main', type, data } });
  };

  fromMain('status', {});
  assert.strictEqual(toMain.filter((m) => m.type === 'detached').length, 0);
  alive = false;
  fromMain('status', {});
  fromMain('snapshot', { videoId: 'aaaaaaaaaaa' });
  fromMain('status', {});
  assert.strictEqual(toMain.filter((m) => m.type === 'detached').length, 1);
});
