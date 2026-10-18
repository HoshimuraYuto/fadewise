import type { Bar } from '../mix-features.mts';
import { isNum, median } from './gentle.mts';
import type { Candidate } from './gentle.mts';

export interface BarVector {
  c: number[];
  t: number[];
}

const cos = (a: readonly number[], b: readonly number[]) => {
  let s = 0,
    x = 0,
    y = 0;

  for (let k = 0; k < a.length; k++) {
    s += a[k] * b[k];
    x += a[k] * a[k];
    y += b[k] * b[k];
  }

  return x && y ? s / Math.sqrt(x * y) : 0;
};

const shift = (c: readonly number[], s: number) => c.map((_, k) => c[(k + s) % 12]);

export function barVectors(bars: Bar[], ref: number): BarVector[] {
  return bars.map((b) => {
    const c = b.cr ? b.cr.slice() : new Array<number>(12).fill(0);
    const t = [
      isNum(b.lu) ? Math.max(-3, (b.lu - ref) / 8) : -3,
      isNum(b.low) ? b.low * 4 : 0,
      isNum(b.high) ? b.high * 8 : 0,
    ];

    return { c, t };
  });
}

export function novelty(vec: BarVector[], half = 4): { S: number[][]; nov: number[] } {
  const n = vec.length;
  const S = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const dt = Math.hypot(...vec[i].t.map((x, k) => x - vec[j].t[k]));

      return 0.5 * cos(vec[i].c, vec[j].c) + 0.5 * Math.exp(-dt);
    }),
  );
  const nov = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    let s = 0,
      m = 0;

    for (let a = -half; a < half; a++)
      for (let b = -half; b < half; b++) {
        const x = i + a,
          y = i + b;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const w = a < 0 === b < 0 ? 1 : -1;
        s += w * S[x][y];
        m++;
      }

    nov[i] = m ? Math.max(0, s / m) : 0;
  }

  return { S, nov };
}

export function repeats(vec: BarVector[], L = 4, thr = 0.92): { rep: number[]; best: number[] } {
  const n = vec.length,
    rep = new Array<number>(n).fill(0),
    best = new Array<number>(n).fill(0);

  for (let i = 0; i + L <= n; i++) {
    for (let j = 0; j + L <= n; j++) {
      if (Math.abs(i - j) < L) continue;
      let top = 0;

      for (const s of [0, 1, 2, 10, 11]) {
        let m = 0;
        for (let k = 0; k < L; k++) m += cos(vec[i + k].c, shift(vec[j + k].c, s));
        top = Math.max(top, m / L);
      }

      if (top >= thr) rep[i]++;
      best[i] = Math.max(best[i], top);
    }
  }

  return { rep, best };
}

export const AGGR = {
  half: 4,
  L: 4,
  thr: 0.92,
  chorusLu: 2.0,
  maxEntryFrac: 0.4,
  minTailBars: 4,
  novMin: 0.3,
  stepLu: 3,
  cluster: true,
  splitNov: 0.5,
};
export type AggrOptions = typeof AGGR;
export interface Run {
  a: number;
  b: number;
  t: number;
  t1: number;
  lu: number;
  size?: number;
}
const maxNovRaw = (nov: readonly number[]) => Math.max(...nov) || 1;

interface Piece {
  a: number;
  b: number;
}

function blockLoudness(bars: Bar[], L: number): number[] {
  const n = bars.length;

  return bars.map((_, i) => {
    let power = 0;
    let count = 0;

    for (let k = 0; k < L && i + k < n; k++) {
      if (!isNum(bars[i + k].lu)) continue;
      power += Math.pow(10, bars[i + k].lu / 10);
      count++;
    }

    return count ? 10 * Math.log10(power / count) : -99;
  });
}

