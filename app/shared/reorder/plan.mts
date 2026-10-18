import { DEFAULTS, chainScore, isMovable, isNum, transitionScore } from './score.mts';
import type { Opts, ReorderOptions, Summary } from './score.mts';

export type PlanReason = 'ok' | 'same' | 'small_gain' | 'few_movable' | 'duplicate';
export interface ReorderPlan {
  order: string[];
  changed: boolean;
  gain: number;
  moved: number;
  movable: number;
  reason: PlanReason;
}

export function planReorder(
  current: Summary | null | undefined,
  upcoming: readonly Summary[],
  options?: ReorderOptions | null,
): ReorderPlan {
  const o: Opts = Object.assign({}, DEFAULTS, options);
  const win = upcoming.slice(0, o.window);
  const ids = win.map((t) => t.id);
  const fixed = o.fixed instanceof Set ? (o.fixed as Set<string>) : new Set(o.fixed || []);
  const movableFlags = win.map((t, i) => isMovable(t, o) && !fixed.has(t.id) && !(o.lockNext && i === 0));
  const nMovable = movableFlags.filter(Boolean).length;
  const keep = { order: ids, changed: false, gain: 0, moved: 0, movable: nMovable };
  if (new Set(ids).size !== ids.length) return Object.assign(keep, { reason: 'duplicate' as const });
  if (nMovable < 2) return Object.assign(keep, { reason: 'few_movable' as const });

  const sourceWin = sourceOrder(win, movableFlags, o.base || null);
  const out = greedyOrder(current, sourceWin, movableFlags, o);
  const order = out.map((t) => t.id);
  const moved = order.filter((id, i) => id !== ids[i]).length;
  const gain = chainScore(current, out, o) - chainScore(current, win, o);
  if (moved === 0) return Object.assign(keep, { reason: 'same' as const });
  if (gain < o.minTotalGain || gain / moved < o.minGain)
    return Object.assign(keep, { gain, reason: 'small_gain' as const });

  return { order, changed: true, gain, moved, reason: 'ok', movable: nMovable };
}

function sourceOrder(
  win: readonly Summary[],
  movableFlags: readonly boolean[],
  base: Record<string, number> | null,
): Summary[] {
  const rank = (id: string) => (base && isNum(base[id]) ? base[id] : null);
  const movableSlots = win.map((_, i) => i).filter((i) => movableFlags[i]);
  const byRank = movableSlots.slice().sort((x, y) => {
    const rx = rank(win[x].id);
    const ry = rank(win[y].id);
    if (rx !== null && ry !== null && rx !== ry) return rx - ry;

    return x - y;
  });
  const out = win.slice();
  movableSlots.forEach((slot, k) => {
    out[slot] = win[byRank[k]];
  });

  return out;
}

function greedyOrder(
  current: Summary | null | undefined,
  sourceWin: readonly Summary[],
  movableFlags: readonly boolean[],
  o: Opts,
): Summary[] {
  const sourceSlot = new Map(sourceWin.map((t, i) => [t.id, i]));
  const slotOf = (id: string) => sourceSlot.get(id) as number;
  const remaining = new Set(sourceWin.filter((_, i) => movableFlags[i]).map((t) => t.id));
  const byId = new Map(sourceWin.map((t) => [t.id, t]));
  const out: Summary[] = [];
  let prev = current;

  for (let slot = 0; slot < sourceWin.length; slot++) {
    const t = movableFlags[slot] ? pickForSlot(slot, prev, remaining, byId, slotOf, o) : sourceWin[slot];
    remaining.delete(t.id);
    out.push(t);
    prev = t;
  }

  return out;
}

function pickForSlot(
  slot: number,
  prev: Summary | null | undefined,
  remaining: ReadonlySet<string>,
  byId: ReadonlyMap<string, Summary>,
  slotOf: (id: string) => number,
  o: Opts,
): Summary {
  const rem = [...remaining];
  const bySourceSlot = (x: string, y: string) => slotOf(x) - slotOf(y);
  const overdue = rem.filter((id) => slot - slotOf(id) >= o.maxShift).sort(bySourceSlot)[0] as string | undefined;
  const candidates = overdue !== undefined ? [overdue] : rem.filter((id) => Math.abs(slotOf(id) - slot) <= o.maxShift);
  let best: string | null = null;
  let bestValue = -Infinity;

  for (const id of candidates) {
    const shiftPenalty = (o.wOrder * Math.abs(slotOf(id) - slot)) / o.maxShift;
    const value = transitionScore(prev, byId.get(id), o) - shiftPenalty;
    const tie = Math.abs(value - bestValue) <= 1e-12;

    if (value > bestValue + 1e-12 || (tie && best !== null && slotOf(id) < slotOf(best))) {
      bestValue = value;
      best = id;
    }
  }

  return byId.get(best ?? rem.sort(bySourceSlot)[0]) as Summary;
}

export interface Move {
  id: string;
  toIndex: number;
}

// last: end of the LIS in seq; back: previous index in it
function lis(seq: readonly number[]) {
  const tails: number[] = [],
    tailIdx: number[] = [],
    back = new Array<number>(seq.length).fill(-1);
  seq.forEach((v, i) => {
    let lo = 0,
      hi = tails.length;

    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (tails[m] < v) lo = m + 1;
      else hi = m;
    }

    tails[lo] = v;
    tailIdx[lo] = i;
    back[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  });

  return { last: tails.length ? tailIdx[tails.length - 1] : -1, back };
}

export function movesFor(from: readonly string[], to: readonly string[]): Move[] {
  if (from.length !== to.length || from.slice().sort().join() !== to.slice().sort().join())
    throw new Error('not a permutation');
  const rankOf = new Map(to.map((id, i) => [id, i]));
  const { last, back } = lis(from.map((id) => rankOf.get(id) as number));
  const stay = new Set<string>();
  for (let i = last; i >= 0; i = back[i]) stay.add(from[i]);
  const cur = from.slice(),
    moves: Move[] = [];

  for (let target = 0; target < to.length; target++) {
    const id = to[target];
    if (stay.has(id)) continue;
    cur.splice(cur.indexOf(id), 1);
    const predIdx = target === 0 ? -1 : cur.indexOf(to[target - 1]);
    cur.splice(predIdx + 1, 0, id);
    moves.push({ id, toIndex: predIdx + 1 });
    stay.add(id);
  }

  if (cur.join() !== to.join()) throw new Error('move plan does not reproduce the target');

  return moves;
}

export const applyMove = (list: readonly string[], m: Move): string[] => {
  const l = list.slice();
  l.splice(l.indexOf(m.id), 1);
  l.splice(m.toIndex, 0, m.id);

  return l;
};

export function movedBetween(before: readonly string[], after: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of after) counts.set(id, (counts.get(id) || 0) + 1);
  const dup = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  const inBefore = new Map<string, number>();
  before.forEach((id, i) => {
    if (!inBefore.has(id)) inBefore.set(id, i);
  });
  const seen = new Set<string>();
  const common = after.filter((id) => {
    if (!inBefore.has(id) || counts.get(id) !== 1 || seen.has(id)) return false;
    seen.add(id);

    return true;
  });
  const { last, back } = lis(common.map((id) => inBefore.get(id) as number));
  const keepSet = new Set<string>();
  for (let i = last; i >= 0; i = back[i]) keepSet.add(common[i]);

  return common.filter((id) => !keepSet.has(id)).concat(dup);
}
