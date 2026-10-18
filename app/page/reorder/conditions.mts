import { C } from '../../shared/reorder-timing.mts';
import type { Ctx, Playing } from './context.mts';

const transitionBusy = (ctx: Ctx) => {
  const tr = ctx.deps.trState();

  return !!tr && tr !== 'idle';
};

export function blockReason(ctx: Ctx, p: Playing | null, forMove: boolean): string | null {
  const { deps, st } = ctx;
  if (!deps.settings().reorder) return 'off';
  if (!p?.vid) return 'no_queue';
  if (p.ad) return 'ad';
  if (p.vid !== st.vid) return 'track_change';
  if (transitionBusy(ctx)) return 'transition';
  const budget = forMove ? C.MOVE_BUDGET_SEC : 0;
  const remain = Number.isFinite(p.duration) ? p.duration - p.ct : Infinity;
  if (remain < C.MIN_REMAIN_SEC + budget) return 'near_end';
  const armAt = deps.trArmAt();
  if (armAt !== null && Number.isFinite(armAt) && armAt - p.ct < budget) return 'transition';

  return null;
}

export function waitReason(ctx: Ctx, p: Playing): string | null {
  if (p.paused) return 'paused';
  if (ctx.deps.now() - ctx.st.lastInput < ctx.T.IDLE_SEC) return 'user_input';

  return null;
}

export function stopReason(ctx: Ctx): string | null {
  const { deps, st } = ctx;
  if (st.abort) return st.abort;
  const p: Partial<Playing> = deps.playing() || {};
  if (p.ad) return 'ad';
  if (p.paused) return 'paused';
  if (!deps.settings().reorder) return 'off';
  if (p.vid && p.vid !== st.vid) return 'track_change';
  if (transitionBusy(ctx)) return 'transition';
  const ending = p.duration !== undefined && Number.isFinite(p.duration);
  if (ending && (p.duration as number) - (p.ct ?? NaN) < C.MIN_REMAIN_SEC) return 'near_end';

  return null;
}
