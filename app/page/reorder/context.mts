import type * as Reorder from '../../shared/reorder.mts';
import type { QueueKind } from '../../shared/reorder.mts';
import type { IndexEntry } from '../../shared/types.mts';
import { C, type Timing } from '../../shared/reorder-timing.mts';
import { debugView, type DebugView, type KeyBpm } from './debug-view.mts';
import type { PageWindow } from './queue-panel.mts';
import type { QueueDom } from './queue-dom.mts';

export interface Playing {
  vid: string | null;
  ct: number;
  duration: number;
  paused: boolean;
  ad: boolean;
}
export interface RunRecord {
  at: number;
  kind: QueueKind | null;
  result: 'skipped' | 'aborted' | 'done' | 'partial';
  reason: string | null;
  method: 'none' | 'drag' | 'menu';
  moved: number;
  planned: number;
  movable: number;
  window: number;
  gain: number;
  ms: number;
  by?: string;
}
export type Diag = Record<string, unknown> & { kind: string };
export type DomPart = Pick<
  QueueDom,
  'read' | 'panelVisible' | 'drag' | 'playNextMove' | 'scrollState' | 'restoreScroll'
> &
  Partial<Pick<QueueDom, 'signature' | 'resume' | 'ytToast' | 'ids' | 'selIndex' | 'ownScroll' | 'setNote'>>;
export interface ReordererDeps {
  R: Pick<
    typeof Reorder,
    'movedBetween' | 'summaryOf' | 'queueKind' | 'kindAllowed' | 'DEFAULTS' | 'planReorder' | 'movesFor' | 'applyMove'
  >;
  dom: DomPart;
  win: PageWindow;
  now: () => number;
  wall: () => number;
  playing: () => Playing | null;
  trState: () => string | null | undefined;
  trArmAt: () => number | null;
  settings: () => { reorder?: boolean; reorderAlbums?: boolean; [k: string]: unknown };
  entry: (vid: string) => IndexEntry | null | undefined;
  fixedIds?: () => Iterable<string>;
  onRun?: (run: RunRecord) => void;
  onDiag?: (d: Diag) => void;
  onDebug?: (v: DebugView) => void;
  timing?: Partial<Timing>;
  isTrusted?: (e: Event) => boolean;
  hasFocus?: () => boolean;
}
export interface ScrollRun {
  src: 'ext' | 'user' | 'ytm';
  why: string | null;
  from: number;
  to: number;
  t0: number;
  last: number;
}
export interface ReordererState {
  state: 'idle' | 'waiting' | 'running' | 'done';
  vid: string | null;
  since: number;
  waitReason: string | null;
  lastSeen: string[] | null;
  listId: string | null;
  src: string[];
  userMoved: Map<string, number>;
  lastOrderSig: string | null;
  lastRun: RunRecord | null;
  runs: number;
  lastInput: number;
  abort: string | null;
  runEndAt: number;
  lastScrollInput?: number;
  handAt?: number;
  toastOn?: boolean;
  toastAt?: number;
  obs?: { ids: string[]; sel: number };
  scroll?: { top: number; own: number; cur: ScrollRun | null };
  runScrolls?: Partial<Record<ScrollRun['src'], number>> | null;
  ours?: { vid: string; at: number; ids: Set<string> };
  contested?: string | null;
  guard?: { vid: string; until: number; pausedAt: number; presses: number } | null;
  retries?: number;
  pageRetries?: number;
  quietSec?: number;
  qsig?: string | null;
  qsigAt?: number;
}

export interface Ctx {
  deps: ReordererDeps;
  R: ReordererDeps['R'];
  dom: DomPart;
  T: Timing;
  st: ReordererState;
  hasFocus: () => boolean;
  diag: (kind: string, extra?: object | null) => void;
  record: (run: RunRecord) => void;
  runBase: (kind: QueueKind | null) => RunRecord;
  giveUp: (reason: string) => void;
}

function initialState(): ReordererState {
  return {
    state: 'idle',
    vid: null,
    since: 0,
    waitReason: null,
    lastSeen: null,
    listId: null,
    src: [],
    userMoved: new Map(),
    lastOrderSig: null,
    lastRun: null,
    runs: 0,
    lastInput: -Infinity,
    abort: null,
    runEndAt: -Infinity,
  };
}

function focusCheck(deps: ReordererDeps): () => boolean {
  if (deps.hasFocus) return deps.hasFocus;

  return () => {
    try {
      return deps.win.document.hasFocus();
    } catch {
      return true;
    }
  };
}

function createDiag(deps: ReordererDeps) {
  const keyOf = (id: unknown): KeyBpm => {
    const tk = typeof id === 'string' && id ? deps.entry(id)?.tk : null;
    if (!tk) return { key: null, bpm: null };

    return {
      key: typeof tk.cam === 'string' ? tk.cam : null,
      bpm: typeof tk.bpm === 'number' ? Math.round(tk.bpm) : null,
    };
  };

  return (kind: string, extra?: object | null) => {
    const x: Record<string, unknown> = { ...extra };

    if ('kind' in x) {
      x.queue = x.kind;
      delete x.kind;
    }

    x.kind = 'ro_' + kind;

    try {
      deps.onDiag?.(x as Diag);
    } catch {
      /* ignore */
    }

    try {
      const view = deps.onDebug ? debugView(x as Diag, keyOf) : null;
      if (view) deps.onDebug?.(Object.assign(view, { at: deps.wall() }));
    } catch {
      /* ignore */
    }
  };
}

export function createContext(deps: ReordererDeps): Ctx {
  const st = initialState();
  const diag = createDiag(deps);

  const runBase = (kind: QueueKind | null): RunRecord => ({
    at: deps.wall(),
    kind,
    result: 'skipped',
    reason: null,
    method: 'none',
    moved: 0,
    planned: 0,
    movable: 0,
    window: 0,
    gain: 0,
    ms: 0,
  });

  const record = (run: RunRecord) => {
    st.lastRun = run;
    st.runs++;
    diag('run', run);

    try {
      deps.onRun?.(run);
    } catch {
      /* ignore */
    }
  };

  return {
    deps,
    R: deps.R,
    dom: deps.dom,
    T: Object.assign({}, C, deps.timing || {}),
    st,
    hasFocus: focusCheck(deps),
    diag,
    record,
    runBase,
    giveUp: (reason) => {
      st.state = 'done';
      record(Object.assign(runBase(null), { reason }));
    },
  };
}
