import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as Analysis from '../shared/analysis.mts';
import * as S from '../shared/settings.mts';
import fixtures from './fixtures/real-tracks.json' with { type: 'json' };
import { createSim, entry, type Loose, type Sim, type SimOptions } from './helpers/player-sim.mts';
import { createQueueSim, tk } from './helpers/queue-sim.mts';

const A: Loose = Analysis;
const FX: Loose = fixtures;

const __dirname = import.meta.dirname;

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

function minFade() {
  const seen: Record<string, number> = {};

  return {
    seen,
    fn: (s: Sim) => {
      const v = s.vid();
      seen[v] = Math.min(seen[v] ?? 1, s.fg());
    },
  };
}

test('excluded: no gain, no fade, no "next"; the listen is still analysed and sent for saving', async () => {
  const sim = createSim(
    base({
      settings: { gainEnabled: true },
      index: {
        A: Object.assign(entry(D, 'abrupt', 99), {
          en: { kind: 'abrupt', lastSoundSec: 99, silenceSec: 1, fadeSec: 3 },
        }),
        B: entry(120, 'fades', 110),
      },
    }),
  );
  sim.send('excluded', ['A']);
  const w = minFade();
  await sim.start(80);
  await sim.run(21, w.fn);
  assert.equal(sim.clicks, 0, 'no "next" pressed');
  assert.equal(w.seen.A, 1, 'fade stage untouched on A');
  assert.equal(sim.vid(), 'B', 'the player itself moved on');
  const snapA = sim.snapshots.filter((s) => s.videoId === 'A');
  assert.ok(snapA.length > 0, 'A still analysed and sent');
  const g = snapA[snapA.length - 1].applied.gain;
  assert.deepEqual([g.db, g.source], [0, 'excluded']);
  assert.equal(
    A.sanitizeApplied(snapA[snapA.length - 1].applied).gain.source,
    'excluded',
    'the code survives the service worker',
  );
});

test('excluded: switching the playing track on and off re-plans at once; status says so', async () => {
  const sim = createSim(base());
  await sim.start(80);
  await sim.run(1);
  assert.equal(sim.status.fade.transition.kind, 'trim');
  sim.send('excluded', ['A']);
  await sim.run(0.5);
  assert.equal(sim.status.excluded, true);
  assert.equal(sim.status.fade.transition.reason, 'excluded');
  assert.equal(sim.status.gainSource, 'excluded');
  await sim.run(14.5);
  assert.equal(sim.clicks, 0);
  sim.send('excluded', []);
  await sim.run(0.5);
  assert.equal(sim.status.excluded, false);
  assert.equal(sim.status.fade.transition.kind, 'trim', 'planned again (too late to act on this listen)');
});

test('excluded: a track entered by our own "next" starts untouched (no head seek, no fade-in)', async () => {
  const sim = createSim(
    base({ index: { A: entry(D, 'decays', 95), B: entry(120, 'fades', 110, { fs: 1, fx: true }) } }),
  );
  sim.send('excluded', ['B']);
  await sim.start(90);
  await sim.run(5.3);
  assert.equal(sim.clicks, 1);
  assert.equal(sim.vid(), 'B');
  await sim.run(0.1);
  assert.equal(sim.fg(), 1, 'back to 1 right away');
  assert.ok(sim.ct() < 0.5, `no head seek (${sim.ct()})`);
  assert.equal(sim.status.fade.transition.incoming.headReason, 'excluded');
});

test('excluded: the list is kept as { videoId: ms }, bad ids dropped, newest kept when over the limit', () => {
  let m = S.setExcluded(null, 'abcdefghijk', true, 5);
  m = S.setExcluded(m, 'not an id!', true, 6);
  assert.deepEqual(m, { abcdefghijk: 5 });
  assert.deepEqual(S.setExcluded(m, 'abcdefghijk', false), {});
  assert.deepEqual(S.sanitizeExcluded({ abcdefghijk: 'x', bcdefghijkl: -1, cdefghijklm: 7.6 }), { cdefghijklm: 8 });
  assert.deepEqual(S.sanitizeExcluded(['abcdefghijk']), {});
  const big: Record<string, number> = {};
  for (let i = 0; i < S.MAX_EXCLUDED + 3; i++) big['id' + String(i).padStart(9, '0')] = i + 1;
  const kept = S.sanitizeExcluded(big);
  assert.equal(Object.keys(kept).length, S.MAX_EXCLUDED);
  assert.ok(!('id000000000' in kept) && 'id' + String(S.MAX_EXCLUDED + 2).padStart(9, '0') in kept);
});

