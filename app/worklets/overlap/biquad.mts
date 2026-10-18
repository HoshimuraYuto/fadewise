// RBJ Audio EQ Cookbook, transposed direct form II
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  readonly s1 = new Float64Array(2);
  readonly s2 = new Float64Array(2);

  set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): void {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  bypass(): void {
    this.set(1, 0, 0, 1, 0, 0);
  }

  lowShelf(hz: number, db: number): void {
    const A = Math.pow(10, db / 40),
      w = (2 * Math.PI * hz) / sampleRate,
      cs = Math.cos(w),
      al = (Math.sin(w) / 2) * Math.SQRT2,
      k = 2 * Math.sqrt(A) * al;
    this.set(
      A * (A + 1 - (A - 1) * cs + k),
      2 * A * (A - 1 - (A + 1) * cs),
      A * (A + 1 - (A - 1) * cs - k),
      A + 1 + (A - 1) * cs + k,
      -2 * (A - 1 + (A + 1) * cs),
      A + 1 + (A - 1) * cs - k,
    );
  }

  highShelf(hz: number, db: number): void {
    const A = Math.pow(10, db / 40),
      w = (2 * Math.PI * hz) / sampleRate,
      cs = Math.cos(w),
      k = 2 * Math.sqrt(A) * (Math.sin(w) / 2) * Math.SQRT2;
    this.set(
      A * (A + 1 + (A - 1) * cs + k),
      -2 * A * (A - 1 + (A + 1) * cs),
      A * (A + 1 + (A - 1) * cs - k),
      A + 1 - (A - 1) * cs + k,
      2 * (A - 1 - (A + 1) * cs),
      A + 1 - (A - 1) * cs - k,
    );
  }

  // Butterworth (Q = 1/√2)
  pass(hz: number, high: boolean): void {
    const w = (2 * Math.PI * hz) / sampleRate,
      cs = Math.cos(w),
      al = Math.sin(w) / Math.SQRT2;
    const b = high ? (1 + cs) / 2 : (1 - cs) / 2;
    this.set(b, high ? -(1 + cs) : 1 - cs, b, 1 + al, -2 * cs, 1 - al);
  }

  run(x: number, ch: number): number {
    const y = this.b0 * x + this.s1[ch];
    this.s1[ch] = this.b1 * x - this.a1 * y + this.s2[ch];
    this.s2[ch] = this.b2 * x - this.a2 * y;

    return y;
  }

  reset(): void {
    this.s1.fill(0);
    this.s2.fill(0);
  }
}
