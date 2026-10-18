export type MixMode = 'gentle' | 'auto' | 'aggressive';
export type UiLanguage = 'auto' | 'ja' | 'en';
export type OverlapStyleMode = 'auto' | 'simple';

export interface Settings {
  gainEnabled: boolean;
  fadesEnabled: boolean;
  beatAlign: boolean;
  transitions: boolean;
  transitionWash: boolean;
  overlap: boolean;
  leadRate: number;
  overlapStyle: OverlapStyleMode;
  mixPoints: MixMode;
  reorder: boolean;
  reorderAlbums: boolean;
  reorderToast: boolean;
  queueBadges: boolean;
  seekbarMarks: boolean;
  reorderDebug: boolean;
  autoContinue: boolean;
  analysisEnabled: boolean;
  uiLanguage: UiLanguage;
  postMeter: boolean;
  targetLufs: number;
  maxBoostDb: number;
}
export type PresetKey =
  | 'gainEnabled'
  | 'fadesEnabled'
  | 'beatAlign'
  | 'transitions'
  | 'transitionWash'
  | 'reorder'
  | 'reorderAlbums';
export type PresetValues = Pick<Settings, PresetKey>;
export interface StoredSettings extends Partial<Omit<Settings, 'mixPoints' | 'leadRate' | 'overlapStyle'>> {
  mixPoints?: unknown;
  leadRate?: unknown;
  overlapStyle?: unknown;
  skipSilence?: unknown;
  offFrom?: Partial<PresetValues> | null;
  [key: string]: unknown;
}
export interface Consent {
  decision?: string;
  version?: number;
  at?: number;
}

export interface Camelot {
  n: number;
  l: 'A' | 'B';
}
export interface KeyEdge {
  camelot: string | null;
  keyConf?: number;
  famConf?: number;
  related?: string[];
}
export type EdgeSource = 'segment' | 'track' | 'track+segment' | null;
export interface OrderKeyEdge {
  bpm: number | null;
  bc: number;
  cam: string | null;
  kc: number;
  fc: number;
  rel: string[];
  src: { key: EdgeSource; tempo: EdgeSource };
  chg: { key: boolean; tempo: boolean };
}
export interface OrderKey {
  bpm: number | null;
  bc: number;
  cam: string | null;
  kc: number;
  fc: number;
  rel: string[];
  head?: OrderKeyEdge | null;
  tail?: OrderKeyEdge | null;
}

export type KeyModeName = 'major' | 'minor';
export interface RelatedKey {
  tonic: number;
  mode: KeyModeName;
  name: string | null;
  camelot: string | null;
  gap: number | null;
}
export interface KeySummary {
  v: number;
  tonic: number;
  mode: KeyModeName;
  name: string | null;
  camelot: string | null;
  r: number | null;
  margin: number | null;
  confidence: number;
  familyConfidence: number;
  runnerUp: string | null;
  runnerUpRelated: boolean;
  related: RelatedKey[];
}
export interface TempoSummary {
  bpm: number;
  confidence: number;
  agreement: number | null;
  octaveAgreement: number | null;
  agreeingSec: number | null;
  totalSec: number | null;
  alt: ('double' | 'half')[];
  phaseSec?: number | null;
}
// [bpm, sec, phaseSec, anchorSec, periodSec, rmsMs, endSec]; old stored votes have only the first three
export type TempoVote = (number | null)[];
export type SegmentVote = [bpm: number, sec: number, rmsMs: number | null];
export interface SegmentSummary {
  tempo: { bpm: number; confidence: number; alt: ('double' | 'half')[]; rmsMs: number | null } | null;
  key: Pick<KeySummary, 'name' | 'camelot' | 'tonic' | 'mode' | 'confidence' | 'familyConfidence'> | null;
}
export interface Segment extends Partial<SegmentSummary> {
  at: number | null;
  approx: boolean;
  votes: SegmentVote[];
  cs: (number | null)[];
  cf: number | null;
}
export interface Segments {
  v: number;
  head: Segment | null;
  tail: Segment | null;
}
export interface TempoKey {
  logicVersion: number;
  votes: TempoVote[];
  chromaSum: (number | null)[];
  chromaFrames: number;
  listens: number;
  tempo: TempoSummary | null;
  key: KeySummary | null;
  updatedAt: number;
  seg?: Segments;
  lastListen?: { fluxSec: number; votes: number; chromaFrames: number; ms: number };
}
export interface PageTempoKey {
  logicVersion?: number;
  tempo?: TempoSummary | null;
  votes?: TempoVote[];
  key: KeySummary | null;
  edges: { head: OrderKeyEdge; tail: OrderKeyEdge } | null;
}

export type MixRow = [
  t: number,
  kindCode: number,
  confidence: number,
  luVsI: number | null,
  bpm?: number | null,
  camelot?: string | null,
];
export interface MixRecord {
  v: number;
  g: [number | null, number | null, number | null];
  x: MixRow[];
  n: MixRow[];
  h: [number, number, number];
}

export type Cell = [indexSec: number, frames: number, lufs: number | null, peakDbfs: number | null, ...rest: unknown[]];
export interface Tail {
  endPos: number | null;
  lufs: number[];
}
export type EndingKind = 'abrupt' | 'stop' | 'fades' | 'decays' | 'unknown';
export interface Ending {
  kind: EndingKind;
  fadeSec: number | null;
  lastSoundSec: number | null;
  silenceSec: number | null;
  decaySec: number | null;
  endRelLu: number | null;
}
export interface TrackRecord {
  videoId: string;
  title: string | null;
  artist: string | null;
  durationSec: number | null;
  cells: Cell[];
  integratedLufs: number | null;
  peakDb: number | null;
  coverage: number | null;
  firstSoundSec: number | null;
  firstSoundExact: boolean;
  lastSoundSec: number | null;
  headProfile: (number | null)[];
  tailProfile: (number | null)[];
  tail: Tail | null;
  ending: Ending | null;
  ytPerceptualLoudnessDb: number | null;
  ytLoudnessTargetLkfs: number | null;
  analysisCount: number;
  updatedAt: number | null;
  logicVersion: number;
  tempoKey?: TempoKey | PageTempoKey | null;
  applied?: unknown[];
  mix?: MixRecord | null;
}

export interface BeatInfo {
  bpm: number;
  conf: number;
  alt: string[];
  ph: number | null;
  // [bpm, sec, anchorSec, periodSec, rmsMs, endSec], oldest first
  grids: number[][];
}
export type MixKind = 'first' | 'thin' | 'lift' | 'last' | 'fade' | 'chorusEnd';
export interface MixCandidate {
  t: number;
  k: MixKind;
  c: number;
  e: number | null;
  bpm: number | null;
  key: string | null;
}
export interface MixView {
  g?: { bpm: number | null } | null;
  x: MixCandidate[];
  n: MixCandidate[];
  heard?: { head: boolean; tail: boolean; full: number };
}
export interface IndexEntry {
  l?: number | null;
  c?: number | null;
  p?: number | null;
  y?: number | null;
  fs?: number | null;
  fx?: boolean;
  h0?: number | null;
  hq?: number;
  d?: number | null;
  en?: Partial<Ending> | null;
  bt?: BeatInfo | null;
  tk?: OrderKey | null;
  mx?: MixView | null;
}
