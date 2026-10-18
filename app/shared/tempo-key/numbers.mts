export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function round(x: number, d: number): number;
export function round(x: unknown, d: number): number | null;

export function round(x: unknown, d: number): number | null {
  return isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null;
}

export type Loose = Record<string, unknown>;
