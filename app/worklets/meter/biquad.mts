export type Channels = readonly Float32Array[] | undefined;

// normalised by a0
export interface Biquad {
  b: [number, number, number];
  a: [number, number];
}

// state per stage: [x1, x2, y1, y2]
export function runBiquads(stages: readonly Biquad[], state: readonly Float64Array[], x: number): number {
  let v = x;

  for (let s = 0; s < stages.length; s++) {
    const c = stages[s];
    const z = state[s];
    const y = c.b[0] * v + c.b[1] * z[0] + c.b[2] * z[1] - c.a[0] * z[2] - c.a[1] * z[3];
    z[1] = z[0];
    z[0] = v;
    z[3] = z[2];
    z[2] = y;
    v = y;
  }

  return v;
}

// RBJ Audio EQ Cookbook
export function lowpass(rate: number, f0: number, q: number): Biquad {
  const w = (2 * Math.PI * f0) / rate,
    al = Math.sin(w) / (2 * q),
    c = Math.cos(w),
    a0 = 1 + al;

  return { b: [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0], a: [(-2 * c) / a0, (1 - al) / a0] };
}
