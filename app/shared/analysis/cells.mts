import type { Cell } from '../types.mts';
import { isNum } from './util.mts';

export const LOGIC_VERSION = 1;

export const CELL_SEC = 1;
export const MIN_FRAMES_PER_CELL = 3;
export const COVERED_FRAMES_PER_CELL = 5;
export const CELL_COUNT_CAP = 50;
export const PROFILE_CELLS = 15;

// below the -70 LUFS absolute gate, so a silent cell never meets a relative condition
export const FRAME_FLOOR_LUFS = -99;

const floorLevel = (x: unknown) => (isNum(x) ? Math.max(FRAME_FLOOR_LUFS, x) : x);

export function floorCell(c: unknown): unknown {
  return Array.isArray(c) ? [c[0], c[1], floorLevel(c[2]), floorLevel(c[3])].concat(c.slice(4)) : c;
}

export function floorCells<T>(cells: T): T {
  return (Array.isArray(cells) ? cells.map(floorCell) : cells) as T;
}

export function cellsToMap(cells: readonly unknown[] | null | undefined): Map<number, Cell> {
  const m = new Map<number, Cell>();

  for (const x of cells || []) {
    if (!Array.isArray(x)) continue;
    const c = x as Cell;
    if (isNum(c[0]) && isNum(c[1]) && c[1] > 0) m.set(c[0], c);
  }

  return m;
}
