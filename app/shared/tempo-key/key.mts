import type { KeyModeName, KeySummary, TempoKey } from '../types.mts';
import { KEY_FULL_FRAMES, KEY_FULL_MARGIN, KEY_LOGIC_VERSION, KEY_RELATED_MARGIN } from './constants.mts';
import { isNum, round } from './numbers.mts';

// Temperley (2007, "Music and Probability"), Kostka–Payne corpus pitch-class probabilities; index 0 = tonic.
export const TEMPERLEY: Record<KeyModeName, number[]> = {
  major: [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4],
  minor: [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33],
};
export const PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface RankedKey {
  tonic: number;
  mode: KeyModeName;
  r: number;
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let ma = 0,
    mb = 0;

  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }

  ma /= n;
  mb /= n;
  let num = 0,
    da = 0,
    db = 0;

  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }

  return num / Math.sqrt(da * db || 1);
}

// sqrt and per-frame normalisation keep loud frames from dominating
export function addChromaFrame(sum: number[], frame: unknown): boolean {
  if (!Array.isArray(frame) || frame.length !== 12) return false;
  const f = frame as unknown[];
  let m = 0;
  for (const v of f) if (isNum(v) && v > m) m = v;
  if (!(m > 0)) return false;

  for (let i = 0; i < 12; i++) {
    const v = f[i];
    sum[i] += isNum(v) && v > 0 ? Math.sqrt(v / m) : 0;
  }

  return true;
}

export function rankKeys(chroma: unknown): RankedKey[] | null {
  if (!Array.isArray(chroma) || chroma.length !== 12) return null;
  const c = chroma as unknown[];
  if (!c.every(isNum) || !c.some((v) => v > 0)) return null;
  const all: RankedKey[] = [];

  for (const mode of ['major', 'minor'] as const) {
    for (let t = 0; t < 12; t++) {
      const rot: number[] = [];
      for (let i = 0; i < 12; i++) rot.push(c[(i + t) % 12]);
      all.push({ tonic: t, mode, r: pearson(rot, TEMPERLEY[mode]) });
    }
  }

  return all.sort((p, q) => q.r - p.r);
}

export function keyFromChroma(
  chroma: unknown,
): (RankedKey & { margin: number; runnerUp: { tonic: number; mode: KeyModeName } }) | null {
  const all = rankKeys(chroma);
  if (!all) return null;

  return {
    tonic: all[0].tonic,
    mode: all[0].mode,
    r: all[0].r,
    margin: all[0].r - all[1].r,
    runnerUp: { tonic: all[1].tonic, mode: all[1].mode },
  };
}

export function relatedKey(
  a: { tonic: number; mode: KeyModeName } | null | undefined,
  b: { tonic: number; mode: KeyModeName } | null | undefined,
): boolean {
  if (!a || !b || (a.tonic === b.tonic && a.mode === b.mode)) return false;

  if (a.mode === b.mode) {
    const d = (b.tonic - a.tonic + 12) % 12;

    return d === 7 || d === 5;
  }

  if (a.tonic === b.tonic) return true;

  return a.mode === 'major' ? b.tonic === (a.tonic + 9) % 12 : b.tonic === (a.tonic + 3) % 12;
}

// Camelot wheel: C major = 8B, A minor = 8A
export function camelot(tonic: unknown, mode: unknown): string | null {
  if (!isNum(tonic) || (mode !== 'major' && mode !== 'minor')) return null;
  const t = mode === 'minor' ? (tonic + 3) % 12 : tonic % 12;

  return `${String(((((7 * t) % 12) + 7) % 12) + 1)}${mode === 'minor' ? 'A' : 'B'}`;
}

export function keyName(tonic: unknown, mode: unknown): string | null {
  if (!isNum(tonic)) return null;

  return PITCH_NAMES[tonic] + (mode === 'minor' ? 'm' : '');
}

export function summarizeKey(chromaSum: unknown, frames: unknown, fullFrames = KEY_FULL_FRAMES): KeySummary | null {
  const all = rankKeys(chromaSum);
  if (!all || !isNum(frames) || frames <= 0) return null;
  const top = all[0],
    second = all[1];
  const amount = Math.min(1, frames / fullFrames);
  const margin = top.r - second.r;
  const secondRelated = relatedKey(top, second);
  const confidence = Math.min(1, margin / (secondRelated ? KEY_RELATED_MARGIN : KEY_FULL_MARGIN)) * amount;
  const unrelated = all.find((k) => k !== top && !relatedKey(top, k)) as RankedKey;
  const familyConfidence = Math.min(1, (top.r - unrelated.r) / KEY_RELATED_MARGIN) * amount;
  const related = all
    .filter((k) => relatedKey(top, k) && top.r - k.r <= KEY_RELATED_MARGIN)
    .slice(0, 2)
    .map((k) => ({
      tonic: k.tonic,
      mode: k.mode,
      name: keyName(k.tonic, k.mode),
      camelot: camelot(k.tonic, k.mode),
      gap: round(top.r - k.r, 3),
    }));

  return {
    v: KEY_LOGIC_VERSION,
    tonic: top.tonic,
    mode: top.mode,
    name: keyName(top.tonic, top.mode),
    camelot: camelot(top.tonic, top.mode),
    r: round(top.r, 3),
    margin: round(margin, 3),
    confidence: round(confidence, 2),
    familyConfidence: round(familyConfidence, 2),
    runnerUp: keyName(second.tonic, second.mode),
    runnerUpRelated: secondRelated,
    related,
  };
}

export function currentKey(tk: unknown): KeySummary | null {
  if (!tk || typeof tk !== 'object') return null;
  const t = tk as Partial<TempoKey>;
  if (t.key && t.key.v === KEY_LOGIC_VERSION) return t.key;

  if (Array.isArray(t.chromaSum) && isNum(t.chromaFrames) && t.chromaFrames > 0) {
    return summarizeKey(t.chromaSum, t.chromaFrames);
  }

  return null;
}
