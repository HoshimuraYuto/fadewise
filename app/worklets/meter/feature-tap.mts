import { lowpass, runBiquads, type Biquad, type Channels } from './biquad.mts';
import { SpectrumRing } from './spectrum.mts';

const ONSET_SIZE = 2048;
const CHROMA_SIZE = 8192;
const CHROMA_RATE = 12000;
const CHROMA_LOW_HZ = 65;
const CHROMA_HIGH_HZ = 2100;
const CHROMA_SPREAD = 0.4;

// BeatRoot expects spectral flux at 100 values/s.
class OnsetTap {
  readonly spectrum = new SpectrumRing(ONSET_SIZE);
  readonly prev = new Float64Array(ONSET_SIZE / 2 + 1);
  readonly hop: number;
  sinceHop = 0;
  flux: number[] = [];
  readonly bandStart: [number, number];
  // < 150 Hz, 150 Hz-4 kHz, > 4 kHz, Σ magnitude × bin, Σ magnitude
  readonly bandSums = new Float64Array(5);
  hasBands = false;

  constructor(rate: number) {
    this.hop = Math.round(rate / 100);
    this.bandStart = [Math.ceil((150 * ONSET_SIZE) / sampleRate), Math.ceil((4000 * ONSET_SIZE) / sampleRate)];
  }

  push(x: number): void {
    this.spectrum.push(x);
    if (++this.sinceHop < this.hop) return;
    this.sinceHop = 0;
    if (this.spectrum.full) this.onset();
  }

  onset(): void {
    const mag = this.spectrum.spectrum();
    let flux = 0;

    for (let k = 0; k <= ONSET_SIZE / 2; k++) {
      const d = mag[k] - this.prev[k];
      if (d > 0) flux += d;
      this.prev[k] = mag[k];
    }

    this.flux.push(flux);
    this.addBands(mag);
  }

  addBands(mag: Float64Array): void {
    const [mid, high] = this.bandStart,
      B = this.bandSums;
    this.hasBands = true;

    for (let k = 1; k <= ONSET_SIZE / 2; k++) {
      const m = mag[k],
        e = m * m;
      if (k < mid) B[0] += e;
      else if (k < high) B[1] += e;
      else B[2] += e;
      B[3] += m * k;
      B[4] += m;
    }
  }

  // [< 150 Hz, 150 Hz-4 kHz, > 4 kHz, centroid Hz] since the last call
  bands(): number[] | null {
    if (!this.hasBands) return null;
    const B = this.bandSums;
    const centroid = B[4] > 0 ? ((B[3] / B[4]) * sampleRate) / ONSET_SIZE : 0;
    const out = [B[0], B[1], B[2], centroid];
    B.fill(0);

    return out;
  }

  take(): number[] {
    const f = this.flux;
    this.flux = [];

    return f;
  }
}

class ChromaTap {
  readonly spectrum = new SpectrumRing(CHROMA_SIZE);
  readonly decimation: number;
  sinceKept = 0;
  readonly antiAlias: Biquad[];
  readonly antiAliasState: Float64Array[];
  readonly bins: [bin: number, pitchClass: number, weight: number][] = [];

  constructor(rate: number) {
    this.decimation = Math.max(1, Math.round(rate / CHROMA_RATE));
    const rateOut = rate / this.decimation;
    // 4th-order Butterworth: Q of each biquad
    this.antiAlias = [lowpass(rate, rateOut * 0.2, 0.5412), lowpass(rate, rateOut * 0.2, 1.3066)];
    this.antiAliasState = this.antiAlias.map(() => new Float64Array(4));

    for (let k = 1; k <= CHROMA_SIZE / 2; k++) {
      const f = (k * rateOut) / CHROMA_SIZE;
      if (f < CHROMA_LOW_HZ || f > CHROMA_HIGH_HZ) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      const nearest = Math.round(midi),
        d = Math.abs(midi - nearest);
      if (d > CHROMA_SPREAD) continue;
      const c = Math.cos((d / CHROMA_SPREAD) * (Math.PI / 2));
      this.bins.push([k, ((nearest % 12) + 12) % 12, c * c]);
    }
  }

  push(x: number): void {
    const v = runBiquads(this.antiAlias, this.antiAliasState, x);
    if (++this.sinceKept < this.decimation) return;
    this.sinceKept = 0;
    this.spectrum.push(v);
  }

  chroma(): number[] | null {
    if (!this.spectrum.full) return null;
    const mag = this.spectrum.spectrum();
    const c = new Array<number>(12).fill(0);
    for (const [k, pc, w] of this.bins) c[pc] += w * mag[k] * mag[k];

    return c;
  }
}

export class FeatureTap {
  readonly onsets: OnsetTap;
  readonly pitches: ChromaTap;

  constructor(rate: number) {
    this.onsets = new OnsetTap(rate);
    this.pitches = new ChromaTap(rate);
  }

  push(input: Channels): void {
    const channels = input ? Math.min(input.length, 2) : 0;
    if (!input || !channels) return;

    for (let i = 0; i < input[0].length; i++) {
      const x = channels === 2 ? 0.5 * (input[0][i] + input[1][i]) : input[0][i];
      this.onsets.push(x);
      this.pitches.push(x);
    }
  }

  bands(): number[] | null {
    return this.onsets.bands();
  }

  chroma(): number[] | null {
    return this.pitches.chroma();
  }

  take(): number[] {
    return this.onsets.take();
  }
}
