import test from 'node:test';
import assert from 'node:assert';
import type { IndexEntry } from '../shared/types.mts';
import { createSim, entry, type Sim } from './helpers/player-sim.mts';

const D = 200;
const fades = Object.assign(entry(D, 'fades', 195), {
  en: { kind: 'fades', lastSoundSec: 195, silenceSec: 5, fadeSec: null, decaySec: 12, endRelLu: null },
  l: -8,
}) as IndexEntry;
const soft = { l: -20, c: 0.8, p: -12, fs: 0.2, fx: true, h0: -25, d: 180 } as IndexEntry;
const param = (sim: Sim, k: string) =>
  (sim.ov!.node as unknown as { parameters: { get: (k: string) => { value: number } } }).parameters.get(k).value;

for (const style of ['simple', 'auto'] as const)
  test(`${style}: the next track's id shows before the source changes: the remainder keeps the old gain`, async () => {
    const sim = createSim({
      queue: ['A', 'B'],
      // the same length: a length mismatch between the player and the element reads as an ad
      tracks: { A: { d: D }, B: { d: D } },
      index: { A: fades, B: soft },
      settings: { overlap: true, overlapStyle: style, leadRate: 1.25, gainEnabled: true },
      nextWorks: false,
    });
    // our own next: the player reports B at once, the element switches 0.3 s later
    let pending = false;
    sim.w.document.getElementById('next')!.addEventListener('click', () => {
      sim.qi = 1;
      pending = true;
    });
    await sim.start(150);
    await sim.run(1);
    const g = () => +sim.gains[0].gain.value.toFixed(4);
    while (!pending && sim.ct() < D) await sim.run(0.1);
    assert.ok(pending, 'advanced');
    assert.strictEqual(sim.ov!.mode, 'capture');
    const gOld = g();
    await sim.run(0.3);
    sim.load(1, 0);
    const seen: number[] = [];
    const mode = (): string => sim.ov!.mode;

    while (mode() !== 'pass' && seen.length < 200) {
      await sim.run(0.1);
      if (mode() === 'drain') seen.push(g());
    }

    await sim.run(0.3);
    const gNew = g();
    assert.ok(gNew > gOld * 1.5, `the next track is louder after the overlap (${gOld} -> ${gNew})`);
    assert.ok(
      seen.length > 5 && seen.every((x) => x === gOld),
      `the gain stage holds the old track's gain while it drains ${JSON.stringify(seen.slice(0, 8))}`,
    );
    assert.ok(Math.abs(param(sim, 'kB') - 1) < 1e-6, 'kB back at 1');
    assert.strictEqual(sim.status.errors, 0);
  });
