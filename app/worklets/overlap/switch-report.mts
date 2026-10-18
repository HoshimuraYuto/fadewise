import { type Mode } from './types.mts';

type At = [sampleIndex: number, mode: Mode, size: number];

const WARMUP_SAMPLES = 256;

class StepFinder {
  readonly decay = Math.exp(-1 / (0.005 * sampleRate));
  prev: number | null = null;
  peak = 0;
  warmup = 0;

  next(y: number): number {
    if (this.prev === null) {
      this.prev = y;
      this.warmup = WARMUP_SAMPLES;

      return 0;
    }

    const d = Math.abs(y - this.prev);
    let found = 0;
    if (this.warmup > 0) this.warmup--;
    else if (d > 0.003 && d > 3 * this.peak) found = d;
    this.peak = Math.max(d, this.peak * this.decay);
    this.prev = y;

    return found;
  }
}

const dbOf = (energy: number, n: number) => (energy > 0 ? 10 * Math.log10(energy / n) : -200);

export class SwitchReport {
  readonly captureAt: number;
  switchAt: number | null = null;
  passAt: number | null = null;
  counting = false;
  readonly inSteps = new StepFinder();
  readonly outSteps = new StepFinder();
  inClicks = 0;
  outClicks = 0;
  maxInClick = 0;
  maxOutClick = 0;
  readonly inAt: At[] = [];
  readonly outAt: At[] = [];
  wins = 0;
  silentWins = 0;
  inSilentWins = 0;
  minOutDb = 0;
  readonly silentAt: At[] = [];
  outEnergy = 0;
  inEnergy = 0;
  n = 0;

  constructor(captureAt: number) {
    this.captureAt = captureAt;
  }

  steps(input: number, output: number, at: number, mode: Mode): void {
    const din = this.inSteps.next(input);

    if (din) {
      this.inClicks++;
      this.maxInClick = Math.max(this.maxInClick, din);
      if (this.inAt.length < 24) this.inAt.push([at, mode, +din.toFixed(3)]);
    }

    const dout = this.outSteps.next(output);

    if (dout) {
      this.outClicks++;
      this.maxOutClick = Math.max(this.maxOutClick, dout);
      if (this.outAt.length < 12) this.outAt.push([at, mode, +dout.toFixed(3)]);
    }
  }

  levels(in0: number, in1: number, out0: number, out1: number, windowLen: number, at: number, mode: Mode): void {
    if (mode === 'pass' && this.passAt === null) this.passAt = at;
    this.outEnergy += (out0 * out0 + out1 * out1) * 0.5;
    this.inEnergy += (in0 * in0 + in1 * in1) * 0.5;
    if (++this.n < windowLen) return;
    const db = dbOf(this.outEnergy, this.n),
      inDb = dbOf(this.inEnergy, this.n);
    this.wins++;
    if (db < this.minOutDb || this.wins === 1) this.minOutDb = db;
    if (inDb < -60) this.inSilentWins++;

    if (db < -60) {
      this.silentWins++;
      if (this.silentAt.length < 12) this.silentAt.push([at, mode, +Math.max(-120, inDb).toFixed(0)]);
    }

    this.outEnergy = 0;
    this.inEnergy = 0;
    this.n = 0;
  }

  summary(why: string, blockStart: number) {
    const ref = this.switchAt ?? blockStart,
      sec = (f: number) => +((f - ref) / sampleRate).toFixed(3);
    const inSec = (list: At[]) => list.map(([f, m, v]) => [sec(f), m, v]);

    return {
      why,
      silentWins: this.silentWins,
      inSilentWins: this.inSilentWins,
      wins: this.wins,
      minOutDb: +Math.max(-120, this.minOutDb).toFixed(1),
      outClicks: this.outClicks,
      inClicks: this.inClicks,
      maxOutClick: +this.maxOutClick.toFixed(4),
      maxInClick: +this.maxInClick.toFixed(4),
      silentAt: inSec(this.silentAt),
      outAt: inSec(this.outAt),
      inAt: inSec(this.inAt),
      aheadSec: this.switchAt === null ? null : +((this.switchAt - this.captureAt) / sampleRate).toFixed(2),
      handoverSec: this.passAt === null ? null : sec(this.passAt),
    };
  }
}