test('excluded: the queue ordering does not move a track left alone (no key / tempo for the planner)', async () => {
  const tracks = {
    cur: { tk: tk(120, '8A') },
    a: { tk: tk(150, '2B') },
    b: { tk: tk(95, '4B') },
    c: { tk: tk(121, '9A') },
    d: { tk: tk(122, '10A') },
  };
  const sim = createQueueSim({ ids: ['cur', 'a', 'b', 'c', 'd'], tracks });
  delete (tracks.c as Loose).tk;
  await sim.run(4);
  await sim.settle();
  const up = sim.upcoming();
  assert.equal(up.indexOf('c'), 2, `c keeps its slot: ${up.join()}`);
});

const abruptPrev = (last: number, d: number) => ({
  en: { kind: 'abrupt', lastSoundSec: last, silenceSec: +(d - last).toFixed(2), fadeSec: 3 },
  d,
});
test("gapless: album, the album's next track, an abrupt end and sound at once -> on; anything else -> off", () => {
  const prev = abruptPrev(199.95, 200);
  const next = { fs: 0, fx: true };
  const q = { album: true, albumNext: true };
  assert.deepEqual(A.gaplessPair(prev, next, q), { on: true, why: 'gapless' });
  assert.equal(A.gaplessPair(prev, { fs: 0.2, fx: true }, q).on, true, 'within the head-trim minimum');
  assert.equal(A.gaplessPair(prev, next, { album: false, albumNext: true }).why, 'not_album');
  assert.equal(A.gaplessPair(prev, next, { album: true, albumNext: false }).why, 'not_album_next', 'shuffled / moved');
  assert.equal(A.gaplessPair(prev, next, { album: true, albumNext: null }).why, 'not_album_next', 'position unknown');
  for (const kind of ['fades', 'decays', 'stop', 'unknown'])
    assert.equal(A.gaplessPair({ en: { kind, lastSoundSec: 190 } }, next, q).why, 'ending', kind);
  assert.equal(A.gaplessPair(null, next, q).why, 'ending', 'previous not analysed');
  assert.equal(A.gaplessPair(prev, { fs: 0.3, fx: true }, q).why, 'head', 'a silence the transition would trim');
  assert.equal(A.gaplessPair(prev, { fs: 0, fx: false }, q).why, 'head', 'first sound only bounded');
  assert.equal(A.gaplessPair(prev, null, q).why, 'head', 'next not analysed');
});

const fxEntry = (t: Loose) =>
  A.indexEntryOf({
    integratedLufs: t.integratedLufs,
    coverage: t.coverage,
    lastSoundSec: t.lastSoundSec,
    durationSec: t.durationSec,
    tail: t.tail,
    headProfile: t.head.headProfile,
    firstSoundSec: t.head.firstSoundSec,
    firstSoundExact: t.head.firstSoundExact,
  });
test('gapless: real tracks - which endings / heads qualify (fixtures, 40 tracks)', () => {
  const E = Object.fromEntries(FX.tracks.map((t: Loose) => [t.label, fxEntry(t)]));
  const prevOk = FX.tracks
    .filter((t: Loose) => E[t.label].en && E[t.label].en.kind === 'abrupt')
    .map((t: Loose) => t.label);
  assert.deepEqual(prevOk, ['acoustic-2', 'rock-4', 'hiphop-3', 'live-3', 'live-4']);
  const nextOk = FX.tracks
    .filter((t: Loose) => A.gaplessPair(abruptPrev(199.9, 200), E[t.label], { album: true, albumNext: true }).on)
    .map((t: Loose) => t.label);
  assert.deepEqual(nextOk, [
    'classical-1',
    'classical-4',
    'acoustic-4',
    'rock-1',
    'rock-2',
    'rock-4',
    'rock-5',
    'edm-3',
    'edm-4',
    'hiphop-1',
    'hiphop-3',
    'hiphop-5',
    'ambient-4',
    'live-3',
    'live-4',
  ]);
  let on = 0,
    total = 0;

  for (const a of FX.tracks)
    for (const b of FX.tracks) {
      if (a === b) continue;
      total++;
      const g = A.gaplessPair(E[a.label], E[b.label], { album: true, albumNext: true });

      if (g.on) {
        on++;
        assert.ok(prevOk.includes(a.label) && nextOk.includes(b.label));
      }
    }

  assert.equal(on, prevOk.length * nextOk.length - prevOk.filter((x) => nextOk.includes(x)).length);
  assert.equal(total, 40 * 39);
  assert.equal(A.gaplessPair(E['live-3'], E['live-4'], { album: true, albumNext: true }).on, true);
  assert.equal(A.gaplessPair(E['live-3'], E['live-4'], { album: false, albumNext: null }).on, false);
});

