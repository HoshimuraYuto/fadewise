const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const FPS = 10;
// A chroma frame is a 0.68 s window ending at the frame, so its centre is ~0.3 s earlier
export const CR_LAG = 0.3;
const crIdx = (t: number) => Math.round((t + CR_LAG) * FPS - 0.5);
const lufs = (e: number) => (e > 0 ? -0.691 + 10 * Math.log10(e) : -120);

export interface FluxRun {
  start: number;
  flux: number[];
  end: number;
}
export interface Series {
  n: number;
  lu: Float64Array;
  low: Float64Array;
  high: Float64Array;
  cent?: Float64Array;
  on: Float64Array;
  cr: (number[] | null)[];
  fluxRuns: FluxRun[];
  obs?: number[];
}
// bd: [low < 150 Hz, mid, high > 4 kHz energies, centroid Hz]
export interface MeterFrame {
  ct: number;
  e: number;
  bd?: number[] | null;
  cr?: number[] | null;
  fx?: number[] | null;
}
export interface BarGrid {
  bpm: number;
  period: number;
  beat0: number | undefined;
  beats: number[];
  down: number;
  bar0: number;
  conf: number;
  scores: number[];
}
export interface Bar {
  t: number;
  t1: number;
  lu: number;
  low: number;
  high: number;
  on: number;
  cr: number[] | null;
  mel: number;
  obs: number;
}

export function framesToSeries(frames: MeterFrame[], dur?: number | null): Series {
  const n = Math.ceil((dur || frames[frames.length - 1].ct + 0.1) * FPS) + 1;
  const S = {
    n,
    lu: new Float64Array(n).fill(NaN),
    low: new Float64Array(n).fill(NaN),
    high: new Float64Array(n).fill(NaN),
    cent: new Float64Array(n).fill(NaN),
    on: new Float64Array(n).fill(NaN),
    cr: Array.from({ length: n }, (): number[] | null => null),
    fluxRuns: [] as FluxRun[],
  };
  let run: FluxRun | null = null;

  for (const f of frames) {
    if (!isNum(f.ct) || !isNum(f.e)) continue;
    const i = Math.round(f.ct * FPS - 0.5);
    if (i < 0 || i >= n) continue;
    S.lu[i] = lufs(f.e);

    if (f.bd) {
      const tot = f.bd[0] + f.bd[1] + f.bd[2];
      S.low[i] = tot > 0 ? f.bd[0] / tot : 0;
      S.high[i] = tot > 0 ? f.bd[2] / tot : 0;
      S.cent[i] = f.bd[3];
    }

    if (f.fx && f.fx.length) {
      S.on[i] = f.fx.reduce((a, b) => a + b, 0) / f.fx.length;
      const start = f.ct + 0.05 - f.fx.length / 100;

      if (run && Math.abs(start - run.end) < 0.05) {
        run.flux.push(...f.fx);
        run.end = start + f.fx.length / 100;
      } else {
        run = { start, flux: f.fx.slice(), end: start + f.fx.length / 100 };
        S.fluxRuns.push(run);
      }
    }

    if (f.cr) S.cr[i] = f.cr;
  }

  return S;
}

// BS.1770 gated loudness
export function integrated(lu: ArrayLike<number>): number | null {
  const e: number[] = [];

  for (let i = 0; i + 3 < lu.length; i++) {
    let s = 0,
      ok = true;

    for (let k = 0; k < 4; k++) {
      if (!isNum(lu[i + k])) {
        ok = false;
        break;
      }

      s += Math.pow(10, (lu[i + k] + 0.691) / 10);
    }

    if (ok) e.push(s / 4);
  }

  const g1 = e.filter((x) => lufs(x) > -70);
  if (!g1.length) return null;
  const m1 = g1.reduce((a, b) => a + b, 0) / g1.length;
  const g2 = g1.filter((x) => lufs(x) > lufs(m1) - 10);

  return lufs(g2.reduce((a, b) => a + b, 0) / g2.length);
}

