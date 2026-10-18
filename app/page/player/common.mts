import { releaseFade } from './fades.mts';
import { ovCancel } from './overlap-events.mts';
import type { Player } from './state.mts';

export const TAG = 'fadewise';
export const RAMP_SEC = 0.05;
export const RELEASE_SEC = 0.02;
export const DURATION_MATCH_SEC = 1.5;

export const errText = (e: unknown): string => String((e as Error | null)?.message || e).slice(0, 120);

export const round = (x: number, digits: number): number => +x.toFixed(digits);

export function post(pl: Player, type: string, data: unknown): void {
  try {
    pl.win.postMessage({ [TAG]: 'main', type, data }, pl.win.location.origin);
  } catch {
    /* ignore */
  }
}

export function noteError(pl: Player, e: unknown): void {
  pl.errors++;
  pl.status.lastError = errText(e);
  pl.status.errors = pl.errors;
  if (__FADEWISE_VERIFY__ && (pl.errors <= 3 || pl.errors % 100 === 0))
    post(pl, 'diag', { kind: 'error', errors: pl.errors, message: pl.status.lastError });
}

export const safe =
  <P extends unknown[]>(pl: Player, fn: (...a: P) => void) =>
  (...a: P): void => {
    try {
      fn(...a);
    } catch (e) {
      noteError(pl, e);

      try {
        ovCancel(pl, 'error');
      } catch {
        /* ignore */
      }

      try {
        releaseFade(pl, 'error');
      } catch {
        /* ignore */
      }

      if (pl.errors % 5 === 0) publishLiveness(pl, Date.now());
    }
  };

export function publishLiveness(pl: Player, now: number): void {
  const { status, ctx, gainNode, fadeNode, video } = pl;
  status.at = now;

  if (ctx) {
    status.ctxState = ctx.state;
    status.ctxTime = round(ctx.currentTime, 2);
  }

  if (gainNode) status.gainLinear = round(gainNode.gain.value, 4);
  if (fadeNode) status.fadeLinear = round(fadeNode.gain.value, 4);
  if (video) status.position = round(video.currentTime, 1);
  post(pl, 'status', status);
}

export function setParam(pl: Player, param: AudioParam | null, value: number, dur: number): void {
  if (!param || !pl.ctx) return;
  const now = pl.ctx.currentTime;

  try {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    if (dur > 0) param.linearRampToValueAtTime(value, now + dur);
    else param.setValueAtTime(value, now);
  } catch {
    try {
      param.value = value;
    } catch {
      /* ignore */
    }
  }
}

export function rampParam(param: AudioParam, value: number, now: number, dur: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + dur);
}

export const ovLog = (pl: Player): unknown[][] => (pl.win.__fadewiseOvLog ??= []);

export function pushOvLog(pl: Player, entry: unknown[]): void {
  const log = ovLog(pl);
  log.push(entry);
  if (log.length > 500) log.splice(0, 100);
}

export const ctxTime = (pl: Player, digits: number): number | null =>
  pl.ctx ? round(pl.ctx.currentTime, digits) : null;

export const videoTime = (pl: Player, digits: number): number | null =>
  pl.video ? round(pl.video.currentTime, digits) : null;
