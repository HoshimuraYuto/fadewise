export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function round(x: number, d: number): number;
export function round(x: unknown, d: number): number | null;

export function round(x: unknown, d: number): number | null {
  return isNum(x) ? Math.round(x * Math.pow(10, d)) / Math.pow(10, d) : null;
}

export type Loose = Record<string, unknown>;
export const obj = (x: unknown): Loose | null => (x && typeof x === 'object' ? (x as Loose) : null);

export const clampN = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
