import test from 'node:test';
import assert from 'node:assert';
import { createSim, entry, type Sim, type SimOptions } from './helpers/player-sim.mts';

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

type RepeatSource = { store?: string | null; pressed?: 'true' | 'false' | null };

function toMiniplayer(sim: Sim, rep: RepeatSource) {
  const doc = sim.w.document;
  const next = doc.getElementById('next')!;
  doc.querySelector('ytmusic-player-bar')!.remove();
  const mini = doc.createElement('ytmusic-miniplayer');
  const host = doc.createElement('div');
  host.className = 'ytmusicPlayerControlsControlButton ytmusicPlayerControlsNextButton';
  host.appendChild(next);
  mini.appendChild(host);

  if (rep.pressed !== undefined) {
    const rh = doc.createElement('div');
    rh.className = 'ytmusicPlayerControlsControlButton ytmusicPlayerControlsRepeatButton';
    const rb = doc.createElement('button');
    if (rep.pressed !== null) rb.setAttribute('aria-pressed', rep.pressed);
    rh.appendChild(rb);
    mini.appendChild(rh);
  }

  doc.body.appendChild(mini);

  if (rep.store !== undefined) {
    const q = doc.querySelector('ytmusic-player-queue') as HTMLElement & { queue?: unknown };
    q.queue = { store: { store: { getState: () => ({ queue: { repeatMode: rep.store } }) } } };
  }
}

const cancelOf = (sim: Sim): unknown =>
  (sim.status as { fade: { transition: { cancel: unknown } } }).fade.transition.cancel;

async function runA(rep: RepeatSource) {
  const sim = createSim(base());
  toMiniplayer(sim, rep);
  await sim.start(80);
  await sim.run(16);

  return sim;
}

test('miniplayer: our next presses the miniplayer button (repeat off in the page state)', async () => {
  const sim = await runA({ store: 'NONE', pressed: 'false' });
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.vid(), 'B');
});

test('miniplayer: repeat all still advances', async () => {
  const sim = await runA({ store: 'ALL', pressed: 'true' });
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.vid(), 'B');
});

test('miniplayer: repeat one (page state) -> no press, recorded as repeat_one', async () => {
  const sim = await runA({ store: 'ONE', pressed: 'true' });
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.vid(), 'A');
  assert.strictEqual(sim.fg(), 1);
  assert.strictEqual(cancelOf(sim), 'repeat_one');
});

test('miniplayer: no page state, button not pressed -> repeat off, presses', async () => {
  const sim = await runA({ pressed: 'false' });
  assert.strictEqual(sim.clicks, 1);
});

test('miniplayer: no page state, button pressed (all or one, unknown) -> no press', async () => {
  const sim = await runA({ pressed: 'true' });
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(sim.fg(), 1);
  assert.strictEqual(cancelOf(sim), 'repeat_one');
});

test('miniplayer: no repeat state at all -> no press', async () => {
  const sim = await runA({});
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(cancelOf(sim), 'repeat_one');
});

test('miniplayer: a page state that throws falls back to the button', async () => {
  const sim = createSim(base());
  toMiniplayer(sim, { pressed: 'false' });
  const q = sim.w.document.querySelector('ytmusic-player-queue') as HTMLElement & { queue?: unknown };
  q.queue = {
    store: {
      store: {
        getState: () => {
          throw new Error('injected');
        },
      },
    },
  };
  await sim.start(80);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 1);
  assert.strictEqual(sim.status.errors || 0, 0);
});

test('miniplayer: a disabled miniplayer next button is not pressed', async () => {
  const sim = createSim(base());
  toMiniplayer(sim, { store: 'NONE' });
  sim.w.document.getElementById('next')!.setAttribute('aria-disabled', 'true');
  await sim.start(80);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 0);
  assert.strictEqual(cancelOf(sim), 'disabled');
});

test('player bar: repeat one read from the page state when the bar has no attribute', async () => {
  const sim = createSim(base());
  const q = sim.w.document.querySelector('ytmusic-player-queue') as HTMLElement & { queue?: unknown };
  q.queue = { store: { store: { getState: () => ({ queue: { repeatMode: 'ONE' } }) } } };
  await sim.start(80);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 0);
});

test('player bar: no repeat information anywhere keeps pressing (unchanged)', async () => {
  const sim = createSim(base());
  await sim.start(80);
  await sim.run(16);
  assert.strictEqual(sim.clicks, 1);
});