const ALBUM = 'https://music.youtube.com/watch?v=A&list=OLAK5uy_test';
const abruptA = () =>
  Object.assign(entry(D, 'abrupt', 99), { en: { kind: 'abrupt', lastSoundSec: 99, silenceSec: 1, fadeSec: 3 } });
test('gapless (sim): in an album, the cut end into an immediate start gets no fade-out, no "next", and the next track no fade-in', async () => {
  const sim = createSim(
    base({
      url: ALBUM,
      albumPos: { A: 3, B: 4, C: 5 },
      index: { A: abruptA(), B: entry(120, 'fades', 110, { fs: 0, fx: true, h0: -9 }) },
    }),
  );
  const w = minFade();
  await sim.start(80);
  await sim.run(1);
  assert.equal(sim.status.fade.gapless, true);
  assert.equal(sim.status.fade.transition.reason, 'gapless');
  assert.equal(sim.status.fade.fadeOutStart, null);
  await sim.run(20.5, w.fn);
  assert.equal(sim.clicks, 0, 'the player switched by itself');
  assert.equal(sim.vid(), 'B');
  assert.equal(w.seen.A, 1, 'no fade-out on A');
  assert.equal(w.seen.B, 1, 'no cut-in fade-in on B');
  assert.equal(sim.status.recent.gapless.to, 'B');
});

test('gapless (sim): the same pair keeps its fade when the queue is not the album order (shuffled, or not an album)', async () => {
  const sh = createSim(
    base({ url: ALBUM, albumPos: { A: 3, B: 7, C: 4 }, index: { A: abruptA(), B: entry(120, 'fades', 110) } }),
  );
  const w = minFade();
  await sh.start(80);
  await sh.run(19.5, w.fn);
  assert.ok(w.seen.A < 0.1, `faded (${w.seen.A})`);
  assert.equal(sh.clicks, 1);
  const pl = createSim(
    base({
      url: 'https://music.youtube.com/watch?v=A&list=PLx',
      albumPos: { A: 3, B: 4 },
      index: { A: abruptA(), B: entry(120, 'fades', 110) },
    }),
  );
  await pl.start(80);
  await pl.run(19.5);
  assert.equal(pl.clicks, 1);
  assert.equal(pl.status.recent.tr.kind, 'fade_trim');
});

test("gapless (sim): the next track changing to the album's next one mid-track switches the plan before the fade", async () => {
  const sim = createSim(
    base({
      url: ALBUM,
      albumPos: { A: 3, B: 4, C: 9 },
      queue: ['A', 'C', 'B'],
      tracks: { A: { d: D }, B: { d: 120 }, C: { d: 90 } },
      index: { A: abruptA(), B: entry(120, 'fades', 110), C: entry(90, 'decays', 85) },
    }),
  );
  await sim.start(80);
  await sim.run(1);
  assert.equal(sim.status.fade.gapless, false);
  sim.queue = ['A', 'B', 'C'];
  sim.renderQueue();
  await sim.run(2);
  assert.equal(sim.status.fade.gapless, true);
  const w = minFade();
  await sim.run(17.5, w.fn);
  assert.equal(w.seen.A, 1);
  assert.equal(sim.clicks, 0);
});

test('gapless: the queue ordering keeps both tracks of a gapless pair in their slots', async () => {
  const tracks = {
    cur: { tk: tk(120, '8A') },
    a: { tk: tk(150, '2B') },
    b: { tk: tk(95, '4B') },
    c: { tk: tk(121, '9A') },
    d: { tk: tk(122, '10A') },
    e: { tk: tk(120, '8B') },
  };
  const free = createQueueSim({
    ids: ['cur', 'a', 'b', 'c', 'd', 'e'],
    tracks,
    list: 'OLAK5uy_x',
    settings: { reorderAlbums: true },
  });
  await free.run(4);
  await free.settle();
  assert.notDeepEqual(free.upcoming(), ['a', 'b', 'c', 'd', 'e'], 'moves without the pair');
  const sim = createQueueSim({
    ids: ['cur', 'a', 'b', 'c', 'd', 'e'],
    tracks,
    list: 'OLAK5uy_x',
    settings: { reorderAlbums: true },
  });
  sim.fixedIds = ['a', 'b'];
  await sim.run(4);
  await sim.settle();
  const up = sim.upcoming();
  assert.deepEqual([up[0], up[1]], ['a', 'b'], `pair kept: ${up.join()}`);
});

