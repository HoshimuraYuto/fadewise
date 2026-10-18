import { isNum } from './score.mts';

export type QueueKind = 'album' | 'mix' | 'radio' | 'playlist' | 'unknown';

export function queueKind(listId: unknown, isInfinite?: unknown): QueueKind {
  const l = typeof listId === 'string' ? listId : '';
  if (l.startsWith('OLAK5uy_')) return 'album';
  // auto-generated mixes (Replay Mix, Supermix...): YouTube Music reorders these itself
  if (l.startsWith('RDTMAK')) return 'mix';
  if (l.startsWith('RD') || isInfinite === true) return 'radio';
  if (l) return 'playlist';

  return 'unknown';
}

export function kindAllowed(kind: unknown, settings?: { reorderAlbums?: unknown } | null): boolean {
  const s = settings || {};
  if (kind === 'radio' || kind === 'playlist' || kind === 'mix') return true;
  if (kind === 'album') return s.reorderAlbums === true;

  return false;
}

export const CODES = {
  kind: ['radio', 'playlist', 'album', 'mix', 'unknown'],
  result: ['done', 'partial', 'skipped', 'aborted'],
  reason: [
    'ok',
    'same',
    'small_gain',
    'few_movable',
    'duplicate',
    'kind',
    'no_queue',
    'not_visible',
    'near_end',
    'ad',
    'transition',
    'user_input',
    'user_moved',
    'track_change',
    'drop',
    'order',
    'store',
    'playing',
    'timeout',
    'off',
    'error',
    'not_found',
    'menu',
    'hidden',
    'queue_changed',
    'paused',
    'contested',
  ],
  method: ['drag', 'menu', 'none'],
  by: ['pointerdown', 'mousedown', 'click', 'keydown', 'wheel', 'touchstart', 'held'],
};
export interface RunLogEntry {
  at: number;
  kind: string | null;
  result: string | null;
  reason: string | null;
  method: string | null;
  moved: number | null;
  planned: number | null;
  movable: number | null;
  window: number | null;
  gain: number | null;
  ms: number | null;
  by?: string;
}

export function sanitizeRun(r: unknown): RunLogEntry | null {
  if (!r || typeof r !== 'object') return null;
  const x = r as Record<string, unknown>;
  if (!isNum(x.at)) return null;
  const code = (list: keyof typeof CODES, v: unknown) => (typeof v === 'string' && CODES[list].includes(v) ? v : null);
  const n = (v: unknown, d: number) => (isNum(v) ? +v.toFixed(d) : null);
  const out: RunLogEntry = {
    at: Math.round(x.at),
    kind: code('kind', x.kind),
    result: code('result', x.result),
    reason: code('reason', x.reason),
    method: code('method', x.method),
    moved: n(x.moved, 0),
    planned: n(x.planned, 0),
    movable: n(x.movable, 0),
    window: n(x.window, 0),
    gain: n(x.gain, 3),
    ms: n(x.ms, 0),
  };
  const by = code('by', x.by);
  if (by && out.reason === 'user_input') out.by = by;

  return out;
}

export const RUN_LOG_KEEP = 20;

export function mergeRunLog(list: unknown, run: unknown): RunLogEntry[] {
  const e = sanitizeRun(run);
  const prev = Array.isArray(list)
    ? (list as unknown[]).filter((x): x is RunLogEntry => !!x && isNum((x as { at?: unknown }).at))
    : [];

  return (e ? prev.concat(e) : prev).slice(-RUN_LOG_KEEP);
}