function loudRepeatedRuns(bars: Bar[], ref: number, rep: number[], blockLu: number[], o: AggrOptions): Run[] {
  const n = bars.length;
  const repeatedLu = blockLu.filter((_, i) => rep[i] >= 1);
  const top = Math.max(...repeatedLu);
  // blocks straddling a section line would pull the run 1-3 bars into the verse
  const loudestBars = bars
    .map((b) => b.lu)
    .filter(isNum)
    .sort((a, b) => b - a)
    .slice(0, Math.max(1, Math.floor(n / 5)));
  const barTop = median(loudestBars);
  const inChorus = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    if (rep[i] < 1 || blockLu[i] < top - o.chorusLu) continue;

    for (let k = 0; k < o.L && i + k < n; k++) if (bars[i + k].lu >= barTop - o.chorusLu) inChorus[i + k] = true;
  }

  const runs: Run[] = [];

  for (let i = 0; i < n; i++) {
    if (!inChorus[i]) continue;
    let j = i;
    while (j + 1 < n && inChorus[j + 1]) j++;
    if (j - i + 1 >= o.L)
      runs.push({ a: i, b: j + 1, t: bars[i].t, t1: bars[j].t1, lu: +(blockLu[i] - ref).toFixed(1) });
    i = j;
  }

  return runs;
}

function splitAtNovelty(runs: Run[], nov: number[], o: AggrOptions): Piece[] {
  const pieces: Piece[] = [];
  const minPeak = o.splitNov * maxNovRaw(nov);

  for (const r of runs) {
    let a = r.a;

    for (let i = r.a + o.L; i < r.b - o.L + 1; i += 1) {
      const peak = nov[i] >= minPeak && nov[i] >= nov[i - 1] && nov[i] >= ((nov[i + 1] as number | undefined) || 0);

      if (peak && i - a >= o.L) {
        pieces.push({ a, b: i });
        a = i;
      }
    }

    pieces.push({ a, b: r.b });
  }

  return pieces;
}

function clusterPieces(pieces: Piece[], vec: BarVector[], o: AggrOptions): { labels: number[]; count: number } {
  const similarity = (p: Piece, q: Piece) => {
    let m = 0;

    for (let k = 0; k < o.L; k++) {
      m += Math.max(...[0, 1, 2, 10, 11].map((s) => cos(vec[p.a + k].c, shift(vec[q.a + k].c, s))));
    }

    return m / o.L;
  };

  const labels = pieces.map(() => -1);
  let count = 0;

  for (let i = 0; i < pieces.length; i++) {
    if (labels[i] >= 0) continue;
    labels[i] = count;

    for (let j = i + 1; j < pieces.length; j++) {
      const longEnough = pieces[j].b - pieces[j].a >= o.L;
      if (labels[j] < 0 && longEnough && similarity(pieces[i], pieces[j]) >= o.thr) labels[j] = count;
    }

    count++;
  }

  return { labels, count };
}

// a verse repeats 2x, a chorus 3-4x, so the largest cluster is the chorus
function chorusFromClusters(
  bars: Bar[],
  ref: number,
  runs: Run[],
  nov: number[],
  vec: BarVector[],
  blockLu: number[],
  o: AggrOptions,
): Run[] {
  const pieces = splitAtNovelty(runs, nov, o);
  const { labels, count } = clusterPieces(pieces, vec, o);
  const size = new Array<number>(count).fill(0);
  const loudest = new Array<number>(count).fill(-99);

  pieces.forEach((p, i) => {
    size[labels[i]]++;
    loudest[labels[i]] = Math.max(loudest[labels[i]], blockLu[p.a]);
  });

  let chorus = 0;

  for (let c = 1; c < count; c++) {
    if (size[c] > size[chorus] || (size[c] === size[chorus] && loudest[c] > loudest[chorus])) chorus = c;
  }

  if (!(size[chorus] >= 2)) return runs;

  const merged: Piece[] = [];

  for (const p of pieces.filter((_, i) => labels[i] === chorus)) {
    const last = merged[merged.length - 1] as Piece | undefined;
    if (last && last.b === p.a) last.b = p.b;
    else merged.push({ a: p.a, b: p.b });
  }

  return merged.map((p) => ({
    a: p.a,
    b: p.b,
    t: bars[p.a].t,
    t1: bars[p.b - 1].t1,
    lu: +(blockLu[p.a] - ref).toFixed(1),
    size: size[chorus],
  }));
}

