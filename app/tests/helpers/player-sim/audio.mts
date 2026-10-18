import type { Sim } from './types.mts';

type Ev =
  | { t: number; kind: 'set' | 'ramp'; v: number }
  | { t: number; kind: 'curve'; c: number[]; dur: number; v?: undefined };

export interface Clock {
  currentTime: number;
}

function curveValueAt(e: Extract<Ev, { kind: 'curve' }>, t: number): number {
  const x = ((t - e.t) / e.dur) * (e.c.length - 1);
  const i = Math.floor(x);

  return e.c[i] + (e.c[Math.min(i + 1, e.c.length - 1)] - e.c[i]) * (x - i);
}

export class Param {
  ctx: Clock;
  ev: Ev[];

  constructor(ctx: Clock, v: number) {
    this.ctx = ctx;
    this.ev = [{ t: -Infinity, kind: 'set', v }];
  }

  valueAt(t: number): number {
    let v = this.ev[0].v ?? 0;
    let prevT = -Infinity;

    for (const e of this.ev) {
      if (e.t > t) {
        if (e.kind === 'ramp') return v + (e.v - v) * ((t - prevT) / (e.t - prevT));
        break;
      }

      if (e.kind === 'curve') {
        if (t < e.t + e.dur) return curveValueAt(e, t);
        v = e.c[e.c.length - 1];
        prevT = e.t + e.dur;
        continue;
      }

      v = e.v;
      prevT = e.t;
    }

    return v;
  }

  get value(): number {
    return this.valueAt(this.ctx.currentTime);
  }

  set value(v: number) {
    this.ev = [{ t: -Infinity, kind: 'set', v }];
  }

  add(e: Ev) {
    this.ev.push(e);
    this.ev.sort((a, b) => a.t - b.t);
  }

  setValueAtTime(v: number, t: number) {
    this.add({ t, kind: 'set', v });
  }

  linearRampToValueAtTime(v: number, t: number) {
    this.add({ t, kind: 'ramp', v });
  }

  setValueCurveAtTime(c: ArrayLike<number>, t: number, dur: number) {
    this.add({ t, kind: 'curve', c: Array.from(c), dur });
  }

  cancelScheduledValues(t: number) {
    const keep = this.valueAt(t);
    this.ev = this.ev.filter((e) => e.t < t && !(e.kind === 'curve' && e.t + e.dur > t));
    if (!this.ev.length) this.ev = [{ t: -Infinity, kind: 'set', v: keep }];
  }
}

export class Node {
  ctx: Clock;
  outs: Node[];

  constructor(ctx: Clock) {
    this.ctx = ctx;
    this.outs = [];
  }

  connect(n: Node) {
    this.outs.push(n);

    return n;
  }

  disconnect() {
    this.outs = [];
  }
}

export type GainLike = Node & { gain: Param };

export function makeCtxClass(sim: Sim) {
  return class FakeAudioContext {
    currentTime = 0;
    state = 'running';
    sampleRate = 8000;
    destination: Node;
    audioWorklet = { addModule: async () => {} };

    constructor() {
      this.destination = new Node(this);
      sim.ctx = this;
    }

    createGain() {
      const g = Object.assign(new Node(this), { gain: new Param(this, 1) });
      sim.gains.push(g);

      return g;
    }

    createMediaElementSource() {
      return new Node(this);
    }

    createBiquadFilter() {
      return Object.assign(new Node(this), { frequency: new Param(this, 350), type: '' });
    }

    createConvolver() {
      return new Node(this);
    }

    createBuffer(channels: number, length: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));

      return { getChannelData: (i: number) => data[i] };
    }

    resume() {
      return Promise.resolve();
    }

    close() {}
  };
}

export type FakeContext = InstanceType<ReturnType<typeof makeCtxClass>>;
