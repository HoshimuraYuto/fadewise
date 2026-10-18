import type { Camelot, KeyEdge, OrderKey, OrderKeyEdge } from './types.mts';

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface KeyOptions {
  minConf?: number;
  keyMode?: string;
}
export const KEY_DEFAULTS: Readonly<{ minConf: number; keyMode: 'family' | 'exact' }> = Object.freeze({
  minConf: 0.5,
  keyMode: 'family',
});

export function parseCamelot(c: unknown): Camelot | null {
  const m = typeof c === 'string' && /^(1[0-2]|[1-9])([AB])$/.exec(c.trim().toUpperCase());

  return m ? { n: Number(m[1]), l: m[2] as Camelot['l'] } : null;
}

// ±1 same letter is a fifth, the other letter at the same number the relative key, ±5 same letter a semitone.
export function camelotCompat(a: unknown, b: unknown): number | null {
  const p = parseCamelot(a),
    q = parseCamelot(b);
  if (!p || !q) return null;
  const d = Math.min((p.n - q.n + 12) % 12, (q.n - p.n + 12) % 12);
  if (p.l === q.l) return d === 0 ? 1 : d === 1 ? 0.9 : d === 2 ? 0.45 : d === 5 ? 0.3 : 0;

  return d === 0 ? 0.85 : d === 1 ? 0.55 : 0;
}

export function keyView(
  t: KeyEdge | null | undefined,
  opts?: KeyOptions | null,
): { cams: string[]; conf: number } | null {
  const o = Object.assign({}, KEY_DEFAULTS, opts);
  if (!t?.camelot || !parseCamelot(t.camelot)) return null;
  const cam = t.camelot;
  if ((t.keyConf || 0) >= o.minConf || o.keyMode !== 'family') return { cams: [cam], conf: clamp01(t.keyConf || 0) };
  if ((t.famConf || 0) >= o.minConf) return { cams: [cam].concat(t.related || []), conf: clamp01(t.famConf || 0) };

  return { cams: [cam], conf: clamp01(t.keyConf || 0) };
}

export function keyTerm(
  a: KeyEdge | null | undefined,
  b: KeyEdge | null | undefined,
  opts?: KeyOptions | null,
): number {
  const ka = keyView(a, opts),
    kb = keyView(b, opts);
  if (!ka || !kb) return 0.5;
  let c = 1;

  for (const x of ka.cams)
    for (const y of kb.cams) {
      const v = camelotCompat(x, y);
      if (v !== null) c = Math.min(c, v);
    }

  const conf = Math.min(ka.conf, kb.conf);

  return conf * c + (1 - conf) * 0.5;
}

export function keyOfTk(tk: OrderKey | null | undefined, side: 'head' | 'tail' | null | undefined): KeyEdge | null {
  const e: OrderKeyEdge | null | undefined = tk && side ? tk[side] : null;
  const s = e && typeof e.cam === 'string' ? e : tk;
  if (!s) return null;

  return {
    camelot: typeof s.cam === 'string' ? s.cam : null,
    keyConf: isNum(s.kc) ? s.kc : 0,
    famConf: isNum(s.fc) ? s.fc : 0,
    related: Array.isArray(s.rel) ? s.rel.filter((c) => parseCamelot(c)) : [],
  };
}