export function chorusRuns(
  bars: Bar[],
  ref: number,
  o: AggrOptions = AGGR,
): { runs: Run[]; nov: number[]; rep: number[]; conf: number } {
  const vec = barVectors(bars, ref);
  const { rep, best } = repeats(vec, o.L, o.thr);
  const { nov } = novelty(vec, o.half);
  const n = bars.length;
  const blockLu = blockLoudness(bars, o.L);
  if (!rep.some((r) => r >= 1)) return { runs: [], nov, rep, conf: 0 };

  let runs = loudRepeatedRuns(bars, ref, rep, blockLu, o);
  if (o.cluster) runs = chorusFromClusters(bars, ref, runs, nov, vec, blockLu, o);

  const maxNov = Math.max(...nov) || 1;
  const repeatedShare = Math.min(1, best.filter((x) => x >= o.thr).length / Math.max(1, n / 3));
  const conf = runs.length >= 2 ? Math.min(1, runs.length / 3) * repeatedShare : 0;

  return { runs, nov: nov.map((x) => x / maxNov), rep, conf: +conf.toFixed(2) };
}

export interface AggressiveResult {
  entry: Candidate | null;
  exit: Candidate | null;
  runs?: [number, number][];
}

export function aggressive(
  bars: Bar[],
  ref: number | null,
  first: number | null,
  last: number | null,
  o: AggrOptions = AGGR,
): AggressiveResult {
  const res: AggressiveResult = { entry: null, exit: null };
  if (bars.length < 24 || !isNum(ref)) return res;
  const { runs, nov, conf } = chorusRuns(bars, ref, o);
  const dur = bars[bars.length - 1].t1;

  if (runs.length) {
    const r0 = runs[0];
    const n2 = bars.length;

    // a "lift" with no rise is a loud verse
    const pm = (a: number, b: number) => {
      let s = 0,
        c = 0;

      for (let i = Math.max(0, a); i < Math.min(n2, b); i++)
        if (isNum(bars[i].lu)) {
          s += Math.pow(10, bars[i].lu / 10);
          c++;
        }

      return c ? 10 * Math.log10(s / c) : NaN;
    };

    const stepIn = pm(r0.a, r0.a + 4) - pm(r0.a - 4, r0.a);

    if (r0.t > (first ?? 0) + 4 && r0.t < o.maxEntryFrac * dur) {
      const sf = isNum(stepIn) ? Math.min(1, Math.max(0, stepIn / o.stepLu)) : 0;
      res.entry = {
        t: r0.t,
        k: 'lift',
        conf: +(conf * Math.min(1, 0.5 + nov[r0.a]) * sf).toFixed(2),
        rep: runs.length,
        lu: r0.lu,
        nov: +nov[r0.a].toFixed(2),
        step: +stepIn.toFixed(1),
      };
    }

    const rl = runs[runs.length - 1];
    const tailBars = bars.filter((b) => b.t >= rl.t1 && b.t < (last ?? 0)).length;
    const stepOut = pm(rl.b - 4, rl.b) - pm(rl.b, rl.b + 4);

    if (runs.length >= 2 && tailBars >= o.minTailBars && rl.t1 > 0.6 * dur) {
      const sf = isNum(stepOut) ? Math.min(1, Math.max(0, stepOut / o.stepLu)) : 0.5;
      res.exit = {
        t: rl.t1,
        k: 'chorusEnd',
        conf: +(conf * Math.min(1, 0.5 + ((nov[rl.b] as number | undefined) || 0)) * sf).toFixed(2),
        rep: runs.length,
        lu: rl.lu,
        tail: +((last ?? 0) - rl.t1).toFixed(1),
        step: isNum(stepOut) ? +stepOut.toFixed(1) : null,
      };
    }
  }

  res.runs = runs.map((r) => [+r.t.toFixed(2), +r.t1.toFixed(2)]);

  return res;
}
