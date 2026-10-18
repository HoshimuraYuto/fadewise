import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueSim, tk, H, type QueueSim, type QueueSimOptions } from './helpers/queue-sim.mts';

const N = 20;
const IDS = Array.from({ length: N }, (_, i) => `t${String(i).padStart(2, '0')}`);
const keys = ['8A', '3B', '10A', '5B', '8B', '1A', '9A', '12B', '7A', '4B', '11A', '6B'];
const TRACKS = Object.fromEntries(IDS.map((id, i) => [id, { tk: tk(90 + ((i * 37) % 70), keys[i % keys.length]) }]));
const album = (over?: Partial<QueueSimOptions>) =>
  createQueueSim(
    Object.assign(
      {
        ids: IDS.slice(),
        tracks: TRACKS,
        timing: {},
        list: 'OLAK5uy_x',
        tail: 50,
        flags: { edgeScroll: true },
        settings: { reorder: true, reorderAlbums: true },
      },
      over,
    ),
  );
const drops = (sim: QueueSim) => sim.events.filter((e) => e[0] === 'drop').length;

test("album: a move to the queue's last row lands there; YTM's edge scrolling never runs", async () => {
  const sim = album();
  const vid = IDS[3];
  const r = await sim.qdom.drag(vid, N - 1, () => null);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.drops, r.hops, 'one drop per release');
  assert.ok(r.hops! >= 2, 'a move longer than the band is made in hops');
  assert.equal(sim.ids().indexOf(vid), N - 1);
  assert.equal(sim.edgeScrolls, 0, 'the list never scrolled by itself');
  assert.ok(!sim.events.some((e) => e[0] === 'tail_release'));
});

test('album: every long move, both ways, lands with one drop per hop and without edge scrolling', async () => {
  for (const [from, to, start] of [
    [1, 19, 0],
    [19, 1, 400],
    [2, 15, 0],
    [18, 4, 0],
    [5, 19, 200],
  ]) {
    const sim = album();
    sim.scroll = start;
    const vid = IDS[from];
    const r = await sim.qdom.drag(vid, to, () => null);
    assert.equal(r.ok, true, `${from}->${to}: ${JSON.stringify(r)}`);
    assert.equal(sim.ids().indexOf(vid), to, `${from}->${to}`);
    assert.equal(r.drops, r.hops);
    assert.ok(sim.qdom.ownScroll().n <= r.hops!, `${from}->${to}: one scroll per hop at most`);
    assert.equal(sim.edgeScrolls, 0, `${from}->${to}: edge scroll`);
  }
});

test('album: the simulator reproduces the old failure (pointer held in the edge zone, released below the queue)', () => {
  const sim = album();
  const doc = sim.doc;
  const row = Array.from(doc.querySelectorAll('ytmusic-player-queue-item'))[3];
  const fire = (type: string, y: number, t?: Element | null) =>
    (t || doc.elementFromPoint(200, y) || row).dispatchEvent(
      new sim.w.MouseEvent(type, { bubbles: true, clientX: 200, clientY: y }),
    );
  let y = 60 + 3 * H + H / 2;
  fire('pointerdown', y, row.querySelector('.song-info'));

  for (let k = 0; k < 600; k++) {
    y = Math.min(736, y + 3);
    fire('pointermove', y);
  }

  fire('pointerup', y, row);
  assert.equal(drops(sim), 1, 'the drop fired');
  assert.equal(sim.ids().indexOf(IDS[3]), 3, 'but the row went back');
  assert.ok(sim.edgeScrolls > 0);
});

test('album: a whole run (6 moves) is done; at most one scroll per hop, one restore', async () => {
  for (const start of [0, 300]) {
    const sim = album();
    sim.scroll = start;
    await sim.run(7.5);
    await sim.settle();
    await sim.run(1);
    const run = sim.runs[sim.runs.length - 1];
    assert.equal(run.result, 'done', `${start}: ${JSON.stringify(run)}`);
    assert.equal(run.moved, run.planned);
    assert.equal(sim.edgeScrolls, 0);
    const sc = sim.debug.filter((v) => v.ev === 'scroll');
    assert.ok(
      sc.every((v) => v.src === 'ext'),
      JSON.stringify(sc),
    );
    const during = sc.filter((v) => v.why !== 'restore');
    assert.equal(sc.filter((v) => v.why === 'restore').length, during.length ? 1 : 0);
    assert.equal(sim.scroll, start, 'back where the user was');
    assert.ok(during.length <= 2 * run.moved, JSON.stringify(sc));
  }
});

test('scroll: a move whose rows are both in the band needs no scroll at all', async () => {
  const sim = album();
  sim.scroll = 0;
  const r = await sim.qdom.drag(IDS[4], 9, () => null);
  assert.equal(r.ok, true);
  assert.equal(sim.ids().indexOf(IDS[4]), 9);
  assert.equal(sim.qdom.ownScroll().n, 0);
});

test("scroll: a pressed row near the panel's edge is not scrolled to first when the target is in the band", async () => {
  const sim = album();
  sim.scroll = 0;
  const r = await sim.qdom.drag(IDS[1], 8, () => null);
  assert.equal(r.ok, true);
  assert.equal(sim.ids().indexOf(IDS[1]), 8);
  assert.equal(sim.qdom.ownScroll().n, 0);
  assert.equal(sim.edgeScrolls, 0);
});

test('scroll: a move that cannot be reached stops (not_visible) after the hops that went somewhere, one drop each', async () => {
  const sim = album({ flags: {} });
  const q = sim.qdom;
  Object.defineProperty(sim.doc.querySelector('ytmusic-player-queue'), 'scrollHeight', {
    get: () => 680,
    configurable: true,
  });
  const r = await q.drag(IDS[2], N - 1, () => null);
  assert.equal(r.ok, false);
  assert.equal(r.stopped, 'not_visible');
  assert.equal(r.drops, r.hops);
  assert.ok(sim.ids().indexOf(IDS[2]) < N - 1);
});

test('scroll: a stop asked for during a hop steers the row back to where that hop pressed it', async () => {
  const sim = album();
  let k = 0;
  const r = await sim.qdom.drag(IDS[1], N - 1, () => (++k === 5 ? 'paused' : null));
  assert.equal(r.ok, false);
  assert.equal(r.stopped, 'paused');
  assert.equal(r.hops, 1);
  assert.equal(sim.ids().indexOf(IDS[1]), 1);
});

test('scroll: a playlist without rows below it (the list at its end) still reaches its last row', async () => {
  const sim = album({ tail: 0, list: 'PLxyz' });
  const r = await sim.qdom.drag(IDS[2], N - 1, () => null);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sim.ids().indexOf(IDS[2]), N - 1);
  assert.equal(sim.edgeScrolls, 0);
});
