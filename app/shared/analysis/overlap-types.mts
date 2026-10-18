import type { BeatAlign } from './beat-align.mts';

export interface OverlapAdapt {
  why: 'both' | 'key_clash' | 'tempo_far';
  baseLeadSec: number;
  baseShape: string;
  cams: (string | null)[] | null;
  bpms: (number | null)[] | null;
}
export type OverlapOut = 'fades' | 'decays' | 'abrupt' | 'stop' | 'mid' | 'other';
export type OverlapIn = 'loud_entry' | 'cut_in' | 'intro' | 'soft' | 'plain' | 'short';
export interface OverlapBasis {
  out: OverlapOut;
  outSec: number;
  in: OverlapIn | null;
  inSec: number | null;
  long: 'intro' | 'soft' | 'key_tempo' | null;
  waitSec?: number;
  covered?: boolean;
}
export interface OverlapPlan {
  on: boolean;
  why: string;
  leadSec: number | null;
  rate: number;
  shape: string | null;
  captureStartPos: number | null;
  advanceAtPos: number | null;
  adapt: OverlapAdapt | null;
  basis: OverlapBasis | null;
  style?: OverlapStyle | null;
}
export type OverlapStyleKind = 'tail' | 'blend' | 'segue';
export type OverlapStyleWhy = 'tempo_far' | 'tempo_unknown' | 'key_clash' | 'tempo_close' | 'cut' | 'stop';
export interface OverlapStyle {
  kind: OverlapStyleKind;
  why: OverlapStyleWhy;
  curve: 'equal' | 'segue' | 'overlap';
  bass: boolean;
  hpNew: boolean;
  hpOld: boolean;
  swapAt: number;
  swapLeftSec: number | null;
  swapPos: number | null;
  aligned: 'both' | 'old' | 'new' | null;
  swapInSec: number | null;
  bars: number | null;
  cams: (string | null)[] | null;
  bpms: (number | null)[] | null;
  beat?: BeatAlign | null;
}
