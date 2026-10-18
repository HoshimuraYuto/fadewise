// never show video ids, titles or artists on the page
import type { Diag } from './context.mts';

export type KeyBpm = {
  key: string | null;
  bpm: number | null;
};
export type DebugView = Record<string, unknown> & { ev: string };
type KeyOf = (id: unknown) => Partial<KeyBpm> | null | undefined;
type View = (d: Diag, kb: (id: unknown) => KeyBpm) => DebugView;

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const code = (x: unknown) => (typeof x === 'string' ? x.slice(0, 32) : null);
const PLAN_KEYS = 12;

const plan: View = (d, kb) => {
  const keys = (ids: unknown) => (Array.isArray(ids) ? ids.slice(0, PLAN_KEYS).map((id) => kb(id).key) : null);

  return {
    ev: 'plan',
    queue: code(d.queue),
    window: num(d.window),
    movable: num(d.movable),
    moves: num(d.moves),
    gain: num(d.gain),
    reason: code(d.reason),
    from: keys(d.from),
    to: d.reason === 'ok' ? keys(d.to) : null,
    fixed: Array.isArray(d.fixed) ? d.fixed.length : 0,
  };
};

const drag: View = (d) => ({
  ev: 'drag',
  phase: code(d.phase),
  from: num(d.from),
  to: num(d.to),
  pos: num(d.at),
  steps: num(d.steps),
  landed: num(d.landed),
  drops: num(d.drops),
  hop: num(d.hop),
  hops: num(d.hops),
  stopped: code(d.stopped),
});

const move: View = (d, kb) => {
  const res = d.res as { ok?: unknown; stopped?: unknown; reason?: unknown } | null | undefined;

  const view = {
    ev: 'move',
    method: code(d.method),
    to: (num(d.to) ?? 0) + 1,
    ok: !!res?.ok,
    reason: code(res && (res.stopped || res.reason)),
    landed: !!d.landed,
    storeOk: !!d.storeOk,
    playingOk: !!d.playingOk,
  };

  return Object.assign(view, kb(d.id));
};

const VIEWS: Record<string, View> = {
  ro_track: (d, kb) => Object.assign({ ev: 'track' }, kb(d.id)),
  ro_plan: plan,
  ro_scroll: (d) => ({
    ev: 'scroll',
    src: code(d.src),
    why: code(d.why),
    from: num(d.from),
    to: num(d.to),
    ms: num(d.ms),
    running: !!d.running,
  }),
  ro_queue_ext: (d) => ({
    ev: 'queue_ext',
    by: code(d.by),
    n: num(d.n),
    pos: Array.isArray(d.pos) ? d.pos.map(num) : [],
    toast: !!d.toast,
  }),
  ro_yt_toast: () => ({ ev: 'yt_toast' }),
  ro_drag: drag,
  ro_move: move,
  ro_run: (d) => ({
    ev: 'run',
    result: code(d.result),
    reason: code(d.reason),
    by: code(d.by),
    moved: num(d.moved),
    planned: num(d.planned),
    ms: num(d.ms),
  }),
  ro_input: (d) => ({
    ev: 'input',
    type: code(d.type),
    use: code(d.use),
    trusted: d.t !== false,
    focus: !!d.f,
    x: num(d.x),
    y: num(d.y),
  }),
  ro_retry: (d) => ({ ev: 'retry', n: num(d.n), why: code(d.why) }),
  ro_contest: () => ({ ev: 'contest' }),
  ro_guard_resume: (d) => ({ ev: 'guard_resume', n: num(d.n) }),
  ro_user_moved: (d) => ({ ev: 'user_moved', n: num(d.n) }),
  ro_error: () => ({ ev: 'error' }),
};

export function debugView(d: Diag, keyOf: KeyOf): DebugView | null {
  const view = Object.hasOwn(VIEWS, d.kind) ? VIEWS[d.kind] : null;
  if (!view) return null;

  const kb = (id: unknown): KeyBpm => {
    const k = keyOf(id) || {};

    return { key: k.key || null, bpm: num(k.bpm) };
  };

  return view(d, kb);
}
