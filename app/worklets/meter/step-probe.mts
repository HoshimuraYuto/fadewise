import { type Channels } from './biquad.mts';

export type ProbeRow = (number | string)[];

const START_BLOCKS = 24;
const WARMUP_SAMPLES = 256;
const DIP_SAMPLES = 8;
const ZERO_RUN = 32;
const LOUD_HOLD = 4800;

const peakOf = (c: Float32Array | undefined): number => {
  let m = 0;
  if (c) for (const x of c) m = Math.max(m, Math.abs(x));

  return +m.toFixed(4);
};

// diagnostic builds only; never records the audio itself
export class StepProbe {
  out: ProbeRow[] = [];
  readonly decay = Math.exp(-1 / (0.005 * sampleRate));
  blocksSeen = 0;
  // index 0: the element, 1: after the fades
  readonly prev: (number | null)[] = [null, null];
  readonly prev2 = [0, 0];
  readonly peakStep = [0, 0];
  readonly warmup = [WARMUP_SAMPLES, WARMUP_SAMPLES];
  readonly zeroRun = [0, 0];
  readonly loudFor = [0, 0];
  readonly d2MeanSquare = [0, 0];
  readonly meanSquare = [0, 0];
  readonly lowRun = [0, 0];
  dipRow: number | undefined;

  addBlock(first: Channels, second: Channels): void {
    if (this.blocksSeen < START_BLOCKS) {
      this.blocksSeen++;
      this.out.push([0, 'blk', +currentTime.toFixed(5), peakOf(first?.[0]), peakOf(second?.[0])]);
    }

    this.add(0, first?.[0], currentTime);
    if (second) this.add(1, second[0], currentTime);
  }

  add(k: number, data: Float32Array | undefined, t0: number): void {
    if (!data) return;

    for (let i = 0; i < data.length; i++) {
      const y = data[i];
      const at = t0 + i / sampleRate;
      this.dip(k, y, at);
      const p = this.prev[k];
      if (p !== null) this.secondDifference(k, y, p, at);
      this.zeros(k, y, t0 + (i - 31) / sampleRate);

      if (p === null) this.prev[k] = y;
      else this.step(k, y, p, at);
    }
  }

  dip(k: number, y: number, at: number): void {
    const rms = Math.sqrt(this.meanSquare[k]);

    if (rms > 0.03 && Math.abs(y) < 0.02 * rms) {
      if (++this.lowRun[k] === DIP_SAMPLES && this.out.length < 80) {
        this.dipRow = this.out.length;
        this.out.push([k, 'dip', +at.toFixed(5), +rms.toFixed(3), DIP_SAMPLES]);
      }
    } else {
      const row = this.dipRow === undefined ? undefined : (this.out[this.dipRow] as ProbeRow | undefined);
      if (this.lowRun[k] >= DIP_SAMPLES && row) row[4] = this.lowRun[k];
      this.lowRun[k] = 0;
    }

    this.meanSquare[k] = this.meanSquare[k] * this.decay + y * y * (1 - this.decay);
  }

  secondDifference(k: number, y: number, p: number, at: number): void {
    const d2 = y - 2 * p + this.prev2[k];
    if (this.warmup[k] === 0 && d2 * d2 > 36 * this.d2MeanSquare[k] && Math.abs(d2) > 0.02 && this.out.length < 80)
      this.out.push([k, 'd2', +at.toFixed(5), +Math.abs(d2).toFixed(4)]);
    this.d2MeanSquare[k] = this.d2MeanSquare[k] * this.decay + d2 * d2 * (1 - this.decay);
    this.prev2[k] = p;
  }

  zeros(k: number, y: number, runStart: number): void {
    if (y === 0) {
      if (++this.zeroRun[k] === ZERO_RUN && this.loudFor[k] > 0 && this.out.length < 40)
        this.out.push([k, 'zero', +runStart.toFixed(5), 0]);
    } else {
      this.zeroRun[k] = 0;
      this.loudFor[k] = Math.abs(y) > 0.003 ? LOUD_HOLD : Math.max(0, this.loudFor[k] - 1);
    }
  }

  step(k: number, y: number, p: number, at: number): void {
    const d = Math.abs(y - p);
    if (this.warmup[k] > 0) this.warmup[k]--;
    else if (d > 0.003 && d > 3 * this.peakStep[k] && this.out.length < 40)
      this.out.push([k, 'step', +at.toFixed(5), +d.toFixed(4)]);
    this.peakStep[k] = Math.max(d, this.peakStep[k] * this.decay);
    this.prev[k] = y;
  }

  take(): ProbeRow[] {
    const o = this.out;
    this.out = [];

    return o;
  }
}
