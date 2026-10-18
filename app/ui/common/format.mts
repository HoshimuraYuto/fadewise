import { getLang, t } from '../i18n.mts';
import type { Num } from './views.mts';

export const fmt = (x: unknown, d = 1): string => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '–');
export const pct = (x: Num): number => Math.round((x || 0) * 100);

export const label = (prefix: string, k: unknown): string => {
  const s = t(prefix + String(k));

  return s === prefix + String(k) ? String(k) : s;
};

export const EMPTY = '—';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export const signed = (x: unknown, d = 1): string => {
  if (!isNum(x)) return EMPTY;
  const v = x.toFixed(d);

  return Number(v) > 0 ? `+${v}` : v;
};

export function clock(x: unknown, tenths = false): string {
  if (!isNum(x)) return EMPTY;
  const s = Math.max(0, x);
  const whole = tenths ? Math.floor(s) : Math.round(s);
  const ss = String(whole % 60).padStart(2, '0');
  const frac = tenths ? `.${String(Math.floor((s * 10) % 10))}` : '';

  return `${String(Math.floor(whole / 60))}:${ss}${frac}`;
}

export function shortDate(ms: unknown): string {
  if (!isNum(ms) || !ms) return EMPTY;
  const locale = getLang() === 'ja' ? 'ja-JP' : 'en-US';

  return new Date(ms).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
