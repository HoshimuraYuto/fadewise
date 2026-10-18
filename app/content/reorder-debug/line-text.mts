import { t } from '../../ui/i18n.mts';

export interface DebugEvent {
  ev: string;
  at?: number;
  key?: string | null;
  bpm?: number | null;
  movable?: number;
  window?: number;
  moves?: number;
  gain?: number;
  reason?: string | null;
  from?: (string | null)[] | number | null;
  to?: (string | null)[] | number | null;
  src?: string;
  why?: string | null;
  ms?: number;
  by?: string | null;
  n?: number;
  pos?: number[] | number | null;
  toast?: boolean;
  phase?: string;
  stopped?: string | null;
  steps?: number;
  landed?: number | boolean | null;
  drops?: number;
  ok?: boolean;
  result?: string;
  moved?: number;
  planned?: number;
  type?: string;
  use?: string;
  x?: number | null;
  y?: number | null;
}
export interface DebugState {
  state?: string;
  wait?: string | null;
  remain?: number | null;
  focus?: boolean;
  pageRetries?: number;
  contested?: boolean;
}
export interface DebugLimits {
  PAGE_RETRIES: number;
}

type Code = string | number | boolean | null | undefined;

const keyBpm = (v: DebugEvent) => ({ key: v.key || '?', bpm: v.bpm != null ? `${String(v.bpm)} BPM` : '? BPM' });

const label = (prefix: string, code: Code): string => {
  if (code == null) return '-';
  const k = prefix + String(code);
  const s = t(k);

  return s === k ? String(code) : s;
};

const position = (p: Code | readonly unknown[]): string =>
  p == null ? '?' : (p as number) > 0 ? `+${String(p)}` : String(p);
const keyList = (x: DebugEvent['from']): string => (Array.isArray(x) ? x : []).map((k) => k || '?').join(' ');

function runText(v: DebugEvent): string {
  const reason =
    v.reason === 'user_input' && v.by
      ? t('roReason.withBy', { reason: label('roReason.', v.reason), by: label('roBy.', v.by) })
      : label('roReason.', v.reason);
  if (v.result === 'done') return t('ro.done', { n: v.moved || 0 });
  if (v.result === 'partial') return t('ro.partial', { n: v.moved || 0, of: v.planned || 0, reason });
  if (v.result === 'aborted') return t('ro.aborted', { reason });

  return t('ro.skipped', { reason });
}

function planText(v: DebugEvent): string {
  const s = t('dbg.ev.plan', {
    movable: v.movable ?? 0,
    window: v.window ?? 0,
    moves: v.moves ?? 0,
    gain: (v.gain ?? 0).toFixed(2),
    reason: label('roReason.', v.reason),
  });
  if (!v.to) return s;

  return s + ' / ' + t('dbg.ev.planKeys', { from: keyList(v.from), to: keyList(v.to) });
}

function dragText(v: DebugEvent): string {
  if (v.phase === 'start') return t('dbg.ev.drag.start', { from: position(v.from), to: position(v.to) });

  if (v.phase === 'reached') {
    const steps = v.stopped ? label('roReason.', v.stopped) : `${String(v.steps ?? 0)} steps`;

    return t('dbg.ev.drag.reached', { at: position(v.pos), steps });
  }

  return t('dbg.ev.drag.drop', { landed: position(v.landed), drops: v.drops ?? 0 });
}

function moveText(v: DebugEvent): string {
  const ok = v.ok && v.landed ? t('dbg.ok') : t('dbg.fail', { reason: label('roReason.', v.reason || 'order') });

  return t('dbg.ev.move', Object.assign(keyBpm(v), { to: v.to as number, ok }));
}

const LINE: Partial<Record<string, (v: DebugEvent) => string>> = {
  track: (v) => t('dbg.ev.track', keyBpm(v)),
  plan: planText,
  scroll: (v) =>
    t('dbg.ev.scroll', {
      src: label('dbg.src.', v.src),
      why: v.why ? label('dbg.why.', v.why) : '',
      from: v.from as number,
      to: v.to as number,
      ms: v.ms,
    }),
  queue_ext: (v) =>
    t('dbg.ev.queue_ext', {
      by: label('dbg.by.', v.by),
      n: v.n,
      pos: (Array.isArray(v.pos) ? v.pos : []).map(position).join(' '),
      toast: v.toast ? t('dbg.yes') : t('dbg.no'),
    }),
  yt_toast: () => t('dbg.ev.yt_toast'),
  drag: dragText,
  move: moveText,
  run: (v) => t('dbg.ev.run', { text: runText(v) }),
  input: (v) => t('dbg.ev.input', { type: v.type, x: v.x ?? '?', y: v.y ?? '?' }),
  retry: (v) => t('dbg.ev.retry', { n: v.n, why: label('roReason.', v.why) }),
  contest: () => t('dbg.ev.contest'),
  guard_resume: (v) => t('dbg.ev.guard_resume', { n: v.n }),
  user_moved: (v) => t('dbg.ev.user_moved', { n: v.n }),
  error: () => t('dbg.ev.error'),
};

export function lineText(v: DebugEvent): string | null {
  const line = Object.hasOwn(LINE, v.ev) ? LINE[v.ev] : undefined;

  return line ? line(v) : null;
}

export function stateText(s: DebugState | null | undefined, limits: DebugLimits): string {
  if (!s?.state || s.state === 'idle') return t('dbg.state', { s: t('dbg.idle') });
  let state = label('roState.', s.state);
  if (s.state === 'waiting' && s.wait) state = t('roState.waitingFor', { reason: label('roWait.', s.wait) });
  if (s.remain != null) state += t('dbg.remain', { n: s.remain.toFixed(1) });
  const lines = [t('dbg.state', { s: state }) + ' · ' + (s.focus ? t('dbg.focus') : t('dbg.noFocus'))];
  lines.push(t('dbg.retries', { p: s.pageRetries || 0, P: limits.PAGE_RETRIES }));
  if (s.contested) lines.push(t('dbg.contested'));

  return lines.join('\n');
}
