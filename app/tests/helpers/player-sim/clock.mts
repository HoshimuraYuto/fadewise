import type { MediaPage } from './media.mts';
import type { SimOptions, Sim } from './types.mts';

const STEP_SEC = 0.01;
const DEFAULT_ENERGY = 1e-3;

const nextTask = () => new Promise((r) => setTimeout(r, 0));

function advancePosition(sim: Sim, page: MediaPage): void {
  const { media, fire } = page;
  media.ct = +(media.ct + STEP_SEC * media.rate).toFixed(4);
  if (!Number.isFinite(media.dur) || media.ct < media.dur) return;

  if (sim.repeatOne === 'seek') {
    media.ct = 0;
    fire('seeking');
    fire('seeked');

    return;
  }

  media.ct = media.dur;
  media.ended = true;
  media.paused = true;
  fire('pause');
  fire('ended');
  if (sim.repeatOne === 'reload') sim.load(sim.qi);
  else if (sim.qi + 1 < sim.queue.length) sim.load(sim.qi + 1);
}

async function sendMeterFrame(sim: Sim, o: SimOptions, ct: number, onFrame?: (s: Sim) => void) {
  const onmessage = sim.meter?.port.onmessage;
  if (Math.round(sim.ctx.currentTime * 100) % 10 !== 0 || !onmessage) return;

  const e = o.energyAt ? o.energyAt(sim.vid(), ct) : DEFAULT_ENERGY;
  const p = e > 0 ? Math.min(1, Math.sqrt(e) * 3) : 0;
  onmessage({ data: { t: sim.ctx.currentTime, e, p, n: 4800, fx: null, cr: null } });
  await nextTask(); // window.postMessage is delivered on a task
  if (onFrame) onFrame(sim);
}

export function installClock(sim: Sim, page: MediaPage, o: SimOptions): void {
  const { media } = page;

  sim.run = async (sec, onFrame) => {
    const steps = Math.round(sec / STEP_SEC);

    for (let i = 0; i < steps; i++) {
      await Promise.resolve();
      sim.ctx.currentTime = +(sim.ctx.currentTime + STEP_SEC).toFixed(4);
      const playing = !media.paused && !media.ended;
      sim.ov?.step(STEP_SEC, playing, media.rate);
      if (playing) advancePosition(sim, page);
      await sendMeterFrame(sim, o, media.ct, onFrame);
    }

    await nextTask();
  };

  sim.start = async (startCt) => {
    sim.load(0, startCt);
    await sim.run(0.2);
  };
}