export function firstLastSound(
  S: Pick<Series, 'n' | 'lu'>,
  floor = -60,
): { first: number | null; last: number | null } {
  let a: number | null = null,
    b: number | null = null;

  for (let i = 0; i < S.n; i++)
    if (S.lu[i] > floor) {
      if (a === null) a = i;
      b = i;
    }

  return { first: a === null ? null : a / FPS, last: b === null ? null : (b + 1) / FPS };
}

// BeatRoot's averaged phase sits on the off-beat or 0.1 s late on some songs
export function refinePhase(
  S: Pick<Series, 'fluxRuns'>,
  bpm: number,
  phaseSec: number,
): { phase: number; bpm: number; moved: number; peak?: number } {
  const pts: number[] = [];

  for (const r of S.fluxRuns) {
    const m = Math.max(...r.flux) || 1;
    for (let i = 0; i < r.flux.length; i++) if (r.flux[i] > 0) pts.push(r.start + i / 100, r.flux[i] / m);
  }

  let best: { s: number; P: number; ph: number; mean: number } | null = null;

  for (let q = -20; q <= 20; q++) {
    const P = (60 / bpm) * (1 + q * 0.0002),
      steps = Math.round(P * 200);
    const score = new Float64Array(steps);

    for (let i = 0; i < pts.length; i += 2) {
      const t = pts[i];
      score[Math.floor((((t % P) + P) % P) * 200) % steps] += pts[i + 1];
    }

    for (let k = 0; k < steps; k++) {
      let s = 0;
      for (let d = -4; d <= 4; d++) s += score[(k + d + steps) % steps];
      if (!best || s > best.s) best = { s, P, ph: k / 200, mean: (pts.length / 2 / steps) * 9 };
    }
  }

  if (!best) return { phase: phaseSec, bpm, moved: 0 };
  const P = best.P;
  let d = best.ph - (((phaseSec % P) + P) % P);
  if (d > P / 2) d -= P;
  if (d < -P / 2) d += P;

  return { phase: best.ph, bpm: 60 / P, moved: +d.toFixed(3), peak: +(best.s / (best.mean || 1)).toFixed(2) };
}

export function barGrid(S: Series, bpm: number, phaseSec: number, dur: number): BarGrid {
  const period = 60 / bpm;
  const beats: number[] = [];
  for (let t = ((phaseSec % period) + period) % period; t < dur; t += period) beats.push(t);

  const crAt = (t0: number, t1: number) => {
    const c = new Array<number>(12).fill(0);
    let n = 0;

    for (let i = Math.max(0, crIdx(t0)); i < Math.min(S.n, crIdx(t1)); i++) {
      const row = S.cr[i];

      if (row) {
        const s = row.reduce((a, b) => a + b, 0) || 1;
        for (let k = 0; k < 12; k++) c[k] += row[k] / s;
        n++;
      }
    }

    return n ? c.map((x) => x / n) : null;
  };

  const lowE = (t0: number, t1: number) => {
    let s = 0,
      n = 0;

    for (let i = Math.max(0, Math.floor(t0 * FPS)); i < Math.min(S.n, Math.ceil(t1 * FPS)); i++)
      if (isNum(S.low[i]) && isNum(S.lu[i])) {
        s += S.low[i] * Math.pow(10, S.lu[i] / 10);
        n++;
      }

    return n ? s / n : NaN;
  };

  const score = [0, 0, 0, 0],
    cnt = [0, 0, 0, 0];

  for (let j = 1; j < beats.length; j++) {
    const t = beats[j],
      h = period;
    const lb = lowE(t - h / 2, t),
      la = lowE(t, t + h / 2);
    // wider windows smear the change onto the neighbouring beat
    const cb = crAt(t - h, t),
      ca = crAt(t, t + h);
    if (!isNum(lb) || !isNum(la) || !cb || !ca) continue;
    let d = 0;
    for (let k = 0; k < 12; k++) d += Math.abs(ca[k] - cb[k]);
    score[j % 4] += d;
    cnt[j % 4]++;
  }

  const avg = score.map((s, k) => (cnt[k] ? s / cnt[k] : 0));
  const order = [0, 1, 2, 3].sort((a, b) => avg[b] - avg[a]);
  const down = order[0];
  const conf = avg[order[0]] > 0 ? Math.min(1, ((avg[order[0]] - avg[order[1]]) / avg[order[0]]) * 3) : 0;
  const bar0 = (beats[down] as number | undefined) ?? 0;

  return {
    bpm,
    period,
    beat0: beats[0],
    beats,
    down,
    bar0,
    conf: +conf.toFixed(2),
    scores: avg.map((x) => +x.toFixed(3)),
  };
}

