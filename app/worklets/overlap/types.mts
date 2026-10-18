// = AudioParamDescriptor, missing from the audioworklet types
export interface ParamDescriptor {
  name: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  automationRate: 'a-rate' | 'k-rate';
}

export type Mode = 'pass' | 'capture' | 'drain' | 'flushing';

export interface Style {
  curve: 'equal' | 'segue' | 'overlap';
  swapAt: number;
  bass: boolean;
  hpNew: boolean;
  hpOld: boolean;
}

export interface Command {
  cmd?: string;
  rate?: number;
  xfMax?: number;
  shape?: string;
  style?: Partial<Style> | null;
  swapLeftSec?: number | null;
  swapInSec?: number | null;
  tailKeep?: number | null;
  on?: boolean;
  delay?: number;
  fade?: number;
  why?: string;
}

export function parseStyle(s: Partial<Style> | null | undefined): Style | null {
  if (!s || (s.curve !== 'equal' && s.curve !== 'segue' && s.curve !== 'overlap')) return null;

  return {
    curve: s.curve,
    swapAt: typeof s.swapAt === 'number' && s.swapAt > 0 && s.swapAt < 1 ? s.swapAt : 0.5,
    bass: !!s.bass,
    hpNew: !!s.hpNew,
    hpOld: !!s.hpOld,
  };
}

export const secondsOrNull = (x: unknown): number | null => (typeof x === 'number' && x >= 0 ? x : null);
