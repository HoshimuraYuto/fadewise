import type * as Analysis from '../../../shared/analysis.mts';
import type { IndexEntry } from '../../../shared/types.mts';
import type { PlayerWindow } from '../../../page/player-main.mts';
import type { Loose } from '../player-sim.mts';
import type { FakeContext, GainLike, Node } from './audio.mts';

export type { Loose };

export type Port = { onmessage?: ((m: { data: Loose }) => void) | null; postMessage?: (c: Loose) => void };
export type MeterNode = Node & { port: Port };

export interface OverlapModel {
  node: Node;
  mode: 'pass' | 'capture' | 'drain';
  lead: number;
  msgs: Loose[];
  posted: Loose[];
  xfAt: number | null;
  xfSec?: number;
  rate?: unknown;
  shape?: unknown;
  step: (dt: number, playing: boolean, rateNow: number) => void;
}

export interface MediaState {
  ct: number;
  paused: boolean;
  dur: number;
  ended: boolean;
  readyState: number;
  rate: number;
  pp: boolean;
}

export interface SimTrack {
  d: number;
  [key: string]: unknown;
}

export interface SimOptions {
  queue: string[];
  tracks: Record<string, SimTrack>;
  url?: string;
  nextWorks?: boolean;
  albumPos?: Record<string, number> | null;
  analysis?: typeof Analysis;
  reorder?: boolean;
  overlapUrl?: boolean;
  settings?: Loose;
  index?: Record<string, IndexEntry | Loose>;
  energyAt?: (vid: string, ct: number) => number;
}

export interface Sim {
  w: PlayerWindow;
  ctx: FakeContext;
  gains: GainLike[];
  clicks: number;
  prevClicks: number;
  diag: Loose[];
  status: Loose;
  snapshots: Loose[];
  queue: string[];
  qi: number;
  tracks: Record<string, SimTrack>;
  adNow: boolean;
  nextWorks: boolean;
  nextLoadsPaused?: boolean;
  repeatOne?: 'seek' | 'reload' | null;
  frameT: number;
  errorsAt: number[];
  rateLog: [number, number, boolean, boolean][];
  albumPos: Record<string, number> | null;
  video: HTMLVideoElement;
  meter?: MeterNode;
  ov?: OverlapModel;
  renderQueue: () => void;
  load: (i: number, startCt?: number, noPlay?: boolean) => void;
  send: (type: string, data: unknown) => void;
  reload: () => void;
  rate: () => number;
  pp: () => boolean;
  setRate: (x: number) => void;
  fade: () => GainLike;
  fg: () => number;
  ct: () => number;
  setAd: (on: boolean) => void;
  run: (sec: number, onFrame?: (s: Sim) => void) => Promise<void>;
  start: (startCt?: number) => Promise<void>;
  pause: () => void;
  play: () => Promise<void>;
  seek: (x: number) => void;
  vid: () => string;
}