let C: Loose, I: Loose;
test.before(async () => {
  (globalThis as Loose).chrome = {
    storage: { session: { get: () => Promise.resolve({}) }, local: { get: () => Promise.resolve({}) } },
  };
  I = await import(path.join(__dirname, '..', 'ui', 'i18n.mts'));
  C = await import(path.join(__dirname, '..', 'ui', 'common.mts'));
});

test('summary: gain, the last gap and the last ordering in short lines (ja / en); stale or empty ones are left out', () => {
  const now = 1e12;
  const st = {
    at: now - 1000,
    videoId: 'A',
    appliedGainDb: -3.24,
    gainSource: 'analysis',
    recent: {
      tr: { at: now - 30000, from: 'Z', kind: 'trim', skipSec: 4.2, fadeSec: null, headTrimSec: 0.6 },
      gapless: null,
    },
  };
  I.setLang('ja');
  assert.deepEqual(C.summaryPairs(st, { at: now - 5000, result: 'done', moved: 2 }, now), [
    ['音量', '-3.2 dB（保存済みの解析値）'],
    ['前の曲から', ['終わりの無音 4.2 秒を飛ばした', '始まりの無音 0.6 秒を飛ばした']],
    ['並べ替え', '2 曲を移動'],
  ]);
  I.setLang('en');
  assert.deepEqual(
    C.summaryPairs(
      Object.assign({}, st, {
        recent: { tr: Object.assign({}, st.recent.tr, { kind: 'fade_trim', fadeSec: 3, headTrimSec: null }) },
      }),
      null,
      now,
    ),
    [
      ['Volume', '-3.2 dB (saved analysis)'],
      ['From the last track', ['skipped 4.2 s of silence at the end', 'faded out over 3.0 s']],
    ],
  );
  assert.equal(C.recentReorderText({ at: now - 1000, result: 'skipped', reason: 'same' }, now), null);
  assert.equal(C.recentReorderText({ at: now - 11 * 60 * 1000, result: 'done', moved: 3 }, now), null);
  assert.equal(
    C.recentTransitionText({ tr: st.recent.tr, gapless: { at: now - 1000, from: 'A', to: 'B' } }, now),
    'tracks run into each other, left as is',
  );
  assert.equal(
    C.gainShortText({ excluded: true, gainSource: 'excluded', appliedGainDb: 0 }),
    'not adjusted for this track',
  );
  assert.equal(C.gainShortText({ gainSource: 'off', appliedGainDb: 0 }), null);
  assert.equal(C.summaryPairs({ at: now - 20000 }, null, now), null, 'nothing playing');
  const pairs = C.nowPairs(Object.assign({}, st, { at: Date.now(), state: 'analyzing' }), null, { brief: true }).map(
    (p: string) => p[0],
  );
  assert.ok(!pairs.includes('Volume change') && !pairs.includes('Track'), pairs.join());
  const full = C.nowPairs(Object.assign({}, st, { at: Date.now(), state: 'analyzing' }), null).map((p: string) => p[0]);
  assert.ok(full.includes('Volume change') && full.includes('Track'));
});

test('summary (sim): the page reports what the last transition skipped, faded and trimmed', async () => {
  const sim = createSim(base({ index: { A: abruptA(), B: entry(120, 'fades', 110, { fs: 1, fx: true }) } }));
  await sim.start(80);
  await sim.run(19.5);
  assert.equal(sim.clicks, 1);
  await sim.run(1.5);
  const tr = sim.status.recent.tr;
  assert.equal(tr.kind, 'fade_trim');
  assert.equal(tr.fadeSec, 3);
  assert.ok(Math.abs(tr.skipSec - 1) < 0.15, `skip ${tr.skipSec}`);
  assert.ok(tr.headTrimSec > 0.8 && tr.headTrimSec < 1, `head ${tr.headTrimSec}`);
});
