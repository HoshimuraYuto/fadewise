import { runBiquads, type Biquad, type Channels } from './biquad.mts';

// BS.1770's pre-filter (a high shelf) and RLB high pass, from their analog prototypes as libebur128 derives them.
export function kWeightingCoefficients(rate: number): Biquad[] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };

  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  const d = 1 + K / Q + K * K;
  const highpass: Biquad = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / d, (1 - K / Q + K * K) / d] };

  return [shelf, highpass];
}

export class InputMeter {
  readonly stages: Biquad[];
  readonly state: Float64Array[][];
  sum = 0;
  peak = 0;
  seen = false;

  constructor(stages: Biquad[]) {
    this.stages = stages;
    this.state = [0, 1].map(() => stages.map(() => new Float64Array(4)));
  }

  reset(): void {
    this.sum = 0;
    this.peak = 0;
    this.seen = false;
  }

  add(input: Channels): number {
    const channels = input ? Math.min(input.length, 2) : 0;
    if (channels) this.seen = true;

    for (let ch = 0; ch < channels && input; ch++) {
      let acc = 0;
      let pk = this.peak;

      for (const x of input[ch]) {
        const ax = x < 0 ? -x : x;
        if (ax > pk) pk = ax;
        const y = runBiquads(this.stages, this.state[ch], x);
        acc += y * y;
      }

      this.sum += acc;
      this.peak = pk;
    }

    return channels;
  }
}
