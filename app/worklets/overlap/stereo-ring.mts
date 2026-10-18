import { PHASES, TAPS } from './sinc.mts';

export class StereoRing {
  readonly ch: [Float32Array, Float32Array];
  readonly mask: number;

  constructor(size: number) {
    this.ch = [new Float32Array(size), new Float32Array(size)];
    this.mask = size - 1;
  }

  write(i: number, x0: number, x1: number): void {
    this.ch[0][i & this.mask] = x0;
    this.ch[1][i & this.mask] = x1;
  }

  at(c: number, i: number): number {
    return this.ch[c][i & this.mask];
  }

  clear(): void {
    this.ch[0].fill(0);
    this.ch[1].fill(0);
  }

  fadeBefore(end: number, len: number): void {
    for (let k = 0; k < len; k++) {
      const g = 0.5 + 0.5 * Math.cos((Math.PI * (k + 1)) / (len + 1)),
        j = (end - len + k) & this.mask;
      this.ch[0][j] *= g;
      this.ch[1][j] *= g;
    }
  }

  interpolated(c: number, pos: number, sinc: Float32Array): number {
    const r = this.ch[c],
      m = this.mask,
      i = Math.floor(pos),
      f = pos - i;
    if (f === 0) return r[i & m];
    const pf = f * PHASES,
      p = Math.floor(pf),
      pa = pf - p,
      o0 = p * TAPS * 2,
      o1 = o0 + TAPS * 2;
    let acc = 0;
    for (let k = 0; k < TAPS * 2; k++)
      acc += (sinc[o0 + k] + (sinc[o1 + k] - sinc[o0 + k]) * pa) * r[(i - TAPS + 1 + k) & m];

    return acc;
  }
}
