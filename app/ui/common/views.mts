import type { RunLogEntry } from '../../shared/reorder.mts';
import type { Ending } from '../../shared/types.mts';
import type { NextPlan, overlapAdaptText, overlapBasisText, overlapStyleText } from '../mix-text.mts';

export type Num = number | null | undefined;

export interface PairView {
  tempo?: string;
  key?: string;
  reasons?: string[];
  fadeOutSec?: Num;
  fadeInSec?: Num;
  wash?: boolean;
  extraWaitSec?: number;
}

export interface IncomingView {
  headTrimTo?: Num;
  fadeIn?: boolean;
  fadeInSec?: Num;
  headReason?: string;
  cancel?: string | null;
}

export interface TransitionView {
  kind?: string;
  atSec?: Num;
  skipSec?: Num;
  reason?: string;
  result?: string | null;
  cancel?: string | null;
  state?: string;
  overlapSec?: Num;
  overlapAdapt?: Parameters<typeof overlapAdaptText>[0];
  overlapBasis?: Parameters<typeof overlapBasisText>[0];
  overlapStyle?: Parameters<typeof overlapStyleText>[0];
  pair?: PairView | null;
  wash?: boolean;
  incoming?: IncomingView | null;
  next?: NextPlan | null;
}

export interface AlignView {
  on?: boolean;
  reason?: string;
  conf?: Num;
  mode?: string;
  beats?: number;
  bpm?: Num;
  endOnBeat?: boolean;
}

export interface FadeView {
  vid?: string;
  gapless?: boolean;
  fadeIn?: boolean;
  fadeOutStart?: Num;
  fadeOutEnd?: Num;
  planReason?: string;
  align?: AlignView | null;
  transition?: TransitionView | null;
  lastAction?: string | null;
}

interface RecentTr {
  at: number;
  kind?: string;
  skipSec?: Num;
  fadeSec?: Num;
  headTrimSec?: Num;
  overlapSec?: Num;
}

export interface RecentView {
  tr?: RecentTr | null;
  gapless?: { at: number } | null;
}

export interface ReorderStateView {
  state?: string;
  wait?: string;
}

export interface StatusView {
  at?: number;
  state?: string;
  videoId?: string;
  ad?: boolean;
  excluded?: boolean;
  gainSource?: string;
  appliedGainDb?: Num;
  fade?: FadeView | null;
  recent?: RecentView | null;
  switches?: unknown;
  reorder?: ReorderStateView | null;
  sessionAcceptedSec?: Num;
  tempoKey?: { fluxSec?: Num; segments?: number } | null;
  errors?: number;
  lastError?: string;
}

interface TempoView {
  bpm?: unknown;
  alt?: string[];
  confidence?: number;
}

export type TempoKeyView = object | null | undefined;
export const tempoOf = (tk: TempoKeyView): TempoView | null | undefined =>
  (tk as { tempo?: TempoView | null } | null)?.tempo;
export const hasSegments = (tk: TempoKeyView): boolean => !!(tk as { seg?: unknown } | null)?.seg;

export interface AppliedView {
  gain?: { db?: Num; source?: string; limit?: string; wantedDb?: Num } | null;
  fadeOut?: { state?: string; cancel?: string; align?: AlignView | null } | null;
  fadeIn?: { done?: boolean } | null;
  skipAtSec?: Num;
  transition?: TransitionView | null;
}

export interface RecordView {
  title?: string | null;
  artist?: string | null;
  ending?: Partial<Ending> | null;
  tempoKey?: TempoKeyView;
}

export type Run = Partial<RunLogEntry> | null | undefined;

export const STATUS_FRESH_MS = 15000;
