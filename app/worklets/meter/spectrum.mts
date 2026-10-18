export type Fft = (frame: Float64Array, out: Float64Array) => Float64Array;

function bitReversal(n: number): Uint32Array {
  const levels = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }

  return rev;
}

export function makeFft(n: number): Fft {
  const rev = bitReversal(n);
  const cos = new Float64Array(n / 2),
    sin = new Float64Array(n / 2);

  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }

  const re = new Float64Array(n),
    im = new Float64Array(n);

  return function magnitude(frame, out) {
    for (let i = 0; i < n; i++) {
      re[rev[i]] = frame[i];
      im[rev[i]] = 0;
    }

    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1,
        step = n / size;

      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j,
            b = a + half;
          const tr = re[b] * cos[k] + im[b] * sin[k];
          const ti = -re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }

    for (let i = 0; i <= n / 2; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);

    return out;
  };
}

export const hann = (n: number): Float64Array => {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

  return w;
};

export class SpectrumRing {
  readonly n: number;
  readonly ring: Float32Array;
  readonly window: Float64Array;
  readonly frame: Float64Array;
  readonly mag: Float64Array;
  readonly fft: Fft;
  w = 0;
  filled = 0;

  constructor(n: number) {
    this.n = n;
    this.ring = new Float32Array(n);
    this.window = hann(n);
    this.frame = new Float64Array(n);
    this.mag = new Float64Array(n / 2 + 1);
    this.fft = makeFft(n);
  }

  get full(): boolean {
    return this.filled === this.n;
  }

  push(x: number): void {
    this.ring[this.w] = x;
    this.w = (this.w + 1) % this.n;
    if (this.filled < this.n) this.filled++;
  }

  spectrum(): Float64Array {
    const N = this.n;
    for (let i = 0; i < N; i++) this.frame[i] = this.ring[(this.w + i) % N] * this.window[i];

    return this.fft(this.frame, this.mag);
  }
}
