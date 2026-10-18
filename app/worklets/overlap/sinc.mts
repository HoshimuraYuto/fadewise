// linear / cubic interpolation lose 12 kHz and up
export const TAPS = 16;
export const PHASES = 512;
const KAISER_BETA = 8.6;

function besselI0(x: number): number {
  let sum = 1,
    term = 1;

  for (let k = 1; k < 30; k++) {
    term *= x / 2 / k;
    sum += term * term;
  }

  return sum;
}

// (PHASES + 1) rows of TAPS * 2 coefficients; `cut` is the cutoff as a fraction of Nyquist.
export function buildSinc(cut: number): Float32Array {
  const table = new Float32Array((PHASES + 1) * TAPS * 2);
  const windowPeak = besselI0(KAISER_BETA);

  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    const row = p * TAPS * 2;
    let sum = 0;

    for (let k = -TAPS + 1; k <= TAPS; k++) {
      const x = k - frac,
        r = x / TAPS;
      const sinc = x === 0 ? cut : Math.sin(Math.PI * cut * x) / (Math.PI * x);
      const v = sinc * (Math.abs(r) >= 1 ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / windowPeak);
      table[row + k + TAPS - 1] = v;
      sum += v;
    }

    for (let k = 0; k < TAPS * 2; k++) table[row + k] /= sum;
  }

  return table;
}
