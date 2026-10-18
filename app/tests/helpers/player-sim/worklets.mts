import { Node, Param, type Clock } from './audio.mts';
import type { Loose, MediaState, OverlapModel, Port, Sim } from './types.mts';

const DRAIN_REPORT = {
  ev: 'report',
  why: 'done',
  silentWins: 0,
  wins: 10,
  minOutDb: -20,
  outClicks: 0,
  inClicks: 0,
  maxOutClick: 0,
  maxInClick: 0,
};

function delivery(port: Port) {
  return (...messages: Loose[]) => {
    const onmessage = port.onmessage;
    void Promise.resolve().then(() => {
      for (const data of messages) onmessage?.({ data });
    });
  };
}

function handleCommand(m: OverlapModel, c: Loose, post: (d: Loose) => void): void {
  if (c.cmd === 'capture' && m.mode === 'pass') {
    m.mode = 'capture';
    m.lead = 0;
    m.rate = c.rate;
    m.shape = c.shape;
    post({ ev: 'capture' });
  } else if (c.cmd === 'end' && m.mode === 'capture') {
    m.mode = 'drain';
    m.xfAt = null;
    post({ ev: 'drain', leadOutSec: +m.lead.toFixed(3) });
  } else if (c.cmd === 'flush' && (m.mode === 'capture' || m.mode === 'drain')) {
    post({ ev: 'flush', why: c.why as unknown, lostSec: +m.lead.toFixed(3) });
    if (m.mode === 'drain') post({ ev: 'drained', killed: true });
    else post({ ev: 'pass', why: 'flushed' });
    m.mode = 'pass';
    m.lead = 0;
  }
}

function drainStep(m: OverlapModel, ctx: Clock, port: Port, media: MediaState, dt: number, playing: boolean) {
  const deliver = delivery(port);

  if (m.xfAt === null && playing && media.ct > 0) {
    m.xfAt = ctx.currentTime;
    const remSec = +m.lead.toFixed(3);
    m.xfSec = remSec;
    port.postMessage?.({ cmd: 'noop' });
    m.posted.push({ ev: 'newSound' });
    deliver({ ev: 'newSound', remSec, xfSec: remSec });
  }

  m.lead = Math.max(0, m.lead - dt);

  if (m.xfAt !== null && m.lead <= 0) {
    m.mode = 'pass';
    m.posted.push({ ev: 'drained' });
    deliver({ ev: 'drained', killed: false }, DRAIN_REPORT);
  }
}

function createOverlapModel(node: Node, ctx: Clock, port: Port, media: MediaState): OverlapModel {
  const deliver = delivery(port);
  const m: OverlapModel = { node, mode: 'pass', lead: 0, msgs: [], posted: [], xfAt: null, step: () => {} };

  port.postMessage = (c) => {
    m.msgs.push(c);
    handleCommand(m, c, (d) => {
      m.posted.push(d);
      deliver(Object.assign({ t: ctx.currentTime }, d));
    });
  };

  m.step = (dt, playing, rateNow) => {
    if (m.mode === 'capture' && playing) m.lead += dt * (rateNow - 1);
    else if (m.mode === 'drain') drainStep(m, ctx, port, media, dt, playing);
  };

  return m;
}

export function makeWorkletNodeClass(sim: Sim, media: MediaState) {
  return class FakeAudioWorkletNode extends Node {
    port: Port;
    parameters?: { get: (k: string) => Param | undefined };

    constructor(ctx: Clock, name: string) {
      super(ctx);

      if (name !== 'fadewise-overlap') {
        this.port = {};
        sim.meter = this;

        return;
      }

      const params = new Map([
        ['gOld', new Param(ctx, 1)],
        ['kB', new Param(ctx, 1)],
      ]);
      this.parameters = { get: (k) => params.get(k) };
      this.port = { onmessage: null };
      sim.ov = createOverlapModel(this, ctx, this.port, media);
    }
  };
}
