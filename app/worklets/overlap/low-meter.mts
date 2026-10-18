import { Biquad } from './biquad.mts';

export class LowMeter {
  // old heard, next heard, old unfiltered, next unfiltered
  readonly lowPass = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  readonly energy = [0, 0, 0, 0];
  n = 0;
  wins = 0;
  both = 0;
  bothRaw = 0;

  start(): void {
    for (const f of this.lowPass) f.reset();
    for (const f of this.lowPass) f.pass(150, false);
    this.energy.fill(0);
    this.n = this.wins = this.both = this.bothRaw = 0;
  }

  add(a: number, b: number, rawA: number, rawB: number, windowLen: number): void {
    const x = [a, b, rawA, rawB];

    for (let k = 0; k < 4; k++) {
      const y = this.lowPass[k].run(x[k], 0);
      this.energy[k] += y * y;
    }

    if (++this.n < windowLen) return;
    const on = (k: number) => this.energy[k] / this.n > 1e-4;
    this.wins++;
    if (on(0) && on(1)) this.both++;
    if (on(2) && on(3)) this.bothRaw++;
    this.energy.fill(0);
    this.n = 0;
  }
}
