import { isNum } from './util.mts';

export const ABS_GATE_LUFS = -70;
const REL_GATE_LU = -10;

export const SILENCE_REL_LU = -42; // autocue's cue-in / cue-out level

export const energyToLufs = (e: number): number => (e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity);
export const lufsToEnergy = (l: unknown): number => (isNum(l) ? Math.pow(10, (l + 0.691) / 10) : 0);
export const ampToDb = (a: number) => (a > 0 ? 20 * Math.log10(a) : -Infinity);

// BS.1770 gating; blocks are channel-summed K-weighted mean squares
export function gatedLoudness(blockEnergies: readonly number[]): number | null {
  const abs = blockEnergies.filter((e) => e > 0 && energyToLufs(e) > ABS_GATE_LUFS);
  if (!abs.length) return null;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const relGate = energyToLufs(meanAbs) + REL_GATE_LU;
  const rel = abs.filter((e) => energyToLufs(e) > relGate);
  if (!rel.length) return null;

  return energyToLufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

// BS.1770: 400 ms blocks, 75 % overlap
export function blocksFromSubBlocks(subEnergies: readonly number[]): number[] {
  const out: number[] = [];

  for (let i = 0; i + 4 <= subEnergies.length; i++) {
    out.push((subEnergies[i] + subEnergies[i + 1] + subEnergies[i + 2] + subEnergies[i + 3]) / 4);
  }

  return out;
}

export function integratedFromSubBlocks(subEnergies: readonly number[]): number | null {
  return gatedLoudness(blocksFromSubBlocks(subEnergies));
}

export const energyMeanLufs = (arr: readonly number[]) => {
  const e = arr.map(lufsToEnergy);

  return e.length ? energyToLufs(e.reduce((a, b) => a + b, 0) / e.length) : null;
};
