import type * as Analysis from '../../shared/analysis.mts';
import type { FadePlan, FadeTimes, Gain, OverlapPlan, Session, TransitionPlan } from '../../shared/analysis.mts';
import type * as Reorder from '../../shared/reorder.mts';
import type { MixKind } from '../../shared/types.mts';
import type * as ReorderPage from '../reorder-page.mts';

interface VerifyHooks {
  __fadewiseLoaded?: boolean;
  __fadewiseOvLog?: unknown[][];
  __fadewiseHeadMode?: unknown;
  __fadewiseBeatAlign?: unknown;
  __fadewiseHeadLong?: unknown;
  __fadewiseProbe?: unknown[][];
  __fadewiseUnder?: number;
  __fadewiseMeterLog?: Record<string, unknown>[];
}
export type PlayerWindow = ReorderPage.PageWindow & VerifyHooks;
export interface PlayerDeps {
  analysis?: typeof Analysis;
  reorder?: typeof Reorder | null;
  reorderPage?: typeof ReorderPage;
}

export interface PlayerSettings {
  gainEnabled?: boolean;
  fadesEnabled?: boolean;
  beatAlign?: boolean;
  transitions?: boolean;
  transitionWash?: boolean;
  overlap?: boolean;
  leadRate?: number;
  overlapStyle?: string;
  mixPoints: string;
  reorder?: boolean;
  reorderAlbums?: boolean;
  postMeter?: boolean;
  saveAnalysis?: boolean;
  targetLufs: number;
  maxBoostDb: number;
  reorderDebug?: boolean;
  [key: string]: unknown;
}
export interface MoviePlayer extends HTMLElement {
  getVideoData?: () => { video_id?: string } | null;
  getDuration?: () => number;
  getPlayerResponse?: () => {
    videoDetails?: { videoId?: string };
    playerConfig?: { audioConfig?: { perceptualLoudnessDb?: number; loudnessTargetLkfs?: number } };
  } | null;
}
export interface Renderer {
  videoId?: unknown;
  navigationEndpoint?: { watchEndpoint?: { index?: unknown; playlistId?: unknown } };
  playlistPanelVideoRenderer?: Renderer;
  playlistPanelVideoWrapperRenderer?: { primaryRenderer?: { playlistPanelVideoRenderer?: Renderer } };
}
export type Row = Element & { data?: Renderer | null };
export interface QueueInfo {
  next: string | null;
  album: boolean;
  albumNext: boolean | null;
  prev?: string | null;
}
export interface Frame {
  t: number;
  e: number;
  p: number;
  n: number;
  fx?: number[] | null;
  cr?: number[] | null;
  bd?: number[] | null;
  e2?: number;
  p2?: number;
  st?: unknown[][];
  seq?: number;
  fxMs?: number;
  pMs?: number;
}
export type GainDecision = Pick<Gain, 'gainDb'> &
  Partial<Omit<Gain, 'gainDb' | 'source'>> & {
    source: string;
    ownLufs?: number | null;
    pLd?: number | null;
    peakDb?: number | null;
  };
