import * as Analysis from '../../shared/analysis.mts';
import type { BeatAlign, SwitchPlan, SwitchRecord } from '../../shared/analysis.mts';
import * as Reorder from '../../shared/reorder.mts';
import type { IndexEntry } from '../../shared/types.mts';
import * as ReorderPage from '../reorder-page.mts';
import type {
  BeatOutcome,
  Capture,
  FadeState,
  Head,
  Ov,
  PlayerDeps,
  PlayerSettings,
  PlaySession,
  RecentTr,
  Rush,
  Status,
  Tk,
  TrackGain,
  Tr,
  TrIn,
  TrOut,
} from './types.mts';

export interface SwitchLog {
  list: SwitchRecord[];
  cur: { vid: string; loudAt: number | null } | null;
  adv: { vid: string; at: number; plan: SwitchPlan } | null;
  drainEnd: number | null;
  beat: { at: number; why: string; miss: number | null | undefined } | null;
  open: { rec: SwitchRecord; to: string; t0: number } | null;
}

export interface LiveGap {
  vid: string | null;
  st: Analysis.LiveGapState | null;
  lufsAt: number;
  lufs: number | null;
}

export interface Sleeper {
  due: number;
  resolve: () => void;
  done: boolean;
}

export interface Player {
  win: import('./types.mts').PlayerWindow;
  doc: Document;
  A: typeof Analysis;
  RO: typeof Reorder | null;
  RP: typeof ReorderPage;

  settings: PlayerSettings;
  index: Record<string, IndexEntry | null | undefined>;
  excluded: Set<string>;
  recent: { tr: RecentTr | null; gapless: { at: number; from: string; to: string } | null };
  status: Status;
  errors: number;
  detachedAt: number | null;

  workletUrl: string | null;
  overlapUrl: string | null;
  video: HTMLVideoElement | null;
  ctx: AudioContext | null;
  gainNode: GainNode | null;
  fadeNode: GainNode | null;
  meterNode: AudioWorkletNode | null;
  meterSource: MediaElementAudioSourceNode | null;
  postTapOn: boolean;
  connected: boolean;
  connectedAt: number | null;
  meterOk: boolean;

  hardGuardUntil: number;
  softGuardUntil: number;
  adGuardUntil: number;
  head: Head | null;
  lastFrame: { ct: number; t: number; vid: string | null } | null;
  session: PlaySession | null;
  sessionId: string | null;
  framesSinceFlush: number;
  flushes: number;
  prevAccepted: boolean;
  counts: Record<string, number>;
  wasAd: boolean;
  tk: Tk | null;
  load: { frames: number; fxMs: number; pMs: number; maxPMs: number; since: number };
  frameIn: { lufs: number | null; ok: boolean };

  track: TrackGain | null;
  fade: FadeState | null;

  tr: Tr;
  trPrev: { vid: string | null; ct: number | null };
  trOut: Record<string, TrOut | undefined>;
  trIn: Record<string, TrIn | undefined>;
  washSend: GainNode | null;
  washOut: GainNode | null;
  gap: LiveGap;

  ov: Ov;
  ovNode: AudioWorkletNode | null;
  ovInGraph: boolean;
  ovLoading: boolean;
  ovBeat: { vid: string; out: BeatOutcome; align: BeatAlign; cap: Capture } | null;
  rush: Rush | null;
  selfRate: boolean;
  ppTouched: boolean;
  ppPre: boolean;

  sw: SwitchLog;
  sleepers: Sleeper[];
  reorderer: ReturnType<typeof ReorderPage.createReorderer> | null;
  debugStateAt: number;
}

export const trIdle = (): Tr => ({
  state: 'idle',
  fromVid: null,
  kind: null,
  since: 0,
  selfSeek: false,
  selfSeekUntil: 0,
  fadeInEnd: 0,
});

export const ovIdle = (): Ov => ({
  state: 'idle',
  vid: null,
  cap: null,
  plan: null,
  fadeOut: null,
  pendingDb: null,
  oldDb: 0,
  since: 0,
  selfSeekUntil: 0,
});

const defaultSettings = (): PlayerSettings => ({
  gainEnabled: true,
  fadesEnabled: true,
  beatAlign: true,
  transitions: false,
  transitionWash: false,
  overlap: false,
  mixPoints: 'gentle',
  reorder: false,
  reorderAlbums: false,
  postMeter: false,
  saveAnalysis: false,
  targetLufs: -10,
  maxBoostDb: 6,
});

const env = (win: import('./types.mts').PlayerWindow, deps?: PlayerDeps) => ({
  win,
  doc: win.document,
  A: deps?.analysis ?? Analysis,
  RO: deps?.reorder === undefined ? Reorder : deps.reorder,
  RP: deps?.reorderPage ?? ReorderPage,
});

const audioGraph = () => ({
  workletUrl: null,
  overlapUrl: null,
  video: null,
  ctx: null,
  gainNode: null,
  fadeNode: null,
  meterNode: null,
  meterSource: null,
  postTapOn: false,
  connected: false,
  connectedAt: null,
  meterOk: false,
});

const analysisState = () => ({
  hardGuardUntil: 0,
  softGuardUntil: 0,
  adGuardUntil: 0,
  head: null,
  lastFrame: null,
  session: null,
  sessionId: null,
  framesSinceFlush: 0,
  flushes: 0,
  prevAccepted: false,
  counts: {},
  wasAd: false,
  tk: null,
  load: { frames: 0, fxMs: 0, pMs: 0, maxPMs: 0, since: Date.now() },
  frameIn: { lufs: null, ok: false },
});

const transitionState = () => ({
  track: null,
  fade: null,
  tr: trIdle(),
  trPrev: { vid: null, ct: null },
  trOut: {},
  trIn: {},
  washSend: null,
  washOut: null,
  gap: { vid: null, st: null, lufsAt: -1, lufs: null },
  ov: ovIdle(),
  ovNode: null,
  ovInGraph: false,
  ovLoading: false,
  ovBeat: null,
  rush: null,
  selfRate: false,
  ppTouched: false,
  ppPre: false,
});

export function createPlayer(win: import('./types.mts').PlayerWindow, deps?: PlayerDeps): Player {
  return {
    ...env(win, deps),
    settings: defaultSettings(),
    index: {},
    excluded: new Set<string>(),
    recent: { tr: null, gapless: null },
    status: { state: 'idle' },
    errors: 0,
    detachedAt: null,
    ...audioGraph(),
    ...analysisState(),
    ...transitionState(),
    sw: { list: [], cur: null, adv: null, drainEnd: null, beat: null, open: null },
    sleepers: [],
    reorderer: null,
    debugStateAt: 0,
  };
}

export const isExcluded = (pl: Player, vid: string | null | undefined): boolean => !!vid && pl.excluded.has(vid);