export function barLines(grid: Pick<BarGrid, 'period' | 'bar0'>, dur: number): number[] {
  const P = grid.period * 4,
    out: number[] = [];
  for (let t = ((grid.bar0 % P) + P) % P; t < dur; t += P) out.push(t);

  return out;
}

export function barFeatures(S: Series, grid: Pick<BarGrid, 'period' | 'bar0'>, dur: number): Bar[] {
  const lines = barLines(grid, dur);

  return lines.map((t0, b) => {
    const t1 = b + 1 < lines.length ? lines[b + 1] : t0 + grid.period * 4;
    const level = barLevel(S, t0, t1);
    const chroma = barChroma(S, t0, t1, grid.period);

    return {
      t: t0,
      t1,
      lu: level.lu,
      low: level.low,
      high: level.high,
      on: level.on,
      cr: chroma.cr,
      mel: melodicActivity(chroma.byBeat),
      obs: level.obs,
    };
  });
}

function barLevel(S: Series, t0: number, t1: number): Pick<Bar, 'lu' | 'low' | 'high' | 'on' | 'obs'> {
  let power = 0;
  let observed = 0;
  let low = 0;
  let high = 0;
  let onset = 0;
  let onsetFrames = 0;
  let frames = 0;

  for (let i = Math.floor(t0 * FPS); i < Math.min(S.n, Math.ceil(t1 * FPS)); i++) {
    frames++;
    if (!isNum(S.lu[i])) continue;
    observed++;
    const p = Math.pow(10, S.lu[i] / 10);
    power += p;

    if (isNum(S.low[i])) {
      low += S.low[i] * p;
      high += S.high[i] * p;
    }

    if (isNum(S.on[i])) {
      onset += S.on[i];
      onsetFrames++;
    }
  }

  return {
    lu: observed ? -0.691 + 10 * Math.log10(power / observed) + 0.691 : NaN,
    low: power > 0 ? low / power : NaN,
    high: power > 0 ? high / power : NaN,
    on: onsetFrames ? onset / onsetFrames : NaN,
    obs: frames ? observed / frames : 0,
  };
}

function barChroma(S: Series, t0: number, t1: number, period: number) {
  const sum = new Array<number>(12).fill(0);
  let count = 0;
  const byBeat: number[][][] = [[], [], [], []];

  for (let i = Math.max(0, crIdx(t0)); i < Math.min(S.n, crIdx(t1)); i++) {
    const row = S.cr[i];
    if (!row) continue;
    const s = row.reduce((a, c) => a + c, 0) || 1;
    for (let k = 0; k < 12; k++) sum[k] += row[k] / s;
    count++;
    const beat = Math.max(0, Math.min(3, Math.floor(((i + 0.5) / FPS - CR_LAG - t0) / period)));
    byBeat[beat].push(row.map((x) => x / s));
  }

  return { cr: count ? sum.map((x) => x / count) : null, byBeat };
}

function meanChroma(frames: number[][]): number[] | null {
  if (!frames.length) return null;
  const m = new Array<number>(12).fill(0);
  for (const v of frames) for (let k = 0; k < 12; k++) m[k] += v[k] / frames.length;

  return m;
}

function melodicActivity(byBeat: number[][][]): number {
  const beats = byBeat.map(meanChroma);
  let total = 0;
  let pairs = 0;

  for (let q = 1; q < 4; q++) {
    const cur = beats[q];
    const prev = beats[q - 1];
    if (!cur || !prev) continue;
    let d = 0;
    for (let k = 0; k < 12; k++) d += Math.abs(cur[k] - prev[k]);
    total += d;
    pairs++;
  }

  return pairs ? total / pairs : NaN;
}