export interface TrackGain {
  vid: string;
  locked: boolean;
  firstSoundAt: number | null;
  decided: GainDecision | null;
  appliedAt: number | null;
}
export type PlayerPlan = Omit<FadePlan, 'reason'> & { reason: string; gapless?: boolean };
export type TPlan = Pick<TransitionPlan, 'kind' | 'reason' | 'advanceAtPos'> & Partial<TransitionPlan>;
export interface FadeState {
  vid: string;
  nextVid: string | null;
  qSig: string;
  gapless: boolean;
  plan: PlayerPlan | null;
  tplan: TPlan | null;
  oplan: OverlapPlan | null;
  mixNone: string | null;
  mixOff?: boolean;
  mixOffWhy?: string;
  ovDone: boolean;
  trDone: boolean;
  scheduled: FadeTimes | null;
  fadingIn: boolean;
  fadeInEnd?: number;
  fadeOutDone: boolean;
  fadeInDone: boolean;
  lastAction: string | null;
  outResult: string | null;
  outCancel: string | null;
  pairCheckedAt: number;
  ending: { kind: unknown; fadeSec: unknown; silenceSec: unknown; lastSoundSec: unknown } | null;
  qSeen?: { at: number; q: QueueInfo };
}
export interface PlanResult {
  plan: PlayerPlan | null;
  tplan: TPlan;
  oplan?: OverlapPlan | null;
  mixNone?: string | null;
  gapless?: boolean;
}
export type TrState = 'idle' | 'armed' | 'advancing' | 'incoming' | 'trimming' | 'fadingIn';
export interface MixIn {
  vid: string;
  t: number;
  k: MixKind;
  c: number;
  from: string;
  xk: MixKind;
  xt: number;
}
export interface Tr {
  state: TrState;
  fromVid: string | null;
  kind: string | null;
  since: number;
  selfSeek: boolean;
  selfSeekUntil: number;
  fadeInEnd: number;
  live?: boolean;
  washOpen?: boolean;
  overlap?: boolean;
  noFade?: boolean;
  mixIn?: MixIn | null;
  fadeInSec?: number;
}
export interface OverlapNote {
  shape?: string | null;
  leadSec?: number;
  planLeadSec?: number | null;
  startSec?: number;
  state?: string;
  cancel?: string | null;
  leadOutSec?: unknown;
  xfSec?: unknown;
  swapSec?: unknown;
  lostSec?: unknown;
  beat?: BeatOutcome | null;
}
export interface TrOut {
  kind?: string | null;
  reason?: string;
  state?: string;
  atSec?: number | null;
  skipSec?: number | null;
  planSec?: number | null;
  pair?: unknown;
  cancel?: string | null;
  cancelAfter?: string | null;
  wash?: boolean;
  overlap?: OverlapNote;
  mix?: { mode: unknown; x: MixKind; n: MixKind; xSec: number; nSec: number };
}
export interface TrIn {
  fadeIn: boolean;
  fadeInSec?: number;
  headTrimTo: number | null;
  headReason: string;
  at: number;
  wall: number;
  overlap?: boolean;
  cancel?: string | null;
  mix?: MixIn;
  seekAt?: number;
  headRush?: Record<string, unknown>;
}
export interface RecentTr {
  at: number;
  from: string;
  kind: string | null;
  skipSec: number;
  fadeSec: number | null;
  headTrimSec: number | null;
  overlap: boolean;
  overlapSec: unknown;
  leadOutSec?: unknown;
  overlapCancel?: string;
}
export interface Capture {
  t0: number;
  p0: number;
  delaySec: number;
  leadSec: number;
  rate: number;
  shape: string | null;
}
export interface Ov {
  state: 'idle' | 'capture' | 'drain';
  vid: string | null;
  cap: Capture | null;
  plan: OverlapPlan | null;
  fadeOut: FadeTimes | null;
  pendingDb: number | null;
  oldDb: number;
  since: number;
  selfSeekUntil: number;
  lastCt?: number;
  lastDur?: number | null;
  inSound?: boolean;
  newSoundAt?: number;
}
export interface BeatOutcome {
  on: boolean;
  why: string;
  shiftSec?: number | null;
  missBeats?: number | null;
}
export interface OvEvent {
  ev?: string;
  killed?: boolean;
  leadOutSec?: unknown;
  xfSec?: unknown;
  lostSec?: unknown;
  [key: string]: unknown;
}
export interface Rush {
  vid: string;
  until: number | null;
  mode: 'plain' | 'overlap';
  ct0: number;
  t0: number;
  pp0: boolean;
  from: string | null;
  timer?: number;
  limit?: number;
}
export interface TkSegment {
  start: number | null;
  flux: number[];
}
export interface Tk {
  vid: string;
  segments: TkSegment[];
  cur: TkSegment | null;
  chromaSum: number[];
  chromaFrames: number;
  flux: number;
  segFrames: number;
  blocks: Map<number, number[]>;
  mx?: (number | null)[][] | null;
  mxRun?: number;
}
export type PlaySession = Session & {
  save: boolean;
  startedAt: number;
  meta?: { title: string; artist: string | null } | null;
  yt?: { pLd: number | null; target: number | null } | null;
  lastApplied?: Record<string, unknown>;
};
export interface Head {
  vid: string;
  prevCt: number | null;
  prevT: number | null;
  killed: boolean;
  pending: [number, number, number, Frame['fx'], Frame['cr'], number, Frame['bd']][];
}
export type Status = Record<string, unknown> & { state: string };
